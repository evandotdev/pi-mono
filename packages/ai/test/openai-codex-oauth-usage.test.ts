import { afterEach, describe, expect, it, vi } from "vitest";
import { openaiCodexOAuthProvider } from "../src/utils/oauth/openai-codex.js";
import type { OAuthCredentials } from "../src/utils/oauth/types.js";

const CREDENTIALS: OAuthCredentials = {
	access: "access-token",
	refresh: "refresh-token",
	expires: Date.now() + 60_000,
	accountId: "acct_1234567890",
};

function getHeaders(init?: RequestInit): Headers {
	return new Headers(init?.headers);
}

describe("OpenAI Codex OAuth usage", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sends browser-like macOS headers for usage requests", async () => {
		const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit): Promise<Response> => {
			const headers = getHeaders(init);
			expect(headers.get("accept")).toBe("application/json");
			expect(headers.get("accept-language")).toBe("en-US,en;q=0.9");
			expect(headers.get("authorization")).toBe("Bearer access-token");
			expect(headers.get("chatgpt-account-id")).toBe("acct_1234567890");
			expect(headers.get("origin")).toBe("https://chatgpt.com");
			expect(headers.get("referer")).toBe("https://chatgpt.com/");
			expect(headers.get("sec-ch-ua-platform")).toBe('"macOS"');
			expect(headers.get("sec-fetch-site")).toBe("same-origin");
			expect(headers.get("user-agent")).toContain("Macintosh");

			return new Response(
				JSON.stringify({
					rate_limit: {
						primary_window: {
							used_percent: 42,
							limit_window_seconds: 18_000,
							reset_at: 1_700_000_000,
						},
					},
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const usage = await openaiCodexOAuthProvider.fetchUsage!(CREDENTIALS);

		expect(usage).toEqual({
			windows: {
				"5h": {
					utilizationPercent: 42,
					resetsAt: 1_700_000_000_000,
				},
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("throws Cloudflare challenge errors so the login selector can show them", async () => {
		const fetchMock = vi.fn(async (): Promise<Response> => {
			return new Response("blocked", {
				status: 403,
				statusText: "Forbidden",
				headers: { "cf-mitigated": "challenge" },
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(openaiCodexOAuthProvider.fetchUsage!(CREDENTIALS)).rejects.toThrow("403 Cloudflare challenge");
	});
});
