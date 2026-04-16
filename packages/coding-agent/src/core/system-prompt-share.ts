import { createHash } from "node:crypto";

export interface SystemPromptShareMetadata {
	app: string;
	version: string;
	date: string;
	sessionId: string;
	sessionName?: string;
	sessionFile?: string;
	cwd: string;
	provider?: string;
	model?: string;
	thinkingLevel: string;
	activeTools: readonly string[];
}

export interface SystemPromptShareArtifact {
	normalizedSystemPrompt: string;
	sha256: string;
	shortHash: string;
	chars: number;
	lines: number;
	markdown: string;
}

export function normalizeSystemPromptForHash(systemPrompt: string): string {
	return systemPrompt.replace(/\r\n?/g, "\n");
}

export function countSystemPromptLines(systemPrompt: string): number {
	if (systemPrompt.length === 0) return 0;
	return systemPrompt.split("\n").length;
}

function yamlScalar(value: string | undefined): string {
	return value === undefined ? "null" : JSON.stringify(value);
}

function yamlStringList(values: readonly string[]): string {
	if (values.length === 0) return " []";
	return `\n${values.map((value) => `  - ${JSON.stringify(value)}`).join("\n")}`;
}

export function buildSystemPromptShareMarkdown(
	metadata: SystemPromptShareMetadata,
	systemPrompt: string,
): SystemPromptShareArtifact {
	const normalizedSystemPrompt = normalizeSystemPromptForHash(systemPrompt);
	const sha256 = createHash("sha256").update(normalizedSystemPrompt, "utf8").digest("hex");
	const shortHash = sha256.slice(0, 12);
	const chars = normalizedSystemPrompt.length;
	const lines = countSystemPromptLines(normalizedSystemPrompt);
	const activeTools = [...new Set(metadata.activeTools)].sort((left, right) => left.localeCompare(right));

	const frontmatter = [
		"---",
		`type: ${yamlScalar("system-prompt")}`,
		`app: ${yamlScalar(metadata.app)}`,
		`version: ${yamlScalar(metadata.version)}`,
		`date: ${yamlScalar(metadata.date)}`,
		`sessionId: ${yamlScalar(metadata.sessionId)}`,
		`sessionName: ${yamlScalar(metadata.sessionName)}`,
		`sessionFile: ${yamlScalar(metadata.sessionFile)}`,
		`cwd: ${yamlScalar(metadata.cwd)}`,
		`provider: ${yamlScalar(metadata.provider)}`,
		`model: ${yamlScalar(metadata.model)}`,
		`thinkingLevel: ${yamlScalar(metadata.thinkingLevel)}`,
		`activeTools:${yamlStringList(activeTools)}`,
		`systemPromptSha256: ${yamlScalar(sha256)}`,
		`systemPromptChars: ${chars}`,
		`systemPromptLines: ${lines}`,
		"---",
		"",
	].join("\n");

	const markdown = `${frontmatter}${normalizedSystemPrompt}${normalizedSystemPrompt.endsWith("\n") ? "" : "\n"}`;

	return {
		normalizedSystemPrompt,
		sha256,
		shortHash,
		chars,
		lines,
		markdown,
	};
}
