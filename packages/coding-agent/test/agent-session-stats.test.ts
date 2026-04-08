import { Agent } from "@mariozechner/pi-agent-core";
import { type AssistantMessage, getModel, type Usage } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { createTestResourceLoader } from "./utilities.js";

const model = getModel("anthropic", "claude-sonnet-4-5")!;

function createUsage(totalTokens: number): Usage {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function createAssistantMessage(text: string, totalTokens: number, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(totalTokens),
		stopReason: "stop",
		timestamp,
	};
}

function createUserMessage(text: string, timestamp: number) {
	return {
		role: "user" as const,
		content: text,
		timestamp,
	};
}

function createSession() {
	const settingsManager = SettingsManager.inMemory();
	const sessionManager = SessionManager.inMemory();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const session = new AgentSession({
		agent: new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant.",
				tools: [],
				thinkingLevel: "high",
			},
		}),
		sessionManager,
		settingsManager,
		cwd: process.cwd(),
		modelRegistry: ModelRegistry.inMemory(authStorage),
		resourceLoader: createTestResourceLoader(),
	});

	return { session, sessionManager };
}

function syncAgentMessages(session: AgentSession, sessionManager: SessionManager): void {
	session.agent.state.messages = sessionManager.buildSessionContext().messages;
}

describe("AgentSession.getSessionStats", () => {
	it("counts system prompt tokens before first assistant usage", () => {
		const { session } = createSession();

		try {
			const usage = session.getContextUsage();
			const expected = Math.ceil(session.systemPrompt.length / 4);
			expect(usage?.tokens).toBe(expected);
			expect(usage?.contextWindow).toBe(model.contextWindow);
			expect(usage?.percent).toBe((expected / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("exposes the current context usage alongside token totals", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendMessage(createAssistantMessage("hi", 200, 2));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.contextUsage).toEqual(session.getContextUsage());
			expect(stats.contextUsage?.tokens).toBe(200);
			expect(stats.contextUsage?.contextWindow).toBe(model.contextWindow);
			expect(stats.contextUsage?.percent).toBe((200 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("reports unknown current context usage immediately after compaction", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(195_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBeNull();
			expect(stats.contextUsage?.percent).toBeNull();
		} finally {
			session.dispose();
		}
	});

	it("uses post-compaction usage for current context instead of stale kept usage", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("first", 1));
			sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
			const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
			sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
			sessionManager.appendCompaction("summary", keptUserId, 195_000);
			sessionManager.appendMessage(createUserMessage("third", 5));
			sessionManager.appendMessage(createAssistantMessage("response3", 25_000, 6));
			syncAgentMessages(session, sessionManager);

			const stats = session.getSessionStats();
			expect(stats.tokens.input).toBe(220_000);
			expect(stats.contextUsage).toBeDefined();
			expect(stats.contextUsage?.tokens).toBe(25_000);
			expect(stats.contextUsage?.percent).toBe((25_000 / model.contextWindow) * 100);
		} finally {
			session.dispose();
		}
	});

	it("provides source breakdown including extension context messages", () => {
		const { session, sessionManager } = createSession();

		try {
			sessionManager.appendMessage(createUserMessage("hello", 1));
			sessionManager.appendCustomMessageEntry("plan-mode-context", "extension context", true);
			syncAgentMessages(session, sessionManager);

			const breakdown = session.getContextSourceBreakdown();
			expect(breakdown).toBeDefined();
			expect(breakdown?.contributions.some((c) => c.id === "systemPromptBase")).toBe(true);
			expect(breakdown?.contributions.some((c) => c.id === "conversationMessages")).toBe(true);
			expect(breakdown?.contributions.some((c) => c.id === "extensionMessages")).toBe(true);
			const extensionType = breakdown?.extensionMessageTypes.find(
				(entry) => entry.customType === "plan-mode-context",
			);
			expect(extensionType?.messageCount).toBe(1);
			expect((extensionType?.tokens ?? 0) > 0).toBe(true);
		} finally {
			session.dispose();
		}
	});

	it("clears context in-place while preserving session identity", async () => {
		const { session, sessionManager } = createSession();

		try {
			const initialSessionId = session.sessionId;
			sessionManager.appendMessage(createUserMessage("before", 1));
			sessionManager.appendMessage(createAssistantMessage("response", 200, 2));
			syncAgentMessages(session, sessionManager);

			await session.clearContext();

			expect(session.sessionId).toBe(initialSessionId);
			expect(sessionManager.buildSessionContext().messages).toEqual([]);
			expect(session.messages).toEqual([]);
			const leaf = sessionManager.getLeafEntry();
			expect(leaf?.type).toBe("custom");
			if (leaf?.type === "custom") {
				expect(leaf.customType).toBe("pi:context_clear");
			}
		} finally {
			session.dispose();
		}
	});
});
