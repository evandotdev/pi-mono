import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { extractPlanBlock, extractPlanSteps, isSafeCommand, summarizePlan } from "./utils.js";

type PlanMode = "off" | "planning" | "approved";

interface PersistedPlanState {
	mode: PlanMode;
	anchorLeafId: string | null;
	approvedPlanText?: string;
	implementationTools?: string[];
}

interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
}

interface SessionMessageEntry extends SessionEntryBase {
	type: "message";
	message: AgentMessage;
}

interface SessionCustomEntry extends SessionEntryBase {
	type: "custom";
	customType: string;
	data?: unknown;
}

interface SessionCustomMessageEntry extends SessionEntryBase {
	type: "custom_message";
	customType: string;
	content: string | Array<{ type: string; text?: string }>;
}

const PLAN_STATE_ENTRY = "plan-mode";
const APPROVED_PLAN_CONTEXT = "approved-plan-context";
const PLANNING_PROMPT = `You are in plan mode.

This branch is for planning only.
- Do not modify files.
- Do not use mutating tools.
- You may inspect files, search the codebase, and use available research tools such as web search.
- Produce implementation proposals as a concrete numbered list under a \"Plan:\" header.
- Revise the plan when asked, but do not start implementation in this branch.`;

const APPROVED_PLANNING_PROMPT = `You are still in the planning branch.

An exact plan has been approved, but implementation has not started yet.
- Stay in planning mode on this branch.
- Refine the approved plan only if the user asks.
- Do not modify files from this branch.
- Use /plan implement to jump back to the anchor and start implementation from there.`;

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

function isMessageEntry(entry: unknown): entry is SessionMessageEntry {
	return typeof entry === "object" && entry !== null && "type" in entry && (entry as SessionEntryBase).type === "message";
}

function isCustomEntry(entry: unknown): entry is SessionCustomEntry {
	return typeof entry === "object" && entry !== null && "type" in entry && (entry as SessionEntryBase).type === "custom";
}

function isCustomMessageEntry(entry: unknown): entry is SessionCustomMessageEntry {
	return (
		typeof entry === "object" &&
		entry !== null &&
		"type" in entry &&
		(entry as SessionEntryBase).type === "custom_message"
	);
}

function isPersistedPlanState(value: unknown): value is PersistedPlanState {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<PersistedPlanState>;
	if (candidate.mode !== "off" && candidate.mode !== "planning" && candidate.mode !== "approved") return false;
	if (candidate.anchorLeafId !== null && typeof candidate.anchorLeafId !== "string") return false;
	if (candidate.approvedPlanText !== undefined && typeof candidate.approvedPlanText !== "string") return false;
	if (
		candidate.implementationTools !== undefined &&
		(!Array.isArray(candidate.implementationTools) || candidate.implementationTools.some((tool) => typeof tool !== "string"))
	) {
		return false;
	}
	return true;
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function getPlanningTools(toolNames: string[]): string[] {
	return toolNames.filter((toolName) => toolName !== "edit" && toolName !== "write");
}

function getLatestAssistantText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (!isMessageEntry(entry)) continue;
		if (!isAssistantMessage(entry.message)) continue;
		return getTextContent(entry.message);
	}
	return undefined;
}

function getLatestPersistedState(ctx: ExtensionContext): PersistedPlanState | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!isCustomEntry(entry)) continue;
		if (entry.customType !== PLAN_STATE_ENTRY) continue;
		if (!isPersistedPlanState(entry.data)) continue;
		return entry.data;
	}
	return undefined;
}

function resolveRootResetTargetId(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.getEntries();
	for (const entry of entries) {
		if (entry.parentId !== null) continue;
		if (isMessageEntry(entry) || isCustomMessageEntry(entry)) {
			return entry.id;
		}
	}
	return undefined;
}

function buildStatusLines(mode: PlanMode, anchorLeafId: string | null, approvedPlanText: string | undefined): string[] {
	const lines: string[] = [];
	if (mode === "planning") {
		lines.push("Plan branch active");
	} else if (mode === "approved") {
		lines.push("Approved plan ready");
	} else {
		return lines;
	}

	lines.push(`Anchor: ${anchorLeafId ?? "root"}`);
	if (approvedPlanText) {
		lines.push(summarizePlan(approvedPlanText));
		for (const step of extractPlanSteps(approvedPlanText)) {
			lines.push(`${step.step}. ${step.text}`);
		}
	}
	return lines;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let mode: PlanMode = "off";
	let anchorLeafId: string | null = null;
	let approvedPlanText: string | undefined;
	let implementationTools: string[] | undefined;

	pi.registerFlag("plan", {
		description: "Start in plan mode",
		type: "boolean",
		default: false,
	});

	function persistState(): void {
		pi.appendEntry(PLAN_STATE_ENTRY, {
			mode,
			anchorLeafId,
			approvedPlanText,
			implementationTools,
		} satisfies PersistedPlanState);
	}

	function getPlanningStatusText(ctx: ExtensionContext): string | undefined {
		const planningModel = ctx.getConfiguredModel?.("plan") ?? ctx.model;
		if (!planningModel) {
			return undefined;
		}
		return `Planning with (${planningModel.provider}) ${planningModel.id} • ${pi.getThinkingLevel()}`;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (mode === "off") {
			ctx.ui.setStatus("plan-mode", undefined);
			ctx.ui.setWidget("plan-mode", undefined);
			return;
		}

		const statusText = getPlanningStatusText(ctx);
		if (statusText) {
			const color = mode === "approved" ? "accent" : "warning";
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg(color, statusText));
		} else {
			const label =
				mode === "approved"
					? ctx.ui.theme.fg("accent", "plan approved")
					: ctx.ui.theme.fg("warning", "plan mode");
			ctx.ui.setStatus("plan-mode", label);
		}
		ctx.ui.setWidget("plan-mode", buildStatusLines(mode, anchorLeafId, approvedPlanText));
	}

	function enablePlanningTools(): void {
		const baseTools = implementationTools ?? pi.getActiveTools();
		pi.setActiveTools(getPlanningTools(baseTools));
	}

	function restoreImplementationTools(): void {
		if (!implementationTools) return;
		pi.setActiveTools(implementationTools);
	}

	function resetPlanState(): void {
		mode = "off";
		anchorLeafId = null;
		approvedPlanText = undefined;
		implementationTools = undefined;
	}

	function showStatus(ctx: ExtensionContext): void {
		const lines = buildStatusLines(mode, anchorLeafId, approvedPlanText);
		if (lines.length === 0) {
			ctx.ui.notify("Plan mode is off.", "info");
			return;
		}
		ctx.ui.notify(lines.join("\n"), "info");
	}

	async function startPlanning(ctx: ExtensionCommandContext): Promise<void> {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Wait for the agent to finish before starting plan mode.", "warning");
			return;
		}
		if (mode !== "off") {
			showStatus(ctx);
			return;
		}

		anchorLeafId = ctx.sessionManager.getLeafId();
		implementationTools = pi.getActiveTools();
		approvedPlanText = undefined;
		mode = "planning";
		enablePlanningTools();
		persistState();
		updateStatus(ctx);
		ctx.ui.notify("Plan mode enabled. Planning will stay on a branch from the current leaf.", "info");
	}

	async function approvePlan(ctx: ExtensionCommandContext): Promise<void> {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Wait for the agent to finish before approving a plan.", "warning");
			return;
		}
		if (mode === "off") {
			ctx.ui.notify("Start plan mode first with /plan.", "warning");
			return;
		}

		const latestAssistantText = getLatestAssistantText(ctx);
		if (!latestAssistantText) {
			ctx.ui.notify("No assistant response found on the current branch.", "warning");
			return;
		}

		const planBlock = extractPlanBlock(latestAssistantText);
		if (!planBlock) {
			ctx.ui.notify('The latest assistant response does not contain a "Plan:" block.', "warning");
			return;
		}

		const confirmed = await ctx.ui.confirm("Approve exact plan?", planBlock);
		if (!confirmed) {
			ctx.ui.notify("Plan approval cancelled.", "info");
			return;
		}

		approvedPlanText = planBlock;
		mode = "approved";
		enablePlanningTools();
		persistState();
		updateStatus(ctx);
		ctx.ui.notify(`Approved exact plan: ${summarizePlan(planBlock)}.`, "info");
	}

	async function navigateToAnchor(ctx: ExtensionCommandContext): Promise<boolean> {
		const targetId = anchorLeafId ?? resolveRootResetTargetId(ctx);
		if (!targetId) {
			ctx.ui.notify("Could not resolve the plan anchor in the current session tree.", "error");
			return false;
		}

		const result = await ctx.navigateTree(targetId, { summarize: false });
		if (result.cancelled) {
			ctx.ui.notify("Navigation to the plan anchor was cancelled.", "info");
			return false;
		}
		return true;
	}

	async function implementPlan(ctx: ExtensionCommandContext): Promise<void> {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Wait for the agent to finish before starting implementation.", "warning");
			return;
		}
		if (mode !== "approved" || !approvedPlanText) {
			ctx.ui.notify("Approve a plan first with /plan approve.", "warning");
			return;
		}

		const confirmed = await ctx.ui.confirm(
			"Start implementation?",
			"This will jump back to the saved anchor, restore implementation tools, and prefill the editor.",
		);
		if (!confirmed) {
			ctx.ui.notify("Implementation start cancelled.", "info");
			return;
		}

		const navigated = await navigateToAnchor(ctx);
		if (!navigated) return;

		restoreImplementationTools();
		pi.sendMessage(
			{
				customType: APPROVED_PLAN_CONTEXT,
				content: `Approved plan (verbatim):\n\n${approvedPlanText}`,
				display: false,
			},
			{ triggerTurn: false },
		);
		ctx.ui.setEditorText(
			"Implement the approved plan that was carried forward into this branch. Start with the first step and make the necessary changes.",
		);
		ctx.ui.notify("Returned to the anchor. Review the prefilled implementation prompt, then submit it.", "info");

		resetPlanState();
		persistState();
		updateStatus(ctx);
	}

	async function cancelPlan(ctx: ExtensionCommandContext): Promise<void> {
		if (mode === "off") {
			ctx.ui.notify("No active plan workflow.", "info");
			return;
		}
		if (!ctx.isIdle()) {
			ctx.ui.notify("Wait for the agent to finish before cancelling plan mode.", "warning");
			return;
		}

		const confirmed = await ctx.ui.confirm(
			"Cancel plan workflow?",
			"This clears the saved plan state and returns to the saved anchor.",
		);
		if (!confirmed) {
			ctx.ui.notify("Plan cancellation aborted.", "info");
			return;
		}

		await navigateToAnchor(ctx);
		restoreImplementationTools();
		resetPlanState();
		persistState();
		updateStatus(ctx);
		ctx.ui.notify("Plan workflow cleared.", "info");
	}

	pi.registerCommand("plan", {
		description: "Start or manage branch-based plan mode",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const [subcommand] = trimmed.split(/\s+/, 1);
			const command = subcommand?.toLowerCase() ?? "";

			if (command === "status") {
				showStatus(ctx);
				return;
			}
			if (command === "approve") {
				await approvePlan(ctx);
				return;
			}
			if (command === "implement") {
				await implementPlan(ctx);
				return;
			}
			if (command === "cancel") {
				await cancelPlan(ctx);
				return;
			}
			if (trimmed.length > 0) {
				ctx.ui.notify("Usage: /plan [status|approve|implement|cancel]", "warning");
				return;
			}

			if (mode === "off") {
				await startPlanning(ctx);
				return;
			}

			showStatus(ctx);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Start or inspect plan mode",
		handler: async (ctx) => {
			if (mode === "off") {
				await startPlanning(ctx);
				return;
			}
			showStatus(ctx);
		},
	});

	pi.on("tool_call", async (event) => {
		if (mode !== "planning" && mode !== "approved") return;

		if (event.toolName === "edit" || event.toolName === "write") {
			return {
				block: true,
				reason: `Plan mode blocks ${event.toolName}. Approve the plan and use /plan implement first.`,
			};
		}

		if (event.toolName !== "bash") return;
		const command = typeof event.input.command === "string" ? event.input.command : "";
		if (isSafeCommand(command)) return;
		return {
			block: true,
			reason: `Plan mode blocked a non-read-only bash command. Use /plan implement before making changes.\nCommand: ${command}`,
		};
	});

	pi.on("before_agent_start", async (event) => {
		if (mode === "planning") {
			return { systemPrompt: `${event.systemPrompt}\n\n${PLANNING_PROMPT}` };
		}
		if (mode === "approved") {
			return { systemPrompt: `${event.systemPrompt}\n\n${APPROVED_PLANNING_PROMPT}` };
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		const restored = getLatestPersistedState(ctx);
		if (restored) {
			mode = restored.mode;
			anchorLeafId = restored.anchorLeafId;
			approvedPlanText = restored.approvedPlanText;
			implementationTools = restored.implementationTools;
		}

		if (pi.getFlag("plan") === true && mode === "off") {
			mode = "planning";
			anchorLeafId = ctx.sessionManager.getLeafId();
			approvedPlanText = undefined;
			implementationTools = pi.getActiveTools();
			persistState();
		}

		if (mode === "planning" || mode === "approved") {
			enablePlanningTools();
		}
		updateStatus(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		if (mode === "planning" || mode === "approved") {
			updateStatus(ctx);
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		updateStatus(ctx);
	});
}
