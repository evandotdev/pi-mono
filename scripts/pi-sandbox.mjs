#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDefaultSandboxImage, resolveSandboxImage } from "./pi-sandbox-image-tag.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = realpathSync(path.resolve(__dirname, ".."));
const cwd = process.cwd();

const SANDBOX_MODE = normalizeSandboxMode(process.env.PI_SANDBOX_LAUNCH_MODE);
const EXTRA_FOLDERS_ENV = "PI_SANDBOX_EXTRA_FOLDERS";
const EXTRA_FOLDERS_BASE_CWD_ENV = "PI_SANDBOX_EXTRA_FOLDERS_CWD";

const FORWARDED_ENV_VARS = [
	"PI_SKIP_VERSION_CHECK",
	"PI_CACHE_RETENTION",
	"PI_PACKAGE_DIR",
	"VISUAL",
	"EDITOR",
	"ANTHROPIC_API_KEY",
	"AZURE_OPENAI_API_KEY",
	"OPENAI_API_KEY",
	"GEMINI_API_KEY",
	"MISTRAL_API_KEY",
	"GROQ_API_KEY",
	"CEREBRAS_API_KEY",
	"XAI_API_KEY",
	"OPENROUTER_API_KEY",
	"AI_GATEWAY_API_KEY",
	"ZAI_API_KEY",
	"OPENCODE_API_KEY",
	"KIMI_API_KEY",
	"MINIMAX_API_KEY",
	"MINIMAX_CN_API_KEY",
];

const HOST_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

function expandHomeDir(value) {
	if (value === "~") return os.homedir();
	if (typeof value === "string" && value.startsWith("~/")) {
		return path.join(os.homedir(), value.slice(2));
	}
	return value;
}

function getDefaultAgentDir() {
	const envDir = process.env[HOST_AGENT_DIR_ENV];
	if (typeof envDir === "string" && envDir.trim().length > 0) {
		return expandHomeDir(envDir.trim());
	}
	return path.join(os.homedir(), ".pi", "agent");
}

const DEFAULT_CONFIG = {
	enabled: true,
	image: "pi-sandbox:latest",
	network: "none",
	folders: ["."],
	pullOnStart: false,
	runArgs: ["--cap-drop=ALL", "--security-opt=no-new-privileges", "--ipc=none"],
	passEnv: true,
	agentDir: getDefaultAgentDir(),
	gitconfig: "host",
};

const NETWORK_MODES = new Set(["none", "bridge", "host"]);

const CONTAINER_HOME = "/home/pisandbox";
const CONTAINER_AGENT_DIR = `${CONTAINER_HOME}/.pi/agent`;
const CONTAINER_AGENTS_SKILLS_DIR = `${CONTAINER_HOME}/.agents/skills`;
const RESERVED_CONTAINER_NAMES = new Set([".pi", ".agents", ".gitconfig"]);

function normalizeSandboxMode(value) {
	if (!value) return "pi";
	const normalized = value.trim().toLowerCase();
	if (normalized === "pi" || normalized === "readonly" || normalized === "shell") return normalized;
	fail(`invalid PI_SANDBOX_LAUNCH_MODE '${value}'. Use one of: pi, readonly, shell`);
}

function parseEnvBoolean(value) {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseFoldersEnv(value) {
	if (!value) return [];

	let parsed;
	try {
		parsed = JSON.parse(value);
	} catch {
		fail(`invalid ${EXTRA_FOLDERS_ENV}; expected a JSON array of folder paths`);
	}

	if (!Array.isArray(parsed)) {
		fail(`invalid ${EXTRA_FOLDERS_ENV}; expected a JSON array of folder paths`);
	}

	const folders = parsed.filter((item) => typeof item === "string" && item.trim().length > 0);
	if (folders.length !== parsed.length) {
		fail(`invalid ${EXTRA_FOLDERS_ENV}; expected a JSON array of non-empty folder paths`);
	}

	return folders;
}

function fail(message) {
	console.error(`pi-sandbox: ${message}`);
	process.exit(1);
}

function commandExists(command) {
	const result = spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf-8" });
	return result.status === 0;
}

function runOrFail(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: "inherit", ...options });
	if (result.error) fail(result.error.message);
	if (typeof result.status === "number" && result.status !== 0) {
		process.exit(result.status);
	}
}

function runCapture(command, args) {
	return spawnSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function detectRuntime() {
	if (process.env.PI_CONTAINER_RUNTIME) return process.env.PI_CONTAINER_RUNTIME;
	if (!commandExists("docker")) fail("docker not found (or set PI_CONTAINER_RUNTIME)");

	const versionResult = runCapture("docker", ["--version"]);
	const dockerPathResult = runCapture("bash", ["-lc", "readlink -f \"$(command -v docker)\" 2>/dev/null || true"]);
	const versionText = `${versionResult.stdout}\n${versionResult.stderr}`.toLowerCase();
	const dockerRealPath = dockerPathResult.stdout.trim().toLowerCase();
	if (versionText.includes("podman") || dockerRealPath.includes("podman")) return "podman";
	return "docker";
}

function readConfigFile(configPath) {
	if (!existsSync(configPath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch (error) {
		fail(`failed to parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function mergeConfig(base, override) {
	const merged = { ...base };
	if (typeof override.enabled === "boolean") merged.enabled = override.enabled;
	if (typeof override.image === "string" && override.image.trim().length > 0) merged.image = override.image.trim();
	if (typeof override.network === "string" && NETWORK_MODES.has(override.network)) merged.network = override.network;
	if (Array.isArray(override.folders)) {
		merged.folders = override.folders.filter((value) => typeof value === "string" && value.trim().length > 0);
	}
	if (typeof override.pullOnStart === "boolean") merged.pullOnStart = override.pullOnStart;
	if (Array.isArray(override.runArgs)) {
		merged.runArgs = override.runArgs.filter((value) => typeof value === "string" && value.trim().length > 0);
	}
	if (typeof override.passEnv === "boolean") merged.passEnv = override.passEnv;
	if (typeof override.agentDir === "string" && override.agentDir.trim().length > 0) {
		merged.agentDir = override.agentDir.trim();
	}
	if (override.gitconfig === false) {
		merged.gitconfig = false;
	} else if (typeof override.gitconfig === "string" && override.gitconfig.trim().length > 0) {
		merged.gitconfig = override.gitconfig.trim();
	}
	return merged;
}

function resolveConfigPath(configValue, baseDir) {
	if (configValue === "~") return os.homedir();
	if (typeof configValue === "string" && configValue.startsWith("~/")) {
		return path.join(os.homedir(), configValue.slice(2));
	}
	if (typeof configValue !== "string") return undefined;
	return path.isAbsolute(configValue) ? path.resolve(configValue) : path.resolve(baseDir, configValue);
}

function resolveConfig() {
	const defaultAgentDir = getDefaultAgentDir();
	const globalConfigPath = path.join(defaultAgentDir, "extensions", "docker-sandbox.json");
	const hostCwd = realpathSync(cwd);
	const projectRoot = findNearestPiRoot(hostCwd);
	const projectConfigPath = projectRoot ? path.join(projectRoot, ".pi", "docker-sandbox.json") : undefined;
	let config = { ...DEFAULT_CONFIG, agentDir: defaultAgentDir };
	config = mergeConfig(config, readConfigFile(globalConfigPath));
	if (projectConfigPath) {
		config = mergeConfig(config, readConfigFile(projectConfigPath));
	}

	if (process.env.PI_SANDBOX_IMAGE) config.image = process.env.PI_SANDBOX_IMAGE;
	if (process.env.PI_SANDBOX_NETWORK && NETWORK_MODES.has(process.env.PI_SANDBOX_NETWORK)) {
		config.network = process.env.PI_SANDBOX_NETWORK;
	}
	if (process.env.PI_SANDBOX_PULL) config.pullOnStart = ["1", "true", "yes"].includes(process.env.PI_SANDBOX_PULL);

	if (!NETWORK_MODES.has(config.network)) {
		fail(`invalid network mode '${config.network}'. Use one of: none, bridge, host`);
	}
	if (!Array.isArray(config.folders) || config.folders.length === 0) {
		fail("folders must contain at least one path");
	}
	return {
		...config,
		projectRoot,
		projectConfigPath,
		resolvedGitconfigPath:
			config.gitconfig === false
				? undefined
				: config.gitconfig === "host"
					? path.join(os.homedir(), ".gitconfig")
					: resolveConfigPath(config.gitconfig, projectRoot ?? cwd),
	};
}

function resolveFolderPath(folder, baseDir = cwd) {
	let candidate = folder;
	if (candidate === "~") candidate = os.homedir();
	if (candidate.startsWith("~/")) candidate = path.join(os.homedir(), candidate.slice(2));
	const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(baseDir, candidate);
	if (!existsSync(absolute)) fail(`sandbox folder does not exist: ${folder} (${absolute})`);
	const stats = statSync(absolute);
	if (!stats.isDirectory()) fail(`sandbox folder is not a directory: ${folder} (${absolute})`);
	return realpathSync(absolute);
}

function isPathInside(candidate, base) {
	const relativePath = path.relative(base, candidate);
	if (relativePath === "") return true;
	if (relativePath === "..") return false;
	if (relativePath.startsWith(`..${path.sep}`)) return false;
	return !path.isAbsolute(relativePath);
}

function toPosixPath(value) {
	return value.split(path.sep).join("/");
}

function findNearestPiRoot(startDir) {
	let current = startDir;
	while (true) {
		const candidate = path.join(current, ".pi");
		if (existsSync(candidate)) {
			const stats = statSync(candidate);
			if (stats.isDirectory()) return current;
		}
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function resolveFolders(config, extraFolders = [], extraFoldersBaseDir = cwd) {
	const seen = new Set();
	const folders = [];
	const addFolder = (folderPath) => {
		if (seen.has(folderPath)) return;
		seen.add(folderPath);
		folders.push(folderPath);
	};

	for (const folder of config.folders) {
		addFolder(resolveFolderPath(folder));
	}

	for (const folder of extraFolders) {
		addFolder(resolveFolderPath(folder, extraFoldersBaseDir));
	}

	const hostCwd = realpathSync(cwd);
	const nearestPiRoot = findNearestPiRoot(hostCwd);
	if (nearestPiRoot) {
		addFolder(realpathSync(nearestPiRoot));
	}

	if (!isPathInside(hostCwd, repoRoot)) {
		addFolder(repoRoot);
	}

	return folders;
}

function buildRepoResourceArgs(hostCwd, mounts) {
	if (isPathInside(hostCwd, repoRoot)) {
		return [];
	}

	const repoMount = mounts.find((mount) => mount.hostPath === repoRoot);
	if (!repoMount) {
		return [];
	}

	const projectPiDir = path.join(repoRoot, ".pi");
	if (!existsSync(projectPiDir) || !statSync(projectPiDir).isDirectory()) {
		return [];
	}

	const projectPiContainerDir = `${repoMount.containerPath}/.pi`;
	const args = [];
	const extensionsDir = path.join(projectPiDir, "extensions");
	if (existsSync(extensionsDir) && statSync(extensionsDir).isDirectory()) {
		for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
			if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
				args.push("--extension", `${projectPiContainerDir}/extensions/${entry.name}`);
				continue;
			}
			if (!entry.isDirectory()) {
				continue;
			}
			for (const extensionName of ["index.ts", "index.js"]) {
				const extensionPath = path.join(extensionsDir, entry.name, extensionName);
				if (!existsSync(extensionPath) || !statSync(extensionPath).isFile()) {
					continue;
				}
				args.push("--extension", `${projectPiContainerDir}/extensions/${entry.name}/${extensionName}`);
				break;
			}
		}
	}

	const skillsDir = path.join(projectPiDir, "skills");
	if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
		args.push("--skill", `${projectPiContainerDir}/skills`);
	}

	const promptsDir = path.join(projectPiDir, "prompts");
	if (existsSync(promptsDir) && statSync(promptsDir).isDirectory()) {
		args.push("--prompt-template", `${projectPiContainerDir}/prompts`);
	}

	return args;
}

function sanitizeFolderName(name) {
	const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	return sanitized.length > 0 ? sanitized : "folder";
}

function allocateContainerName(seed, usedNames) {
	let folderName = seed;
	let suffix = 2;
	while (usedNames.has(folderName) || RESERVED_CONTAINER_NAMES.has(folderName)) {
		folderName = `${seed}-${suffix}`;
		suffix += 1;
	}
	usedNames.add(folderName);
	return folderName;
}

function buildMounts(folders) {
	const usedNames = new Set();
	const repoMountName = allocateContainerName(sanitizeFolderName(path.basename(repoRoot) || "root"), usedNames);

	return folders.map((hostPath) => {
		const base = path.basename(hostPath);
		const seed = sanitizeFolderName(base === path.sep || base === "" ? "root" : base);
		const folderName = hostPath === repoRoot ? repoMountName : allocateContainerName(seed, usedNames);
		return {
			hostPath,
			containerPath: `${CONTAINER_HOME}/${folderName}`,
		};
	});
}

function expandWorkspacePattern(workspacePattern) {
	const segments = workspacePattern.split("/");
	const results = [""];

	for (const segment of segments) {
		if (segment === "*") {
			const next = [];
			for (const current of results) {
				const directory = current ? path.join(repoRoot, current) : repoRoot;
				if (!existsSync(directory) || !statSync(directory).isDirectory()) continue;
				for (const entry of readdirSync(directory, { withFileTypes: true })) {
					if (!entry.isDirectory()) continue;
					next.push(current ? path.join(current, entry.name) : entry.name);
				}
			}
			results.splice(0, results.length, ...next);
			continue;
		}

		for (let index = 0; index < results.length; index += 1) {
			results[index] = results[index] ? path.join(results[index], segment) : segment;
		}
	}

	return results;
}

function getRepoWorkspacePaths() {
	const packageJsonPath = path.join(repoRoot, "package.json");
	if (!existsSync(packageJsonPath)) return [];

	let packageJson;
	try {
		packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
	} catch {
		return [];
	}

	if (!packageJson || typeof packageJson !== "object" || !Array.isArray(packageJson.workspaces)) {
		return [];
	}

	const workspacePaths = new Set();
	for (const workspace of packageJson.workspaces) {
		if (typeof workspace !== "string" || workspace.trim().length === 0) continue;
		for (const relativePath of expandWorkspacePattern(workspace)) {
			const absolutePath = path.join(repoRoot, relativePath);
			if (!existsSync(absolutePath) || !statSync(absolutePath).isDirectory()) continue;
			workspacePaths.add(relativePath);
		}
	}

	return [...workspacePaths].sort();
}

function addRepoNodeModulesVolumes(dockerArgs, mounts) {
	const repoMount = mounts.find((mount) => mount.hostPath === repoRoot);
	if (!repoMount) return;

	dockerArgs.push("--volume", `${repoMount.containerPath}/node_modules`);
	for (const workspacePath of getRepoWorkspacePaths()) {
		dockerArgs.push("--volume", `${repoMount.containerPath}/${toPosixPath(workspacePath)}/node_modules`);
	}
}

function resolveContainerCwd(hostCwd, mounts) {
	let bestMatch = undefined;
	for (const mount of mounts) {
		if (!isPathInside(hostCwd, mount.hostPath)) continue;
		if (!bestMatch || mount.hostPath.length > bestMatch.hostPath.length) {
			bestMatch = mount;
		}
	}

	if (!bestMatch) {
		fail(`current working directory is outside sandbox folders: ${hostCwd}`);
	}

	const relativePath = path.relative(bestMatch.hostPath, hostCwd);
	if (!relativePath || relativePath === ".") return bestMatch.containerPath;
	return `${bestMatch.containerPath}/${toPosixPath(relativePath)}`;
}

function ensureLocalImage(runtime, image) {
	const inspect = runCapture(runtime, ["image", "inspect", image]);
	if (inspect.status === 0) return;

	const dockerfilePath = path.join(repoRoot, "docker", "pi-sandbox", "Dockerfile");

	console.log(`pi-sandbox: building '${image}' from local fork packages ...`);
	runOrFail(runtime, ["build", "-f", dockerfilePath, "-t", image, repoRoot]);
}

function ensureImage(runtime, config, image) {
	if (isDefaultSandboxImage(config.image)) {
		ensureLocalImage(runtime, image);
		return;
	}

	if (config.pullOnStart) {
		runOrFail(runtime, ["pull", image]);
		return;
	}

	const inspect = runCapture(runtime, ["image", "inspect", image]);
	if (inspect.status !== 0) {
		console.log(`pi-sandbox: pulling '${image}' ...`);
		runOrFail(runtime, ["pull", image]);
	}
}

function buildDockerRunArgs(runtime, config, image, folders, mounts, containerCwd, resourceArgs, passthroughArgs, launchMode) {
	const hostHome = os.homedir();
	const readonly = launchMode === "readonly";
	const dockerArgs = ["run", "--rm", "--interactive", "--network", config.network, "--workdir", containerCwd];
	if (process.stdin.isTTY && process.stdout.isTTY) dockerArgs.push("--tty");
	if (runtime === "podman") dockerArgs.push("--userns=keep-id");

	if (typeof process.getuid === "function" && typeof process.getgid === "function") {
		dockerArgs.push("--user", `${process.getuid()}:${process.getgid()}`);
	}

	for (const runArg of config.runArgs) {
		dockerArgs.push(runArg);
	}

	for (const mount of mounts) {
		dockerArgs.push("--volume", `${mount.hostPath}:${mount.containerPath}${readonly ? ":ro" : ""}`);
	}
	addRepoNodeModulesVolumes(dockerArgs, mounts);

	const agentDir = path.resolve(config.agentDir);
	mkdirSync(agentDir, { recursive: true });
	dockerArgs.push("--volume", `${agentDir}:${CONTAINER_AGENT_DIR}`);
	dockerArgs.push("--env", `PI_CODING_AGENT_DIR=${CONTAINER_AGENT_DIR}`);

	const hostAgentsSkillsDir = path.join(hostHome, ".agents", "skills");
	if (existsSync(hostAgentsSkillsDir) && statSync(hostAgentsSkillsDir).isDirectory()) {
		dockerArgs.push("--volume", `${hostAgentsSkillsDir}:${CONTAINER_AGENTS_SKILLS_DIR}:ro`);
	}

	if (!parseEnvBoolean(process.env.PI_NO_GITCONFIG) && config.resolvedGitconfigPath) {
		if (!existsSync(config.resolvedGitconfigPath)) {
			fail(`gitconfig does not exist: ${config.resolvedGitconfigPath}`);
		}
		if (!statSync(config.resolvedGitconfigPath).isFile()) {
			fail(`gitconfig is not a file: ${config.resolvedGitconfigPath}`);
		}
		dockerArgs.push("--volume", `${config.resolvedGitconfigPath}:${CONTAINER_HOME}/.gitconfig:ro`);
	}

	dockerArgs.push("--env", `PI_SANDBOX_MODE=${readonly ? "docker-readonly" : "docker"}`);
	dockerArgs.push("--env", "PI_SANDBOX_ENABLED=1");
	dockerArgs.push("--env", `PI_SANDBOX_RUNTIME=${runtime}`);
	dockerArgs.push("--env", `PI_SANDBOX_IMAGE=${image}`);
	dockerArgs.push("--env", `PI_SANDBOX_NETWORK=${config.network}`);
	dockerArgs.push("--env", `PI_SANDBOX_FOLDERS=${JSON.stringify(folders)}`);
	dockerArgs.push("--env", `PI_SANDBOX_MOUNTS=${JSON.stringify(mounts)}`);
	dockerArgs.push("--env", `PI_SANDBOX_CONTAINER_CWD=${containerCwd}`);
	dockerArgs.push("--env", "PI_SANDBOX_LAUNCHER=scripts/pi-sandbox.sh");
	dockerArgs.push("--env", `HOME=${CONTAINER_HOME}`);
	if (readonly) {
		dockerArgs.push("--env", "PI_SANDBOX_REASON=Read-only mode");
	}

	const terminal = process.env.TERM ?? "xterm-256color";
	dockerArgs.push("--env", `TERM=${terminal}`);
	if (process.env.COLORTERM) dockerArgs.push("--env", `COLORTERM=${process.env.COLORTERM}`);

	if (config.passEnv) {
		for (const envName of FORWARDED_ENV_VARS) {
			const value = process.env[envName];
			if (value === undefined) continue;
			dockerArgs.push("--env", `${envName}=${value}`);
		}
	}

	if (launchMode === "shell") {
		dockerArgs.push("--entrypoint", "bash", image, ...passthroughArgs);
		return dockerArgs;
	}

	const piArgs = readonly
		? ["--tools", "read,grep,find,ls", ...resourceArgs, ...passthroughArgs]
		: [...resourceArgs, ...passthroughArgs];
	dockerArgs.push(image, ...piArgs);
	return dockerArgs;
}

function runHostPi(args, reason) {
	const sandboxEnv = {
		...process.env,
		PI_SANDBOX_MODE: "docker",
		PI_SANDBOX_ENABLED: "0",
		PI_SANDBOX_REASON: reason,
		PI_SANDBOX_LAUNCHER: "scripts/pi-sandbox.sh",
	};

	if (commandExists("pi")) {
		runOrFail("pi", args, { env: sandboxEnv });
		return;
	}

	const fallback = path.join(repoRoot, "pi-test.sh");
	if (!existsSync(fallback)) {
		fail("sandbox disabled by config and no host pi command found");
	}
	runOrFail(fallback, args, { env: sandboxEnv });
}

function main() {
	const passthroughArgs = process.argv.slice(2);
	const runtime = detectRuntime();
	const config = resolveConfig();

	if (!config.enabled) {
		if (SANDBOX_MODE === "shell") {
			fail("sandbox disabled via config; shell mode requires sandbox enabled");
		}
		runHostPi(passthroughArgs, SANDBOX_MODE === "readonly" ? "Read-only mode disabled via config" : "Disabled via config");
		return;
	}

	const image = resolveSandboxImage(config.image, repoRoot);
	const folders = resolveFolders(
		config,
		parseFoldersEnv(process.env[EXTRA_FOLDERS_ENV]),
		process.env[EXTRA_FOLDERS_BASE_CWD_ENV] ?? cwd,
	);
	const mounts = buildMounts(folders);
	const hostCwd = realpathSync(cwd);
	const containerCwd = resolveContainerCwd(hostCwd, mounts);
	const resourceArgs = buildRepoResourceArgs(hostCwd, mounts);
	ensureImage(runtime, config, image);
	const dockerRunArgs = buildDockerRunArgs(
		runtime,
		config,
		image,
		folders,
		mounts,
		containerCwd,
		resourceArgs,
		passthroughArgs,
		SANDBOX_MODE,
	);
	runOrFail(runtime, dockerRunArgs);
}

main();
