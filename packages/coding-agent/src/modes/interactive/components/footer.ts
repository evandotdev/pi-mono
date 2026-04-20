import type { ProviderUsage } from "@mariozechner/pi-ai";
import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { getPackageDir, VERSION } from "../../../config.js";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";
import { theme } from "../theme/theme.js";

type GitSummary = {
	repoName: string;
	branch: string | null;
	linesAdded: number;
	linesRemoved: number;
	syncStatus: string;
};

let cachedPiVersionDisplay: string | null | undefined;

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts (similar to web-ui)
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatCost(totalCost: number): string {
	if (totalCost === 0) return "$0.00";
	if (totalCost < 0.01) return `${(totalCost * 100).toFixed(1)}¢`;
	return `$${totalCost.toFixed(2)}`;
}

function ansiFg(code: string, text: string): string {
	return `${code}${text}\x1b[39m`;
}

function white(text: string): string {
	return ansiFg("\x1b[37m", text);
}

function yellow(text: string): string {
	return ansiFg("\x1b[33m", text);
}

function green(text: string): string {
	return ansiFg("\x1b[32m", text);
}

function red(text: string): string {
	return ansiFg("\x1b[31m", text);
}

function joinSegments(segments: Array<string | undefined>, separator: string): string {
	return segments.filter((segment): segment is string => Boolean(segment && segment.length > 0)).join(separator);
}

function fitLeftAndAdjacentSuffix(left: string, suffix: string, width: number, separator: string): string {
	const ellipsis = theme.fg("dim", "...");

	if (!left && !suffix) return "";
	if (!suffix) return truncateToWidth(left, width, ellipsis);
	if (!left) return truncateToWidth(suffix, width, ellipsis);

	const suffixWidth = visibleWidth(suffix);
	const separatorWidth = visibleWidth(separator);
	if (suffixWidth >= width) {
		return truncateToWidth(suffix, width, ellipsis);
	}

	const availableForLeft = width - separatorWidth - suffixWidth;
	if (availableForLeft <= 0) {
		return truncateToWidth(suffix, width, ellipsis);
	}

	const fittedLeft = truncateToWidth(left, availableForLeft, ellipsis);
	return `${fittedLeft}${separator}${suffix}`;
}

function runGitCommand(repoDir: string, args: string[]): string | null {
	const result = spawnSync("git", ["--no-optional-locks", ...args], {
		cwd: repoDir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) return null;
	const output = result.stdout.trim();
	return output || null;
}

function runGitCommandSuccess(repoDir: string, args: string[]): boolean {
	const result = spawnSync("git", ["--no-optional-locks", ...args], {
		cwd: repoDir,
		encoding: "utf8",
		stdio: ["ignore", "ignore", "ignore"],
	});
	return result.status === 0;
}

function findGitRepoInfo(startDir: string): { repoDir: string; repoName: string } | null {
	let dir = startDir;
	while (true) {
		const gitPath = join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				if (stat.isDirectory()) {
					return { repoDir: dir, repoName: basename(dir) || dir };
				}
				if (stat.isFile()) {
					const content = readFileSync(gitPath, "utf8").trim();
					if (content.startsWith("gitdir: ")) {
						const gitDir = resolve(dir, content.slice(8).trim());
						const commonDirPath = join(gitDir, "commondir");
						const commonGitDir = existsSync(commonDirPath)
							? resolve(gitDir, readFileSync(commonDirPath, "utf8").trim())
							: gitDir;
						const repoName = basename(dirname(commonGitDir)) || basename(dir) || dir;
						return { repoDir: dir, repoName };
					}
				}
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function isPiMonoRepoRoot(dir: string): boolean {
	const rootPackageJsonPath = join(dir, "package.json");
	if (
		!existsSync(rootPackageJsonPath) ||
		!existsSync(join(dir, "packages", "ai", "package.json")) ||
		!existsSync(join(dir, "packages", "coding-agent", "package.json"))
	) {
		return false;
	}

	try {
		const packageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as { name?: string };
		return packageJson.name === "pi-monorepo";
	} catch {
		return false;
	}
}

function findPiMonoRepoRoot(startDir: string): string | null {
	let dir = startDir;
	while (true) {
		if (isPiMonoRepoRoot(dir)) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function resolveBaseBranch(repoDir: string): string | null {
	if (runGitCommandSuccess(repoDir, ["show-ref", "--verify", "--quiet", "refs/heads/main"])) {
		return "main";
	}
	if (runGitCommandSuccess(repoDir, ["show-ref", "--verify", "--quiet", "refs/heads/master"])) {
		return "master";
	}
	return null;
}

function parseShortStat(diffStats: string): { linesAdded: number; linesRemoved: number } {
	const linesAddedMatch = diffStats.match(/(\d+)\s+insertion/);
	const linesRemovedMatch = diffStats.match(/(\d+)\s+deletion/);
	return {
		linesAdded: linesAddedMatch ? Number.parseInt(linesAddedMatch[1], 10) : 0,
		linesRemoved: linesRemovedMatch ? Number.parseInt(linesRemovedMatch[1], 10) : 0,
	};
}

function resolveGitSummary(cwd: string, branch: string | null): GitSummary | null {
	const repoInfo = findGitRepoInfo(cwd);
	if (!repoInfo || !branch) return null;

	const baseBranch = resolveBaseBranch(repoInfo.repoDir);
	const diffTarget = baseBranch && branch !== "detached" && branch !== baseBranch ? `${baseBranch}...HEAD` : "HEAD";
	const diffStats = runGitCommand(repoInfo.repoDir, ["diff", "--shortstat", diffTarget]) ?? "";
	const { linesAdded, linesRemoved } = parseShortStat(diffStats);

	let syncStatus = "";
	const upstream = runGitCommand(repoInfo.repoDir, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
	if (upstream) {
		const counts = runGitCommand(repoInfo.repoDir, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
		if (counts) {
			const [aheadRaw = "0", behindRaw = "0"] = counts.split(/\s+/);
			const ahead = Number.parseInt(aheadRaw, 10) || 0;
			const behind = Number.parseInt(behindRaw, 10) || 0;
			if (ahead === 0 && behind === 0) syncStatus = "✓";
			else if (ahead > 0 && behind === 0) syncStatus = `↑${ahead}`;
			else if (ahead === 0 && behind > 0) syncStatus = `↓${behind}`;
			else syncStatus = `↑${ahead}↓${behind}`;
		}
	}

	return {
		repoName: repoInfo.repoName,
		branch,
		linesAdded,
		linesRemoved,
		syncStatus,
	};
}

function getPiVersionDisplay(): string | null {
	if (cachedPiVersionDisplay !== undefined) {
		return cachedPiVersionDisplay;
	}

	const repoRoot = findPiMonoRepoRoot(getPackageDir());
	if (!repoRoot) {
		cachedPiVersionDisplay = `v${VERSION}`;
		return cachedPiVersionDisplay;
	}

	const tag = runGitCommand(repoRoot, ["describe", "--tags", "--abbrev=0"]);
	const shortHash = runGitCommand(repoRoot, ["rev-parse", "--short", "HEAD"]);
	if (tag && shortHash) {
		cachedPiVersionDisplay = `${tag} ${shortHash}`;
		return cachedPiVersionDisplay;
	}
	if (tag) {
		cachedPiVersionDisplay = tag;
		return cachedPiVersionDisplay;
	}
	if (shortHash) {
		cachedPiVersionDisplay = `v${VERSION} ${shortHash}`;
		return cachedPiVersionDisplay;
	}

	cachedPiVersionDisplay = `v${VERSION}`;
	return cachedPiVersionDisplay;
}

function buildContextBar(percent: number): string {
	const clampedPercent = Math.max(0, Math.min(100, percent));
	const filled = "\x1b[38;5;245m█\x1b[39m";
	const partial = "\x1b[38;5;245m▄\x1b[39m";
	const empty = "\x1b[38;5;238m░\x1b[39m";
	let bar = "";

	for (let i = 0; i < 10; i++) {
		const bucketStart = i * 10;
		const progress = clampedPercent - bucketStart;
		if (progress >= 8) {
			bar += filled;
		} else if (progress >= 3) {
			bar += partial;
		} else {
			bar += empty;
		}
	}

	return bar;
}

function formatResetCountdown(resetsAt: number): string | null {
	const remainingMs = resetsAt - Date.now();
	if (remainingMs <= 0) return null;
	const hours = Math.floor(remainingMs / 3600000);
	const minutes = Math.floor((remainingMs % 3600000) / 60000);
	return hours > 0 ? `↻${hours}h${minutes}m` : `↻${minutes}m`;
}

/**
 * Colorize OAuth provider utilization percentage based on utilization.
 * - 0-30%: green
 * - 30-50%: light yellow
 * - > 50%: yellow (warning)
 * - >= 70%: orange
 * - > 95%: red
 */
function colorizePercent(percentText: string, utilizationPercent: number): string {
	if (utilizationPercent > 95) {
		return red(percentText);
	}
	if (utilizationPercent >= 70) {
		const orange = theme.getColorMode() === "truecolor" ? "\x1b[38;2;255;149;0m" : "\x1b[38;5;208m";
		return `${orange}${percentText}\x1b[39m`;
	}
	if (utilizationPercent > 50) {
		return yellow(percentText);
	}
	if (utilizationPercent > 30) {
		const lightYellow = theme.getColorMode() === "truecolor" ? "\x1b[38;2;255;245;157m" : "\x1b[38;5;229m";
		return `${lightYellow}${percentText}\x1b[39m`;
	}
	return green(percentText);
}

type UsageWindow = ProviderUsage["windows"][string];

function isDurationWindowName(windowName: string): boolean {
	return /^\d+(?:m|h|d|w)$/i.test(windowName.trim());
}

function getDurationUsageWindows(currentUsage: ProviderUsage): Array<[string, UsageWindow]> {
	return Object.entries(currentUsage.windows)
		.filter(([windowName]) => isDurationWindowName(windowName))
		.sort((a, b) => {
			const resetA = a[1].resetsAt ?? Number.MAX_SAFE_INTEGER;
			const resetB = b[1].resetsAt ?? Number.MAX_SAFE_INTEGER;
			if (resetA !== resetB) return resetA - resetB;
			return a[0].localeCompare(b[0]);
		});
}

function formatCompactUsageSegment(
	currentUsage: ProviderUsage | undefined,
	label: (text: string) => string,
): string | undefined {
	if (!currentUsage) return undefined;

	const windows = getDurationUsageWindows(currentUsage);
	if (windows.length === 0) return undefined;

	const usageParts = windows.map(([windowName, window]) => {
		const percentText = colorizePercent(`${Math.round(window.utilizationPercent)}%`, window.utilizationPercent);
		return `${percentText}${theme.fg("dim", `/${windowName}`)}`;
	});

	const soonestReset = windows
		.map(([, window]) => window.resetsAt)
		.filter((resetsAt): resetsAt is number => resetsAt !== undefined)
		.sort((a, b) => a - b)[0];
	const resetText = soonestReset !== undefined ? formatResetCountdown(soonestReset) : null;
	const usageValue = `${usageParts.join(" ")}${resetText ? ` ${theme.fg("dim", resetText)}` : ""}`;
	return `${label("usage")}${usageValue}`;
}

/**
 * Footer component that shows git/session/model/usage on the first line,
 * cwd/context/tokens/cost on the second, pi on the third,
 * and extension statuses on separate rows below.
 */
export class FooterComponent implements Component {
	private static readonly GIT_SUMMARY_TTL_MS = 1500;

	private autoCompactEnabled = true;
	private cachedGitSummary: GitSummary | null | undefined = undefined;
	private cachedGitSummaryKey: string | undefined;
	private cachedGitSummaryAt = 0;

	constructor(
		private session: AgentSession,
		private footerData: ReadonlyFooterDataProvider,
	) {}

	setSession(session: AgentSession): void {
		this.session = session;
		this.invalidate();
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	invalidate(): void {
		this.cachedGitSummary = undefined;
		this.cachedGitSummaryKey = undefined;
		this.cachedGitSummaryAt = 0;
	}

	dispose(): void {
		this.invalidate();
	}

	private getGitSummary(cwd: string, branch: string | null): GitSummary | null {
		const cacheKey = `${cwd}\u0000${branch ?? ""}`;
		const now = Date.now();
		if (
			this.cachedGitSummaryKey === cacheKey &&
			this.cachedGitSummary !== undefined &&
			now - this.cachedGitSummaryAt < FooterComponent.GIT_SUMMARY_TTL_MS
		) {
			return this.cachedGitSummary;
		}

		const summary = resolveGitSummary(cwd, branch);
		this.cachedGitSummary = summary;
		this.cachedGitSummaryKey = cacheKey;
		this.cachedGitSummaryAt = now;
		return summary;
	}

	render(width: number): string[] {
		void this.autoCompactEnabled;
		const state = this.session.state;
		const separator = ` ${theme.fg("dim", "│")} `;
		const label = (text: string): string => theme.fg("dim", `${text.toLowerCase()}:`);

		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;
			}
		}

		const contextUsage = this.session.getContextUsage();
		let contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		let contextPercentValue: number | null = contextUsage?.percent ?? null;
		let usingEstimatedFallback = false;
		if (contextPercentValue === null) {
			const breakdown = this.session.getContextSourceBreakdown();
			if (breakdown?.estimatedPercent !== null && breakdown?.estimatedPercent !== undefined) {
				contextPercentValue = breakdown.estimatedPercent;
				contextWindow = breakdown.contextWindow;
				usingEstimatedFallback = true;
			}
		}

		const cwd = this.session.sessionManager.getCwd();
		const cwdBase = basename(cwd) || cwd;
		const branch = this.footerData.getGitBranch();
		const gitSummary = this.getGitSummary(cwd, branch);
		const sessionId = this.session.sessionManager.getSessionId();
		const sessionName = this.session.sessionManager.getSessionName();
		const shortSessionId = sessionId.slice(0, 8);

		const modelName = state.model?.id || "no-model";
		let modelInfoWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			modelInfoWithoutProvider =
				thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}
		const modelInfo = state.model
			? `${theme.fg("dim", `(${state.model.provider})`)} ${white(modelInfoWithoutProvider)}`
			: white(modelInfoWithoutProvider);

		let gitSegment: string | undefined;
		if (gitSummary) {
			let gitValue = white(gitSummary.repoName);
			if (gitSummary.branch) {
				gitValue += white(` (${gitSummary.branch})`);
			}

			const gitParts: string[] = [];
			if (gitSummary.linesAdded > 0 || gitSummary.linesRemoved > 0) {
				gitParts.push(`${green(`+${gitSummary.linesAdded}`)}/${red(`-${gitSummary.linesRemoved}`)}`);
			}
			if (gitSummary.syncStatus) {
				gitParts.push(theme.fg("dim", gitSummary.syncStatus));
			}
			if (gitParts.length > 0) {
				gitValue += ` ${gitParts.join(" ")}`;
			}
			gitSegment = `${label("git")}${gitValue}`;
		}

		const cwdSegment = `${label("cwd")}${white(cwdBase)}`;
		const sessionValue = sessionName ? white(`${sessionName} (${shortSessionId})`) : white(shortSessionId);
		const sessionSegment = `${label("sesh")}${sessionValue}`;

		const clampedContextPercent = Math.max(0, Math.min(100, contextPercentValue ?? 0));
		const contextPercentText =
			contextPercentValue === null
				? "?"
				: `${usingEstimatedFallback ? "~" : ""}${Math.floor(clampedContextPercent)}%`;
		const contextPercentDisplay =
			contextPercentValue === null
				? theme.fg("dim", contextPercentText)
				: colorizePercent(contextPercentText, clampedContextPercent);
		const contextSegment = `${label("ctx")}${buildContextBar(clampedContextPercent)} ${contextPercentDisplay} ${theme.fg("dim", `of ${formatTokens(contextWindow)}`)}`;

		const currentProvider = state.model?.provider;
		const providerUsage = this.footerData.getProviderUsage();
		const currentUsage = currentProvider ? providerUsage.get(currentProvider) : undefined;
		const usageSegment = formatCompactUsageSegment(currentUsage, label);

		const line1Left = joinSegments([gitSegment, sessionSegment, modelInfo], separator);
		const line1 = usageSegment
			? fitLeftAndAdjacentSuffix(line1Left, usageSegment, width, separator)
			: truncateToWidth(line1Left, width, theme.fg("dim", "..."));

		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		const costValue = `${theme.fg("dim", formatCost(totalCost))}${usingSubscription ? theme.fg("dim", " (sub)") : ""}`;
		const costSegment = `${label("cost")}${costValue}`;
		const tokensValue = `in ${formatTokens(totalInput)} out ${formatTokens(totalOutput)} cache R${formatTokens(totalCacheRead)}/W${formatTokens(totalCacheWrite)}`;
		const tokensSegment = `${label("tokens")}${theme.fg("dim", tokensValue)}`;
		const line2 = truncateToWidth(
			joinSegments([cwdSegment, contextSegment, tokensSegment, costSegment], separator),
			width,
			theme.fg("dim", "..."),
		);

		const extensionStatuses = this.footerData.getExtensionStatuses();
		const piVersionDisplay = getPiVersionDisplay();
		const piSegment = piVersionDisplay ? `${label("pi")}${theme.fg("dim", piVersionDisplay)}` : "";
		const line3 = truncateToWidth(piSegment, width, theme.fg("dim", "..."));

		const lines = [line1, line2, line3];

		const statusLines = Array.from(extensionStatuses.values())
			.filter((text): text is string => text !== undefined)
			.map((text) => sanitizeStatusText(text))
			.filter((text) => text.length > 0);

		for (const statusLine of statusLines) {
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
