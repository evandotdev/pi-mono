import { afterEach, describe, expect, it, vi } from "vitest";
import { antigravityOAuthProvider } from "../src/utils/oauth/google-antigravity.js";
import type { OAuthCredentials } from "../src/utils/oauth/types.js";

function jsonResponse(body: unknown, status: number = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
		},
	});
}

function getUrl(input: unknown): string {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	if (input instanceof Request) {
		return input.url;
	}
	throw new Error(`Unsupported fetch input: ${String(input)}`);
}

function getJsonBody(init?: RequestInit): Record<string, string> {
	if (typeof init?.body !== "string") {
		throw new Error(`Expected string request body, got ${typeof init?.body}`);
	}
	return JSON.parse(init.body) as Record<string, string>;
}

const CREDENTIALS: OAuthCredentials = {
	access: "access-token",
	refresh: "refresh-token",
	expires: Date.now() + 60_000,
	projectId: "credentials-project-id",
};

describe("Google Antigravity OAuth usage", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("parses model quota windows and groups by family", async () => {
		const resetSoon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
		const resetLater = new Date(Date.now() + 60 * 60 * 1000).toISOString();

		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const url = getUrl(input);

			if (url.endsWith("/v1internal:loadCodeAssist")) {
				return jsonResponse({ cloudaicompanionProject: { id: "load-project-id" } });
			}

			if (url.endsWith("/v1internal:fetchAvailableModels")) {
				const body = getJsonBody(init);
				expect(body.project).toBe("load-project-id");
				return jsonResponse({
					models: {
						"claude-sonnet-4-6": {
							quotaInfo: { remainingFraction: 0.75, resetTime: resetSoon },
						},
						"claude-opus-4-6-thinking": {
							quotaInfo: { remainingFraction: 0.5, resetTime: resetLater },
						},
						"gemini-3-flash": {
							quotaInfo: { remainingFraction: 0.9, resetTime: resetLater },
						},
						"gemini-3.1-pro-high": {
							quotaInfo: { remainingFraction: 0.2, resetTime: resetLater },
						},
					},
				});
			}

			throw new Error(`Unexpected URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const usage = await antigravityOAuthProvider.fetchUsage!(CREDENTIALS);

		expect(usage).toEqual({
			windows: {
				claude: {
					utilizationPercent: 50,
					resetsAt: Date.parse(resetSoon),
				},
				"gemini-flash": {
					utilizationPercent: 10,
					resetsAt: Date.parse(resetLater),
				},
				"gemini-pro": {
					utilizationPercent: 80,
					resetsAt: Date.parse(resetLater),
				},
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("uses credential project ID when loadCodeAssist omits project", async () => {
		const fetchMock = vi.fn(async (input: unknown, init?: RequestInit): Promise<Response> => {
			const url = getUrl(input);

			if (url.endsWith("/v1internal:loadCodeAssist")) {
				return jsonResponse({});
			}

			if (url.endsWith("/v1internal:fetchAvailableModels")) {
				const body = getJsonBody(init);
				expect(body.project).toBe("credentials-project-id");
				return jsonResponse({
					models: {
						"gpt-oss-120b-medium": {
							quotaInfo: { remainingFraction: 0.4 },
						},
					},
				});
			}

			throw new Error(`Unexpected URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const usage = await antigravityOAuthProvider.fetchUsage!(CREDENTIALS);

		expect(usage).toEqual({
			windows: {
				"gpt-oss": {
					utilizationPercent: 60,
					resetsAt: undefined,
				},
			},
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("falls back to the next endpoint when the first one fails", async () => {
		const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
			const url = getUrl(input);

			if (url === "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist") {
				return new Response("forbidden", { status: 403 });
			}
			if (url === "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist") {
				return jsonResponse({ cloudaicompanionProject: "daily-project-id" });
			}
			if (url === "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels") {
				return jsonResponse({
					models: {
						"gemini-3-flash": {
							quotaInfo: { remainingFraction: 0.6 },
						},
					},
				});
			}

			throw new Error(`Unexpected URL: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		const usage = await antigravityOAuthProvider.fetchUsage!(CREDENTIALS);

		expect(usage).toEqual({
			windows: {
				"gemini-flash": {
					utilizationPercent: 40,
					resetsAt: undefined,
				},
			},
		});

		const calledUrls = fetchMock.mock.calls.map(([input]) => getUrl(input));
		expect(calledUrls[0]).toBe("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist");
		expect(calledUrls[1]).toBe("https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:loadCodeAssist");
		expect(calledUrls[2]).toBe("https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels");
	});
});
