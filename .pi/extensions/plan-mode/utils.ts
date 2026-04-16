const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*exa\b/,
];

export interface PlanStep {
	step: number;
	text: string;
}

export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
	const isSafe = SAFE_PATTERNS.some((pattern) => pattern.test(command));
	return !isDestructive && isSafe;
}

export function extractPlanBlock(message: string): string | undefined {
	const lines = message.split(/\r?\n/);
	const headerIndex = lines.findIndex((line) => /^\s*(?:#+\s*)?\*{0,2}Plan:\*{0,2}\s*$/.test(line));
	if (headerIndex === -1) return undefined;

	const collected: string[] = [lines[headerIndex] ?? "Plan:"];
	let sawNumberedStep = false;
	let inCodeFence = false;

	for (let index = headerIndex + 1; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const trimmed = line.trim();

		if (trimmed.startsWith("```")) {
			collected.push(line);
			inCodeFence = !inCodeFence;
			continue;
		}

		if (inCodeFence) {
			collected.push(line);
			continue;
		}

		if (/^\s*$/.test(line)) {
			collected.push(line);
			continue;
		}

		if (/^\s*\d+[.)]\s+/.test(line)) {
			sawNumberedStep = true;
			collected.push(line);
			continue;
		}

		if (sawNumberedStep && /^\s{2,}\S/.test(line)) {
			collected.push(line);
			continue;
		}

		if (sawNumberedStep && /^\s*[-*+]\s+/.test(line)) {
			collected.push(line);
			continue;
		}

		break;
	}

	while (collected.length > 1 && collected[collected.length - 1]?.trim() === "") {
		collected.pop();
	}

	return sawNumberedStep ? collected.join("\n") : undefined;
}

export function extractPlanSteps(planBlock: string): PlanStep[] {
	const steps: PlanStep[] = [];
	for (const match of planBlock.matchAll(/^\s*(\d+)[.)]\s+(.+)$/gm)) {
		const step = Number(match[1]);
		const text = match[2]?.trim();
		if (!Number.isFinite(step) || !text) continue;
		steps.push({ step, text });
	}
	return steps;
}

export function summarizePlan(planBlock: string): string {
	const steps = extractPlanSteps(planBlock);
	if (steps.length === 0) return "No approved plan";
	if (steps.length === 1) return "1 approved step";
	return `${steps.length} approved steps`;
}
