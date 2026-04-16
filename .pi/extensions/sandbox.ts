import { existsSync, statSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { collectSandboxReport, formatSandboxReport, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

interface SandboxMount {
	hostPath: string;
	containerPath: string;
}

interface SandboxSnapshot {
	enabled: boolean;
	status: "enabled" | "disabled";
	mode: string;
	runtime: string;
	image: string;
	network: string;
	folders: string[];
	mounts: SandboxMount[];
	reason?: string;
	launcher?: string;
}

function parseEnvBoolean(value: string | undefined): boolean {
	if (!value) return false;
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseFolders(value: string | undefined, fallback: string): string[] {
	if (!value) return [fallback];
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return [fallback];
		const folders = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
		return folders.length > 0 ? folders : [fallback];
	} catch {
		return [fallback];
	}
}

function isSandboxMount(value: unknown): value is SandboxMount {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.hostPath === "string" && typeof record.containerPath === "string";
}

function parseMounts(value: string | undefined): SandboxMount[] {
	if (!value) return [];
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		const mounts = parsed.filter(isSandboxMount);
		return mounts.length > 0 ? mounts : [];
	} catch {
		return [];
	}
}

function readSnapshot(cwd: string): SandboxSnapshot {
	const enabled = parseEnvBoolean(process.env.PI_SANDBOX_ENABLED);
	const mode = process.env.PI_SANDBOX_MODE ?? "docker";
	const runtime = process.env.PI_SANDBOX_RUNTIME ?? "docker";
	const image = process.env.PI_SANDBOX_IMAGE ?? "pi-sandbox:latest";
	const network = process.env.PI_SANDBOX_NETWORK ?? "none";
	const launcher = process.env.PI_SANDBOX_LAUNCHER;
	const reason = process.env.PI_SANDBOX_REASON;
	const folders = parseFolders(process.env.PI_SANDBOX_FOLDERS, cwd);
	const mounts = parseMounts(process.env.PI_SANDBOX_MOUNTS);

	return {
		enabled,
		status: enabled ? "enabled" : "disabled",
		mode,
		runtime,
		image,
		network,
		folders,
		mounts,
		reason,
		launcher,
	};
}

function formatSnapshot(snapshot: SandboxSnapshot): string {
	const lines = [
		`Docker sandbox: ${snapshot.status}`,
		`  Mode: ${snapshot.mode}`,
		`  Runtime: ${snapshot.runtime}`,
		`  Image: ${snapshot.image}`,
		`  Network: ${snapshot.network}`,
	];

	if (snapshot.reason) lines.push(`  Reason: ${snapshot.reason}`);
	if (snapshot.launcher) lines.push(`  Launcher: ${snapshot.launcher}`);

	if (snapshot.mounts.length > 0) {
		lines.push("  Sandbox mounts:");
		for (const mount of snapshot.mounts) {
			lines.push(`    - ${mount.hostPath} -> ${mount.containerPath}`);
		}
	} else {
		lines.push("  Sandbox folders:");
		for (const folder of snapshot.folders) {
			lines.push(`    - ${folder}`);
		}
	}

	return lines.join("\n");
}

function pathType(targetPath: string): "dir" | "file" | "missing" {
	if (!existsSync(targetPath)) return "missing";
	try {
		const stats = statSync(targetPath);
		if (stats.isDirectory()) return "dir";
		if (stats.isFile()) return "file";
		return "missing";
	} catch {
		return "missing";
	}
}

function formatCheck(label: string, targetPath: string, expected: "dir" | "file", required: boolean): string {
	const actual = pathType(targetPath);
	const ok = actual === expected;
	const status = ok ? "OK" : required ? "MISSING" : "OPTIONAL-MISSING";
	const note = required ? "required" : "optional";
	return `  [${status}] ${label}: ${targetPath} (${note})`;
}

function findNearestProjectPiRoot(startDir: string): string | undefined {
	let current = startDir;
	while (true) {
		const candidate = join(current, ".pi");
		if (pathType(candidate) === "dir") return candidate;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function buildVerificationChecks(cwd: string): string[] {
	const checks: string[] = [];
	checks.push("Verification:");
	checks.push(`  CWD: ${cwd}`);

	const projectPiRoot = findNearestProjectPiRoot(cwd);
	if (projectPiRoot) {
		checks.push(`  Project .pi root: ${projectPiRoot}`);
		checks.push(formatCheck("Project extensions", join(projectPiRoot, "extensions"), "dir", false));
		checks.push(formatCheck("Project prompts", join(projectPiRoot, "prompts"), "dir", false));
		checks.push(formatCheck("Project skills", join(projectPiRoot, "skills"), "dir", false));
		checks.push(formatCheck("Project themes", join(projectPiRoot, "themes"), "dir", false));
		checks.push(formatCheck("Project .pi/docker-sandbox.json", join(projectPiRoot, "docker-sandbox.json"), "file", false));
		checks.push(formatCheck("Project .pi/gitconfig", join(projectPiRoot, "gitconfig"), "file", false));
		checks.push(formatCheck("Project package git cache", join(projectPiRoot, "git"), "dir", false));
		checks.push(formatCheck("Project package npm cache", join(projectPiRoot, "npm"), "dir", false));
	} else {
		checks.push("  [MISSING] Project .pi root: none found from current directory upward");
	}

	const agentDir = process.env.PI_CODING_AGENT_DIR ?? getAgentDir();
	checks.push(`  Global agent dir: ${agentDir}`);
	checks.push(formatCheck("Global agent root", agentDir, "dir", true));
	checks.push(formatCheck("Global auth.json", join(agentDir, "auth.json"), "file", false));
	checks.push(formatCheck("Global sessions", join(agentDir, "sessions"), "dir", true));
	checks.push(formatCheck("Global extensions", join(agentDir, "extensions"), "dir", false));
	checks.push(formatCheck("Global prompts", join(agentDir, "prompts"), "dir", false));
	checks.push(formatCheck("Global skills", join(agentDir, "skills"), "dir", false));
	checks.push(formatCheck("Global themes", join(agentDir, "themes"), "dir", false));
	checks.push(formatCheck("Global settings.json", join(agentDir, "settings.json"), "file", false));
	checks.push(formatCheck("Global keybindings.json", join(agentDir, "keybindings.json"), "file", false));
	checks.push(formatCheck("Global package git cache", join(agentDir, "git"), "dir", false));
	checks.push(formatCheck("Global package npm cache", join(agentDir, "npm"), "dir", false));

	const agentsSkillsDir = join(os.homedir(), ".agents", "skills");
	checks.push(formatCheck("Agent Skills standard (~/.agents/skills)", agentsSkillsDir, "dir", false));

	return checks;
}

function buildSandboxInspectionReport(cwd: string): string {
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? getAgentDir();
	return formatSandboxReport(collectSandboxReport({ cwd, agentDir, homeDir: os.homedir() }));
}

export default function (pi: ExtensionAPI) {
	let snapshot = readSnapshot(process.cwd());

	const publishStartupStatus = (ctx: ExtensionContext) => {
		const level = snapshot.enabled ? "info" : "warning";
		if (snapshot.enabled) {
			const mountCount = snapshot.mounts.length > 0 ? snapshot.mounts.length : snapshot.folders.length;
			const mountLabel = snapshot.mounts.length > 0 ? "mounts" : "folders";
			ctx.ui.setStatus(
				"sandbox",
				ctx.ui.theme.fg("accent", `sandbox: ${snapshot.image} (${mountCount} ${mountLabel})`),
			);
		} else {
			ctx.ui.setStatus("sandbox", undefined);
		}
		ctx.ui.notify(formatSnapshot(snapshot), level);
	};

	pi.on("session_start", async (_event, ctx) => {
		snapshot = readSnapshot(ctx.cwd);
		publishStartupStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("sandbox", undefined);
	});

	pi.registerCommand("sandbox", {
		description: "Show Docker sandbox status, mount mappings, and resource checks",
		handler: async (_args, ctx) => {
			snapshot = readSnapshot(ctx.cwd);
			const projectPiRoot = findNearestProjectPiRoot(ctx.cwd);
			const projectConfigPath = projectPiRoot
				? join(projectPiRoot, "docker-sandbox.json")
				: join(ctx.cwd, ".pi", "docker-sandbox.json");
			const lines = [
				formatSnapshot(snapshot),
				"",
				"Config files:",
				`  Project: ${projectConfigPath}`,
				`  Global: ${join(getAgentDir(), "extensions", "docker-sandbox.json")}`,
				"",
				...buildVerificationChecks(ctx.cwd),
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	const sandboxInfoHandler = async (_args: string, ctx: ExtensionContext) => {
		ctx.ui.notify(buildSandboxInspectionReport(ctx.cwd), "info");
	};

	pi.registerCommand("sandbox:info", {
		description: "Show sandbox topology, config precedence, and repo file map",
		handler: sandboxInfoHandler,
	});

	pi.registerCommand("doctor:sandbox", {
		description: "Show sandbox topology, config precedence, and repo file map",
		handler: sandboxInfoHandler,
	});
}
