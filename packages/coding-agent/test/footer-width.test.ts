import { visibleWidth } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.js";
import { FooterComponent } from "../src/modes/interactive/components/footer.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
}): AgentSession {
	const usage = options.usage;
	const entries =
		usage === undefined
			? []
			: [
					{
						type: "message",
						message: {
							role: "assistant",
							usage,
						},
					},
				];

	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
			getSessionId: () => "12345678-1234-1234-1234-1234567890ab",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
		modelRegistry: {
			isUsingOAuth: () => false,
		},
	};

	return session as unknown as AgentSession;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function createFooterData(providerCount: number): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
		getProviderUsage: () => new Map(),
		onUsageChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("renders provider/model/thinking on first line and keeps all lines within width", () => {
		const width = 70;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(10),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}

		const plainFirstLine = stripAnsi(lines[0]);
		expect(plainFirstLine).toContain("(공급자)");
		expect(plainFirstLine).toContain("high");

		const plainSecondLine = stripAnsi(lines[1]);
		expect(plainSecondLine).not.toContain("공급자");
		expect(plainSecondLine).not.toContain("high");
	});

	it("keeps the context summary visible when stats are truncated", () => {
		const width = 44;
		const session = createSession({
			sessionName: "",
			modelId: "very-long-model-name-for-truncation",
			provider: "test",
			usage: {
				input: 987_654,
				output: 654_321,
				cacheRead: 123_456,
				cacheWrite: 78_901,
				cost: { total: 12.345 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		expect(visibleWidth(lines[1])).toBeLessThanOrEqual(width);

		const plainSecondLine = stripAnsi(lines[1]);
		expect(plainSecondLine).toMatch(/^Ctx:/);
		expect(plainSecondLine).toContain("12% of 200k");
		expect(plainSecondLine).toContain("Cost:");
	});

	it("keeps the pi version on the left of token stats", () => {
		const width = 120;
		const session = createSession({
			sessionName: "",
			modelId: "very-long-model-name-for-truncation",
			provider: "test",
			usage: {
				input: 343_000,
				output: 34_000,
				cacheRead: 1_800_000,
				cacheWrite: 0,
				cost: { total: 0.55 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		expect(visibleWidth(lines[2])).toBeLessThanOrEqual(width);

		const plainThirdLine = stripAnsi(lines[2]);
		const separatorIndex = plainThirdLine.indexOf("│");
		expect(separatorIndex).toBeGreaterThan(0);

		const prefixBeforeSeparator = plainThirdLine.slice(0, separatorIndex);
		expect(prefixBeforeSeparator).toMatch(/^Pi:/);
		expect(prefixBeforeSeparator).not.toMatch(/ {2,}$/);
		expect(plainThirdLine).toContain("Tokens:");
		expect(plainThirdLine.indexOf("Pi:")).toBeLessThan(plainThirdLine.indexOf("Tokens:"));
	});
});
