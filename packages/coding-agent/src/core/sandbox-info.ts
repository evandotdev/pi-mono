import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir } from "../config.js";

export interface OsSandboxNetworkConfig {
	allowedDomains?: string[];
	deniedDomains?: string[];
}

export interface OsSandboxFilesystemConfig {
	denyRead?: string[];
	allowWrite?: string[];
	denyWrite?: string[];
}

export interface OsSandboxConfig {
	enabled?: boolean;
	network?: OsSandboxNetworkConfig;
	filesystem?: OsSandboxFilesystemConfig;
	ignoreViolations?: Record<string, string[]>;
	enableWeakerNestedSandbox?: boolean;
}

export interface DockerSandboxConfig {
	enabled?: boolean;
	image?: string;
	network?: string;
	folders?: string[];
	pullOnStart?: boolean;
	runArgs?: string[];
	passEnv?: boolean;
	agentDir?: string;
	gitconfig?: string | false;
}

export interface SandboxPathState {
	path: string;
	kind: "missing" | "file" | "directory" | "symlink" | "other";
	target?: string;
}

export interface SandboxConfigSource<T> {
	path: string;
	state: SandboxPathState["kind"];
	config?: T;
}

export interface SandboxReport {
	cwd: string;
	homeDir: string;
	homePi: SandboxPathState;
	projectRoot?: string;
	agentDir: string;
	osSandbox: {
		defaults: OsSandboxConfig;
		global: SandboxConfigSource<OsSandboxConfig>;
		project: SandboxConfigSource<OsSandboxConfig>;
		resolved: OsSandboxConfig;
	};
	dockerSandbox: {
		defaults: DockerSandboxConfig;
		global: SandboxConfigSource<DockerSandboxConfig>;
		project: SandboxConfigSource<DockerSandboxConfig>;
		resolved: DockerSandboxConfig;
	};
	relevantFiles: SandboxPathState[];
}

const DEFAULT_OS_SANDBOX_CONFIG: OsSandboxConfig = {
	enabled: true,
	network: {
		allowedDomains: [
			"npmjs.org",
			"*.npmjs.org",
			"registry.npmjs.org",
			"registry.yarnpkg.com",
			"pypi.org",
			"*.pypi.org",
			"github.com",
			"*.github.com",
			"api.github.com",
			"raw.githubusercontent.com",
		],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
		allowWrite: [".", "/tmp"],
		denyWrite: [".env", ".env.*", "*.pem", "*.key"],
	},
};

const DEFAULT_DOCKER_SANDBOX_CONFIG: DockerSandboxConfig = {
	enabled: true,
	image: "pi-sandbox:latest",
	network: "none",
	folders: ["."],
	pullOnStart: false,
	runArgs: ["--cap-drop=ALL", "--security-opt=no-new-privileges", "--ipc=none"],
	passEnv: true,
	agentDir: getAgentDir(),
	gitconfig: "host",
};

const RELEVANT_FILES = [
	"scripts/pi-sandbox.mjs",
	"scripts/pi-sandbox.sh",
	"scripts/pi-sandbox-build.sh",
	".mise/tasks/pi/_default",
	".mise/tasks/pi/readonly",
	".mise/tasks/pi/shell",
	".mise/tasks/pi/yolo",
	".mise/tasks/pi/build",
	".mise/tasks/pi/stow/install",
	".mise/tasks/pi/stow/uninstall",
	".mise/tasks/pi/stow/mise/install",
	".mise/tasks/pi/stow/mise/uninstall",
	".pi/extensions/sandbox.ts",
	"packages/coding-agent/examples/extensions/sandbox/index.ts",
	"packages/coding-agent/docs/sandboxing.md",
	"packages/coding-agent/examples/extensions/README.md",
] as const;

export function findNearestPiRoot(startDir: string): string | undefined {
	const homeDir = os.homedir();
	let current = startDir;
	while (true) {
		// Stop before the home directory so ~/.pi stays config-only and never becomes a mounted project root.
		if (current === homeDir) return undefined;
		const candidate = join(current, ".pi");
		if (isDirectory(candidate)) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function isDirectory(targetPath: string): boolean {
	if (!existsSync(targetPath)) return false;
	try {
		return statSync(targetPath).isDirectory();
	} catch {
		return false;
	}
}

function readJsonConfig<T extends object>(configPath: string): T | undefined {
	if (!existsSync(configPath)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		return parsed as T;
	} catch {
		return undefined;
	}
}

function describePath(targetPath: string): SandboxPathState {
	if (!existsSync(targetPath)) {
		return { path: targetPath, kind: "missing" };
	}

	try {
		const stats = lstatSync(targetPath);
		if (stats.isSymbolicLink()) {
			return { path: targetPath, kind: "symlink", target: readlinkSync(targetPath) };
		}
		if (stats.isDirectory()) {
			return { path: targetPath, kind: "directory" };
		}
		if (stats.isFile()) {
			return { path: targetPath, kind: "file" };
		}
		return { path: targetPath, kind: "other" };
	} catch {
		return { path: targetPath, kind: "other" };
	}
}

function mergeOsSandboxConfig(base: OsSandboxConfig, overrides: OsSandboxConfig | undefined): OsSandboxConfig {
	if (!overrides)
		return {
			...base,
			network: base.network ? { ...base.network } : undefined,
			filesystem: base.filesystem ? { ...base.filesystem } : undefined,
		};

	const result: OsSandboxConfig = {
		...base,
		network: base.network ? { ...base.network } : undefined,
		filesystem: base.filesystem ? { ...base.filesystem } : undefined,
	};

	if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
	if (overrides.network) {
		result.network = { ...result.network, ...overrides.network };
	}
	if (overrides.filesystem) {
		result.filesystem = { ...result.filesystem, ...overrides.filesystem };
	}
	if (overrides.ignoreViolations) {
		result.ignoreViolations = overrides.ignoreViolations;
	}
	if (overrides.enableWeakerNestedSandbox !== undefined) {
		result.enableWeakerNestedSandbox = overrides.enableWeakerNestedSandbox;
	}

	return result;
}

function mergeDockerSandboxConfig(
	base: DockerSandboxConfig,
	overrides: DockerSandboxConfig | undefined,
): DockerSandboxConfig {
	if (!overrides) return { ...base, folders: base.folders?.slice(), runArgs: base.runArgs?.slice() };

	const result: DockerSandboxConfig = {
		...base,
		folders: base.folders?.slice(),
		runArgs: base.runArgs?.slice(),
	};

	if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
	if (typeof overrides.image === "string" && overrides.image.trim().length > 0) result.image = overrides.image.trim();
	if (typeof overrides.network === "string" && overrides.network.trim().length > 0)
		result.network = overrides.network.trim();
	if (Array.isArray(overrides.folders)) {
		result.folders = overrides.folders.filter(
			(folder): folder is string => typeof folder === "string" && folder.trim().length > 0,
		);
	}
	if (overrides.pullOnStart !== undefined) result.pullOnStart = overrides.pullOnStart;
	if (Array.isArray(overrides.runArgs)) {
		result.runArgs = overrides.runArgs.filter(
			(arg): arg is string => typeof arg === "string" && arg.trim().length > 0,
		);
	}
	if (overrides.passEnv !== undefined) result.passEnv = overrides.passEnv;
	if (typeof overrides.agentDir === "string" && overrides.agentDir.trim().length > 0)
		result.agentDir = overrides.agentDir.trim();
	if (overrides.gitconfig === false) {
		result.gitconfig = false;
	} else if (typeof overrides.gitconfig === "string" && overrides.gitconfig.trim().length > 0) {
		result.gitconfig = overrides.gitconfig.trim();
	}

	return result;
}

function formatPathState(label: string, state: SandboxPathState): string {
	if (state.kind === "missing") return `${label}: ${state.path} (missing)`;
	if (state.kind === "symlink") return `${label}: ${state.path} (symlink -> ${state.target ?? "unknown"})`;
	return `${label}: ${state.path} (${state.kind})`;
}

function normalizeRootPath(cwd: string, root?: string): string | undefined {
	if (root) return root;
	const candidate = join(cwd, ".pi");
	return isDirectory(candidate) ? cwd : undefined;
}

export function collectSandboxReport(options?: { cwd?: string; homeDir?: string; agentDir?: string }): SandboxReport {
	const cwd = options?.cwd ?? process.cwd();
	const homeDir = options?.homeDir ?? os.homedir();
	const agentDir = options?.agentDir ?? getAgentDir();
	const projectRoot = normalizeRootPath(cwd, findNearestPiRoot(cwd));
	const homePi = describePath(join(homeDir, ".pi"));

	const osGlobalConfigPath = join(agentDir, "extensions", "sandbox.json");
	const osProjectConfigPath = join(projectRoot ?? cwd, ".pi", "sandbox.json");
	const dockerGlobalConfigPath = join(agentDir, "extensions", "docker-sandbox.json");
	const dockerProjectConfigPath = join(projectRoot ?? cwd, ".pi", "docker-sandbox.json");

	const osGlobal = readJsonConfig<OsSandboxConfig>(osGlobalConfigPath);
	const osProject = readJsonConfig<OsSandboxConfig>(osProjectConfigPath);
	const dockerGlobal = readJsonConfig<DockerSandboxConfig>(dockerGlobalConfigPath);
	const dockerProject = readJsonConfig<DockerSandboxConfig>(dockerProjectConfigPath);

	const osResolved = mergeOsSandboxConfig(mergeOsSandboxConfig(DEFAULT_OS_SANDBOX_CONFIG, osGlobal), osProject);
	const dockerResolved = mergeDockerSandboxConfig(
		mergeDockerSandboxConfig(DEFAULT_DOCKER_SANDBOX_CONFIG, dockerGlobal),
		dockerProject,
	);

	return {
		cwd,
		homeDir,
		homePi,
		projectRoot,
		agentDir,
		osSandbox: {
			defaults: DEFAULT_OS_SANDBOX_CONFIG,
			global: { path: osGlobalConfigPath, state: describePath(osGlobalConfigPath).kind, config: osGlobal },
			project: { path: osProjectConfigPath, state: describePath(osProjectConfigPath).kind, config: osProject },
			resolved: osResolved,
		},
		dockerSandbox: {
			defaults: DEFAULT_DOCKER_SANDBOX_CONFIG,
			global: {
				path: dockerGlobalConfigPath,
				state: describePath(dockerGlobalConfigPath).kind,
				config: dockerGlobal,
			},
			project: {
				path: dockerProjectConfigPath,
				state: describePath(dockerProjectConfigPath).kind,
				config: dockerProject,
			},
			resolved: dockerResolved,
		},
		relevantFiles: RELEVANT_FILES.map((relativePath) => describePath(join(projectRoot ?? cwd, relativePath))),
	};
}

function summarizeConfigFiles<T extends { enabled?: boolean }>(
	label: string,
	source: SandboxConfigSource<T>,
): string[] {
	const lines = [`${label}: ${source.path} (${source.state})`];
	if (source.config) {
		lines.push(`  enabled: ${source.config.enabled !== false ? "yes" : "no"}`);
	}
	return lines;
}

export function formatSandboxReport(report: SandboxReport): string {
	const lines: string[] = [];
	lines.push("Sandbox topology:");
	lines.push(`  CWD: ${report.cwd}`);
	lines.push(`  Project .pi root: ${report.projectRoot ?? "(none found)"}`);
	lines.push(formatPathState("  Home .pi", report.homePi));
	lines.push(`  Global agent dir: ${report.agentDir}`);
	lines.push("  Command: /sandbox:info (alias /doctor:sandbox)");
	lines.push("");
	lines.push("OS sandbox config:");
	lines.push("  Precedence: default → global → project");
	lines.push(...summarizeConfigFiles("  Global", report.osSandbox.global));
	lines.push(...summarizeConfigFiles("  Project", report.osSandbox.project));
	lines.push(`  Enabled by default: ${report.osSandbox.resolved.enabled !== false ? "yes" : "no"}`);
	lines.push(`  Allowed domains: ${report.osSandbox.resolved.network?.allowedDomains?.join(", ") || "(none)"}`);
	lines.push(`  Denied domains: ${report.osSandbox.resolved.network?.deniedDomains?.join(", ") || "(none)"}`);
	lines.push(`  Allow write: ${report.osSandbox.resolved.filesystem?.allowWrite?.join(", ") || "(none)"}`);
	lines.push(`  Deny read: ${report.osSandbox.resolved.filesystem?.denyRead?.join(", ") || "(none)"}`);
	lines.push(`  Deny write: ${report.osSandbox.resolved.filesystem?.denyWrite?.join(", ") || "(none)"}`);
	lines.push("");
	lines.push("Docker sandbox config:");
	lines.push("  Precedence: default → global → project");
	lines.push(...summarizeConfigFiles("  Global", report.dockerSandbox.global));
	lines.push(...summarizeConfigFiles("  Project", report.dockerSandbox.project));
	lines.push(`  Enabled by default: ${report.dockerSandbox.resolved.enabled !== false ? "yes" : "no"}`);
	lines.push(`  Image: ${report.dockerSandbox.resolved.image ?? "(none)"}`);
	lines.push(`  Network: ${report.dockerSandbox.resolved.network ?? "(none)"}`);
	lines.push(`  Folders: ${report.dockerSandbox.resolved.folders?.join(", ") || "(none)"}`);
	lines.push(`  Pass env: ${report.dockerSandbox.resolved.passEnv !== false ? "yes" : "no"}`);
	lines.push(
		`  Gitconfig: ${report.dockerSandbox.resolved.gitconfig === false ? "disabled" : (report.dockerSandbox.resolved.gitconfig ?? "(none)")}`,
	);
	lines.push("");
	lines.push("Relevant repo files:");
	for (const file of report.relevantFiles) {
		lines.push(`  - ${formatPathState("", file).slice(2)}`);
	}
	lines.push("");
	lines.push("Editing map:");
	lines.push("  - Docker sandbox launcher: scripts/pi-sandbox.mjs");
	lines.push(
		"  - Sandbox launch wrappers: .mise/tasks/pi/_default, .mise/tasks/pi/readonly, .mise/tasks/pi/shell, .mise/tasks/pi/yolo, .mise/tasks/pi/build",
	);
	lines.push(
		"  - Repo resource installers: .mise/tasks/pi/stow/install, .mise/tasks/pi/stow/uninstall, .mise/tasks/pi/stow/mise/install, .mise/tasks/pi/stow/mise/uninstall",
	);
	lines.push(
		"  - Extension sandbox example: .pi/extensions/sandbox.ts and packages/coding-agent/examples/extensions/sandbox/index.ts",
	);
	lines.push("  - Sandbox guide: packages/coding-agent/docs/sandboxing.md");
	return lines.join("\n");
}

export { DEFAULT_DOCKER_SANDBOX_CONFIG, DEFAULT_OS_SANDBOX_CONFIG };
