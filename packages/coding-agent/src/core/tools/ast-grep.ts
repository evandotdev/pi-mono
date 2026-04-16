import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";
import { keyHint } from "../../modes/interactive/components/keybinding-hints.js";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.js";
import { resolveToCwd } from "./path-utils.js";
import { getTextOutput, invalidArgText, shortenPath, str } from "./render-utils.js";
import { wrapToolDefinition } from "./tool-definition-wrapper.js";
import {
	DEFAULT_MAX_BYTES,
	formatSize,
	GREP_MAX_LINE_LENGTH,
	type TruncationResult,
	truncateHead,
	truncateLine,
} from "./truncate.js";

const astGrepSchema = Type.Object({
	pattern: Type.String({ description: "AST pattern to search for" }),
	language: Type.String({ description: "ast-grep language alias, e.g. ts, tsx, js, python, rust, or bash" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

export type AstGrepToolInput = Static<typeof astGrepSchema>;

const DEFAULT_LIMIT = 100;

export interface AstGrepToolDetails {
	truncation?: TruncationResult;
	matchLimitReached?: number;
	linesTruncated?: boolean;
}

export interface AstGrepToolOptions {
	/** ast-grep executable to invoke. Default: ast-grep from PATH */
	commandPath?: string;
}

interface AstGrepJsonPosition {
	line: number;
	column: number;
}

interface AstGrepJsonMatch {
	file: string;
	lines: string;
	range: {
		start: AstGrepJsonPosition;
		end: AstGrepJsonPosition;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseAstGrepJsonMatch(value: unknown): AstGrepJsonMatch | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const file = value.file;
	const lines = value.lines;
	const range = value.range;
	if (typeof file !== "string" || typeof lines !== "string" || !isRecord(range)) {
		return undefined;
	}

	const start = range.start;
	const end = range.end;
	if (!isRecord(start) || !isRecord(end)) {
		return undefined;
	}

	const startLine = start.line;
	const startColumn = start.column;
	const endLine = end.line;
	const endColumn = end.column;
	if (
		typeof startLine !== "number" ||
		typeof startColumn !== "number" ||
		typeof endLine !== "number" ||
		typeof endColumn !== "number"
	) {
		return undefined;
	}

	return {
		file,
		lines,
		range: {
			start: { line: startLine, column: startColumn },
			end: { line: endLine, column: endColumn },
		},
	};
}

function formatAstGrepCall(
	args: { pattern: string; language: string; path?: string; limit?: number } | undefined,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
): string {
	const pattern = str(args?.pattern);
	const language = str(args?.language);
	const rawPath = str(args?.path);
	const searchPath = rawPath !== null ? shortenPath(rawPath || ".") : null;
	const limit = args?.limit;
	const invalidArg = invalidArgText(theme);
	let text =
		`${theme.fg("toolTitle", theme.bold("ast-grep"))} ` +
		(pattern === null ? invalidArg : theme.fg("accent", `/${pattern || ""}/`)) +
		theme.fg(
			"toolOutput",
			` [${language === null ? "?" : language || ""}] in ${searchPath === null ? invalidArg : searchPath}`,
		);
	if (limit !== undefined) {
		text += theme.fg("toolOutput", ` limit ${limit}`);
	}
	return text;
}

function formatAstGrepResult(
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: AstGrepToolDetails;
	},
	options: ToolRenderResultOptions,
	theme: typeof import("../../modes/interactive/theme/theme.js").theme,
	showImages: boolean,
): string {
	const output = getTextOutput(result, showImages).trim();
	let text = "";
	if (output) {
		const lines = output.split("\n");
		const maxLines = options.expanded ? lines.length : 15;
		const displayLines = lines.slice(0, maxLines);
		const remaining = lines.length - maxLines;
		text += `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
		if (remaining > 0) {
			text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
		}
	}

	const matchLimit = result.details?.matchLimitReached;
	const truncation = result.details?.truncation;
	const linesTruncated = result.details?.linesTruncated;
	if (matchLimit || truncation?.truncated || linesTruncated) {
		const warnings: string[] = [];
		if (matchLimit) warnings.push(`${matchLimit} matches limit`);
		if (truncation?.truncated) warnings.push(`${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit`);
		if (linesTruncated) warnings.push("some lines truncated");
		text += `\n${theme.fg("warning", `[Truncated: ${warnings.join(", ")}]`)}`;
	}
	return text;
}

function formatMatchBlock(
	displayPath: string,
	match: AstGrepJsonMatch,
	linesTruncatedState: { value: boolean },
): string {
	const lineNumber = match.range.start.line + 1;
	const normalizedLines = match.lines.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
	const snippetLines = normalizedLines.map((line) => {
		const { text, wasTruncated } = truncateLine(line, GREP_MAX_LINE_LENGTH);
		if (wasTruncated) {
			linesTruncatedState.value = true;
		}
		return text;
	});

	if (snippetLines.length <= 1) {
		return `${displayPath}:${lineNumber}: ${snippetLines[0] ?? ""}`;
	}

	return `${displayPath}:${lineNumber}:\n${snippetLines.map((line) => `  ${line}`).join("\n")}`;
}

export function createAstGrepToolDefinition(
	cwd: string,
	options?: AstGrepToolOptions,
): ToolDefinition<typeof astGrepSchema, AstGrepToolDetails | undefined> {
	const commandPath = options?.commandPath ?? "ast-grep";
	return {
		name: "ast-grep",
		label: "ast-grep",
		description: `Search code structurally using ast-grep AST patterns. Best for syntax-aware queries like declarations, calls, JSX/TSX shapes, and control-flow patterns. Uses the ast-grep CLI from PATH, so it can use any language the installed binary supports. Returns matching file paths, line numbers, and snippets. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
		promptSnippet: "Search code structurally with AST patterns",
		promptGuidelines: [
			"Use ast-grep for syntax-aware code search when plain-text search would be brittle.",
			"Prefer ast-grep over grep for declarations, calls, JSX/TSX shapes, and control-flow patterns.",
		],
		parameters: astGrepSchema,
		async execute(
			_toolCallId,
			{
				pattern,
				language,
				path: searchDir,
				limit,
			}: {
				pattern: string;
				language: string;
				path?: string;
				limit?: number;
			},
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			return new Promise((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}

				let settled = false;
				const settle = (fn: () => void) => {
					if (!settled) {
						settled = true;
						fn();
					}
				};

				try {
					const searchPath = resolveToCwd(searchDir || ".", cwd);
					let isDirectory: boolean;
					try {
						isDirectory = statSync(searchPath).isDirectory();
					} catch {
						settle(() => reject(new Error(`Path not found: ${searchPath}`)));
						return;
					}

					const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
					const formatPath = (filePath: string): string => {
						if (isDirectory) {
							const relative = path.relative(searchPath, filePath);
							if (relative && !relative.startsWith("..")) {
								return relative.replace(/\\/g, "/");
							}
						}
						return path.basename(filePath);
					};

					const args = [
						"run",
						"--lang",
						language,
						"--pattern",
						pattern,
						"--json=stream",
						"--color=never",
						"--no-ignore",
						"hidden",
						searchPath,
					];
					const child = spawn(commandPath, args, { stdio: ["ignore", "pipe", "pipe"] });
					const rl = createInterface({ input: child.stdout });
					let stderr = "";
					let matchCount = 0;
					let matchLimitReached = false;
					let linesTruncated = false;
					let aborted = false;
					let killedDueToLimit = false;
					const outputBlocks: string[] = [];

					const cleanup = () => {
						rl.close();
						signal?.removeEventListener("abort", onAbort);
					};
					const stopChild = (dueToLimit = false) => {
						if (!child.killed) {
							killedDueToLimit = dueToLimit;
							child.kill();
						}
					};
					const onAbort = () => {
						aborted = true;
						stopChild();
					};

					signal?.addEventListener("abort", onAbort, { once: true });
					child.stderr?.on("data", (chunk) => {
						stderr += chunk.toString();
					});

					rl.on("line", (line) => {
						if (!line.trim() || matchCount >= effectiveLimit) {
							return;
						}

						let parsed: unknown;
						try {
							parsed = JSON.parse(line) as unknown;
						} catch {
							return;
						}

						const match = parseAstGrepJsonMatch(parsed);
						if (!match) {
							return;
						}

						matchCount++;
						const linesTruncatedState = { value: linesTruncated };
						outputBlocks.push(formatMatchBlock(formatPath(match.file), match, linesTruncatedState));
						linesTruncated = linesTruncatedState.value;

						if (matchCount >= effectiveLimit) {
							matchLimitReached = true;
							stopChild(true);
						}
					});

					child.on("error", (error: NodeJS.ErrnoException) => {
						cleanup();
						if (error.code === "ENOENT") {
							settle(() => reject(new Error(`${commandPath} is not available on PATH`)));
							return;
						}
						settle(() => reject(new Error(`Failed to run ${commandPath}: ${error.message}`)));
					});

					child.on("close", (code) => {
						cleanup();
						if (aborted) {
							settle(() => reject(new Error("Operation aborted")));
							return;
						}
						if (!killedDueToLimit && code !== 0 && code !== 1) {
							const errorMsg = stderr.trim() || `${commandPath} exited with code ${code}`;
							settle(() => reject(new Error(errorMsg)));
							return;
						}
						if (matchCount === 0) {
							settle(() =>
								resolve({ content: [{ type: "text", text: "No matches found" }], details: undefined }),
							);
							return;
						}

						const rawOutput = outputBlocks.join("\n\n");
						const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
						let output = truncation.content;
						const details: AstGrepToolDetails = {};
						const notices: string[] = [];
						if (matchLimitReached) {
							notices.push(
								`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
							);
							details.matchLimitReached = effectiveLimit;
						}
						if (truncation.truncated) {
							notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
							details.truncation = truncation;
						}
						if (linesTruncated) {
							notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read for full context`);
							details.linesTruncated = true;
						}
						if (notices.length > 0) {
							output += `\n\n[${notices.join(". ")}]`;
						}
						settle(() =>
							resolve({
								content: [{ type: "text", text: output }],
								details: Object.keys(details).length > 0 ? details : undefined,
							}),
						);
					});
				} catch (error) {
					settle(() => reject(error as Error));
				}
			});
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatAstGrepCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatAstGrepResult(result, options, theme, context.showImages));
			return text;
		},
	};
}

export function createAstGrepTool(cwd: string, options?: AstGrepToolOptions): AgentTool<typeof astGrepSchema> {
	return wrapToolDefinition(createAstGrepToolDefinition(cwd, options));
}

/** Default ast-grep tool using process.cwd() for backwards compatibility. */
export const astGrepToolDefinition = createAstGrepToolDefinition(process.cwd());
export const astGrepTool = createAstGrepTool(process.cwd());
