import { describe, expect, it } from "vitest";
import { formatOAuthUsageErrorLabel } from "../src/modes/interactive/components/oauth-selector-utils.js";

describe("formatOAuthUsageErrorLabel", () => {
	it("shows usage errors only in login mode", () => {
		expect(formatOAuthUsageErrorLabel("login", "403 Cloudflare challenge")).toBe(
			"usage unavailable: 403 Cloudflare challenge",
		);
		expect(formatOAuthUsageErrorLabel("logout", "403 Cloudflare challenge")).toBeUndefined();
		expect(formatOAuthUsageErrorLabel("login", undefined)).toBeUndefined();
		expect(formatOAuthUsageErrorLabel("login", "   ")).toBeUndefined();
	});
});
