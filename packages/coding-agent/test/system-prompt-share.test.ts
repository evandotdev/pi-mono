import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
	buildSystemPromptShareMarkdown,
	countSystemPromptLines,
	normalizeSystemPromptForHash,
} from "../src/core/system-prompt-share.js";

describe("system prompt share helpers", () => {
	test("normalizes CRLF and CR line endings to LF", () => {
		expect(normalizeSystemPromptForHash("a\r\nb\rc\n")).toBe("a\nb\nc\n");
	});

	test("counts lines from normalized system prompt text", () => {
		expect(countSystemPromptLines("")).toBe(0);
		expect(countSystemPromptLines("one")).toBe(1);
		expect(countSystemPromptLines("one\ntwo\nthree")).toBe(3);
		expect(countSystemPromptLines("one\ntwo\n")).toBe(3);
	});

	test("builds markdown with stable metadata and normalized prompt body", () => {
		const prompt = "line 1\r\nline 2\rline 3";
		const artifact = buildSystemPromptShareMarkdown(
			{
				app: "pi",
				version: "1.2.3",
				date: "2026-04-16T00:00:00.000Z",
				sessionId: "abc123",
				sessionName: "Example session",
				sessionFile: "/tmp/example.jsonl",
				cwd: "/work/project",
				provider: "openai-codex",
				model: "gpt-5.4-mini",
				thinkingLevel: "high",
				activeTools: ["write", "bash", "read", "bash"],
			},
			prompt,
		);

		const normalized = "line 1\nline 2\nline 3";
		const expectedHash = createHash("sha256").update(normalized, "utf8").digest("hex");

		expect(artifact.normalizedSystemPrompt).toBe(normalized);
		expect(artifact.sha256).toBe(expectedHash);
		expect(artifact.shortHash).toBe(expectedHash.slice(0, 12));
		expect(artifact.chars).toBe(normalized.length);
		expect(artifact.lines).toBe(3);
		expect(artifact.markdown).toContain('type: "system-prompt"');
		expect(artifact.markdown).toContain('app: "pi"');
		expect(artifact.markdown).toContain('sessionName: "Example session"');
		expect(artifact.markdown).toContain('provider: "openai-codex"');
		expect(artifact.markdown).toContain('model: "gpt-5.4-mini"');
		expect(artifact.markdown).toContain('thinkingLevel: "high"');
		expect(artifact.markdown).toContain('activeTools:\n  - "bash"\n  - "read"\n  - "write"');
		expect(artifact.markdown).toContain(`systemPromptSha256: "${expectedHash}"`);
		expect(artifact.markdown).toContain("systemPromptChars: 20");
		expect(artifact.markdown).toContain("systemPromptLines: 3");
		expect(artifact.markdown.endsWith(`${normalized}\n`)).toBe(true);
	});
});
