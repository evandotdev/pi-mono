import type { ProviderUsage } from "@mariozechner/pi-ai";
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

function createFooterData(
	providerCount: number,
	options?: {
		extensionStatuses?: Map<string, string>;
		providerUsage?: Map<string, ProviderUsage>;
	},
): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => options?.extensionStatuses ?? new Map<string, string>(),
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
		getProviderUsage: () => options?.providerUsage ?? new Map<string, ProviderUsage>(),
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
		expect(plainSecondLine).toContain("Tokens:");
	});

	it("shows zero token totals on startup", () => {
		const width = 120;
		const session = createSession({
			sessionName: "",
			modelId: "test-model",
			provider: "test",
		});
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		expect(visibleWidth(lines[1])).toBeLessThanOrEqual(width);

		const plainSecondLine = stripAnsi(lines[1]);
		expect(plainSecondLine).toContain("Ctx:");
		expect(plainSecondLine).toContain("Tokens:");
		expect(plainSecondLine).toContain("in 0");
		expect(plainSecondLine).toContain("out 0");
		expect(plainSecondLine).toContain("R0/W0");
	});

	it("renders usage immediately after the model section on the first line", () => {
		const width = 120;
		const session = createSession({
			sessionName: "",
			modelId: "test-model",
			provider: "test",
			reasoning: true,
			thinkingLevel: "high",
		});
		const footer = new FooterComponent(
			session,
			createFooterData(1, {
				providerUsage: new Map([
					[
						"test",
						{
							windows: {
								"5h": { utilizationPercent: 4, resetsAt: Date.now() + 5 * 60 * 60 * 1000 },
							},
						},
					],
				]),
			}),
		);

		const lines = footer.render(width);
		const plainFirstLine = stripAnsi(lines[0]);
		expect(plainFirstLine).toContain("test-model • high │ Usage:");
	});

	it("keeps the Pi version on the third line when no sandbox status is present", () => {
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
		expect(plainThirdLine).toMatch(/^Pi:/);
		expect(plainThirdLine).not.toContain("Tokens:");
	});

	it("filters usage windows to duration-style names in the compact footer", () => {
		const width = 120;
		const session = createSession({
			sessionName: "",
			modelId: "gpt-5.4",
			provider: "openai",
		});
		const providerUsage = new Map<string, ProviderUsage>([
			[
				"openai",
				{
					windows: {
						"5h": { utilizationPercent: 72, resetsAt: Date.now() + 5 * 60 * 60 * 1000 },
						"7d": { utilizationPercent: 13, resetsAt: Date.now() + 7 * 24 * 60 * 60 * 1000 },
						"GPT-5.3-Codex-Spark": { utilizationPercent: 99, resetsAt: Date.now() + 60 * 60 * 1000 },
						primary: { utilizationPercent: 50, resetsAt: Date.now() + 30 * 60 * 1000 },
					},
				},
			],
		]);
		const footer = new FooterComponent(session, createFooterData(1, { providerUsage }));

		const lines = footer.render(width);
		const plainFirstLine = stripAnsi(lines[0]);
		expect(plainFirstLine).toContain("Usage:");
		expect(plainFirstLine).toContain("5h");
		expect(plainFirstLine).toContain("7d");
		expect(plainFirstLine).not.toContain("GPT-5.3-Codex-Spark");
		expect(plainFirstLine).not.toContain("primary");
	});

	it("renders sandbox and planning statuses on separate footer rows", () => {
		const width = 120;
		const session = createSession({
			sessionName: "",
			modelId: "test-model",
			provider: "test",
		});
		const footer = new FooterComponent(
			session,
			createFooterData(1, {
				extensionStatuses: new Map([
					["sandbox", "🔒 Sandbox: 2 domains, 1 write path"],
					["plan-mode", "Planning with 3 steps"],
				]),
			}),
		);

		const lines = footer.render(width);
		expect(visibleWidth(lines[2])).toBeLessThanOrEqual(width);
		expect(visibleWidth(lines[3])).toBeLessThanOrEqual(width);

		const sandboxLine = stripAnsi(lines[2]);
		const planningLine = stripAnsi(lines[3]);
		expect(sandboxLine).toContain("Sandbox");
		expect(sandboxLine).not.toContain("Planning with");
		expect(planningLine).toContain("Planning with 3 steps");
		expect(planningLine).not.toContain("Sandbox");
	});
});
