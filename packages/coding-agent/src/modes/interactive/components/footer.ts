import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";
import { theme } from "../theme/theme.js";

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
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

/**
 * Colorize OAuth provider utilization percentage based on utilization.
 * - 0-30%: green
 * - 30-50%: light yellow
 * - > 50%: yellow (warning)
 * - >= 70%: orange
 * - > 95%: red
 */
function colorizeProviderUsagePercent(percentText: string, utilizationPercent: number): string {
	if (utilizationPercent > 95) {
		return theme.fg("error", percentText);
	}
	if (utilizationPercent >= 70) {
		// Orange between warning and error (truecolor when available, fallback to ANSI-256 orange)
		const orange = theme.getColorMode() === "truecolor" ? "\x1b[38;2;255;149;0m" : "\x1b[38;5;208m";
		return `${orange}${percentText}\x1b[39m`;
	}
	if (utilizationPercent > 50) {
		return theme.fg("warning", percentText);
	}
	if (utilizationPercent > 30) {
		const lightYellow = theme.getColorMode() === "truecolor" ? "\x1b[38;2;255;245;157m" : "\x1b[38;5;229m";
		return `${lightYellow}${percentText}\x1b[39m`;
	}
	return theme.fg("success", percentText);
}

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;

	constructor(
		private session: AgentSession,
		private footerData: ReadonlyFooterDataProvider,
	) {}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const state = this.session.state;

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
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

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Replace home directory with ~
		let pwd = this.session.sessionManager.getCwd();
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home && pwd.startsWith(home)) {
			pwd = `~${pwd.slice(home.length)}`;
		}

		// Add git branch if available
		const branch = this.footerData.getGitBranch();
		if (branch) {
			pwd = `${pwd} (${branch})`;
		}

		// Add session id and name
		const sessionId = this.session.sessionManager.getSessionId();
		const sessionName = this.session.sessionManager.getSessionName();
		const shortSessionId = sessionId.slice(0, 8);
		pwd = sessionName ? `${pwd} • ${sessionName} (${shortSessionId})` : `${pwd} • ${shortSessionId}`;

		// Build stats line
		const statsParts = [];
		if (totalInput) statsParts.push(`in ${formatTokens(totalInput)}`);
		if (totalOutput) statsParts.push(`out ${formatTokens(totalOutput)}`);
		if (totalCacheRead || totalCacheWrite) {
			statsParts.push(`cache R${formatTokens(totalCacheRead)}/W${formatTokens(totalCacheWrite)}`);
		}

		// Show cost with "(sub)" indicator if using OAuth subscription
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		if (totalCost || usingSubscription) {
			statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
		}

		// Show usage for the current model's OAuth provider only (e.g. Anthropic).
		// Render all known windows, sorted by soonest reset, in the form: 23%/5h 61%/7d  reset 3h11m
		const currentProvider = state.model?.provider;
		const providerUsage = this.footerData.getProviderUsage();
		const currentUsage = currentProvider ? providerUsage.get(currentProvider) : undefined;
		if (currentUsage) {
			const windows = Object.entries(currentUsage.windows).sort((a, b) => {
				const resetA = a[1].resetsAt ?? Number.MAX_SAFE_INTEGER;
				const resetB = b[1].resetsAt ?? Number.MAX_SAFE_INTEGER;
				if (resetA !== resetB) return resetA - resetB;
				return a[0].localeCompare(b[0]);
			});
			if (windows.length > 0) {
				const usageParts = windows.map(([windowName, window]) => {
					const pct = Math.round(window.utilizationPercent);
					const coloredPct = colorizeProviderUsagePercent(`${pct}%`, window.utilizationPercent);
					return `${coloredPct}/${windowName}`;
				});

				const withReset = [...windows]
					.map(([, window]) => window)
					.filter((window) => window.resetsAt !== undefined)
					.sort((a, b) => (a.resetsAt! < b.resetsAt! ? -1 : 1));
				const soonestReset = withReset[0];

				let usageSummary = usageParts.join(" ");
				if (soonestReset?.resetsAt !== undefined) {
					const remainingMs = soonestReset.resetsAt - Date.now();
					if (remainingMs > 0) {
						const h = Math.floor(remainingMs / 3600000);
						const m = Math.floor((remainingMs % 3600000) / 60000);
						const resetText = h > 0 ? `reset ${h}h${m}m` : `reset ${m}m`;
						usageSummary += `  ${resetText}`;
					}
				}

				statsParts.push(usageSummary);
			}
		}

		// Colorize context percentage based on usage
		let contextPercentStr: string;
		const autoIndicator = this.autoCompactEnabled ? " (auto)" : "";
		const contextPercentDisplay =
			contextPercent === "?"
				? `?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		if (contextPercent === "?") {
			contextPercentStr = contextPercentDisplay;
		} else if (contextPercentValue > 90) {
			contextPercentStr = theme.fg("error", contextPercentDisplay);
		} else if (contextPercentValue > 70) {
			contextPercentStr = theme.fg("warning", contextPercentDisplay);
		} else if (contextPercentValue > 50) {
			contextPercentStr = contextPercentDisplay;
		} else if (contextPercentValue > 30) {
			const lightYellow = theme.getColorMode() === "truecolor" ? "\x1b[38;2;255;245;157m" : "\x1b[38;5;229m";
			contextPercentStr = `${lightYellow}${contextPercentDisplay}\x1b[39m`;
		} else {
			contextPercentStr = theme.fg("success", contextPercentDisplay);
		}
		statsParts.push(contextPercentStr);

		let statsLeft = statsParts.join(" ");

		// Add model name on the right side, plus thinking level if model supports it
		const modelName = state.model?.id || "no-model";

		let statsLeftWidth = visibleWidth(statsLeft);

		// If statsLeft is too wide, truncate it
		if (statsLeftWidth > width) {
			statsLeft = truncateToWidth(statsLeft, width, "...");
			statsLeftWidth = visibleWidth(statsLeft);
		}

		// Calculate available space for padding (minimum 2 spaces between stats and model)
		const minPadding = 2;

		// Add thinking level indicator if model supports reasoning
		let rightSideWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSideWithoutProvider =
				thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}

		// Prepend the provider in parentheses if there are multiple providers and there's enough room
		let rightSide = rightSideWithoutProvider;
		if (this.footerData.getAvailableProviderCount() > 1 && state.model) {
			rightSide = `(${state.model!.provider}) ${rightSideWithoutProvider}`;
			if (statsLeftWidth + minPadding + visibleWidth(rightSide) > width) {
				// Too wide, fall back
				rightSide = rightSideWithoutProvider;
			}
		}

		const rightSideWidth = visibleWidth(rightSide);
		const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

		let statsLine: string;
		if (totalNeeded <= width) {
			// Both fit - add padding to right-align model
			const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
			statsLine = statsLeft + padding + rightSide;
		} else {
			// Need to truncate right side
			const availableForRight = width - statsLeftWidth - minPadding;
			if (availableForRight > 0) {
				const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
				const truncatedRightWidth = visibleWidth(truncatedRight);
				const padding = " ".repeat(Math.max(0, width - statsLeftWidth - truncatedRightWidth));
				statsLine = statsLeft + padding + truncatedRight;
			} else {
				// Not enough space for right side at all
				statsLine = statsLeft;
			}
		}

		// Apply dim to each part separately. statsLeft may contain color codes (for context %)
		// that end with a reset, which would clear an outer dim wrapper. So we dim the parts
		// before and after the colored section independently.
		const dimStatsLeft = theme.fg("dim", statsLeft);
		const remainder = statsLine.slice(statsLeft.length); // padding + rightSide
		const dimRemainder = theme.fg("dim", remainder);

		const pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
		const lines = [pwdLine, dimStatsLeft + dimRemainder];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
