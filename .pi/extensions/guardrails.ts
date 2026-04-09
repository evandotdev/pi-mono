import type { ExtensionAPI, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveJsonConfig } from "./lib/config.ts";

interface PathRule {
	pattern: string;
	description?: string;
}

type PermissionTarget = "command" | "path" | "content";

interface PermissionPatternRule {
	pattern: string;
	description?: string;
	requireConfirmation?: boolean;
	tools?: string[];
	targets?: PermissionTarget[];
}

interface GuardrailsConfig {
	enabled: boolean;
	features: {
		pathProtection: boolean;
		permissionGate: boolean;
	};
	pathProtection: {
		zeroAccess: PathRule[];
		readOnly: PathRule[];
		noDelete: PathRule[];
	};
	permissionGate: {
		patterns: PermissionPatternRule[];
	};
}

interface PartialGuardrailsConfig {
	enabled?: boolean;
	features?: Partial<GuardrailsConfig["features"]>;
	pathProtection?: Partial<GuardrailsConfig["pathProtection"]>;
	permissionGate?: Partial<GuardrailsConfig["permissionGate"]>;
}

interface CompiledPermissionRule {
	rule: PermissionPatternRule;
	regex: RegExp;
	tools: Set<string> | null;
	targets: Set<PermissionTarget> | null;
}

const DEFAULT_CONFIG: GuardrailsConfig = {
	enabled: true,
	features: {
		pathProtection: true,
		permissionGate: true,
	},
	pathProtection: {
		zeroAccess: [],
		readOnly: [],
		noDelete: [],
	},
	permissionGate: {
		patterns: [],
	},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseBoolean(value: unknown, fieldName: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`${fieldName} must be a boolean`);
	return value;
}

function parsePathRules(value: unknown, fieldName: string): PathRule[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);

	const rules: PathRule[] = [];
	for (const item of value) {
		if (!isRecord(item)) throw new Error(`${fieldName} entries must be objects`);
		if (typeof item.pattern !== "string") throw new Error(`${fieldName}[].pattern must be a string`);
		if (item.description !== undefined && typeof item.description !== "string") {
			throw new Error(`${fieldName}[].description must be a string`);
		}
		rules.push({
			pattern: item.pattern,
			description: item.description,
		});
	}

	return rules;
}

function parsePermissionPatternRules(value: unknown, fieldName: string): PermissionPatternRule[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);

	const allowedTargets = new Set<PermissionTarget>(["command", "path", "content"]);
	const rules: PermissionPatternRule[] = [];
	for (const item of value) {
		if (!isRecord(item)) throw new Error(`${fieldName} entries must be objects`);
		if (typeof item.pattern !== "string") throw new Error(`${fieldName}[].pattern must be a string`);
		if (item.description !== undefined && typeof item.description !== "string") {
			throw new Error(`${fieldName}[].description must be a string`);
		}
		if (item.requireConfirmation !== undefined && typeof item.requireConfirmation !== "boolean") {
			throw new Error(`${fieldName}[].requireConfirmation must be a boolean`);
		}

		let tools: string[] | undefined;
		if (item.tools !== undefined) {
			if (!Array.isArray(item.tools)) throw new Error(`${fieldName}[].tools must be an array of strings`);
			tools = item.tools.map((tool, toolIndex) => {
				if (typeof tool !== "string" || tool.trim() === "") {
					throw new Error(`${fieldName}[].tools[${toolIndex}] must be a non-empty string`);
				}
				return tool.trim();
			});
		}

		let targets: PermissionTarget[] | undefined;
		if (item.targets !== undefined) {
			if (!Array.isArray(item.targets)) throw new Error(`${fieldName}[].targets must be an array`);
			targets = item.targets.map((target, targetIndex) => {
				if (typeof target !== "string" || !allowedTargets.has(target as PermissionTarget)) {
					throw new Error(`${fieldName}[].targets[${targetIndex}] must be one of: command, path, content`);
				}
				return target as PermissionTarget;
			});
		}

		rules.push({
			pattern: item.pattern,
			description: item.description,
			requireConfirmation: item.requireConfirmation,
			tools,
			targets,
		});
	}

	return rules;
}

function parseGuardrailsConfig(value: unknown): PartialGuardrailsConfig {
	if (!isRecord(value)) throw new Error("guardrails config must be a JSON object");

	const features = value.features;
	const pathProtection = value.pathProtection;
	const permissionGate = value.permissionGate;

	if (features !== undefined && !isRecord(features)) {
		throw new Error("features must be an object");
	}
	if (pathProtection !== undefined && !isRecord(pathProtection)) {
		throw new Error("pathProtection must be an object");
	}
	if (permissionGate !== undefined && !isRecord(permissionGate)) {
		throw new Error("permissionGate must be an object");
	}

	return {
		enabled: parseBoolean(value.enabled, "enabled"),
		features: features
			? {
					pathProtection: parseBoolean(features.pathProtection, "features.pathProtection"),
					permissionGate: parseBoolean(features.permissionGate, "features.permissionGate"),
				}
			: undefined,
		pathProtection: pathProtection
			? {
					zeroAccess: parsePathRules(pathProtection.zeroAccess, "pathProtection.zeroAccess"),
					readOnly: parsePathRules(pathProtection.readOnly, "pathProtection.readOnly"),
					noDelete: parsePathRules(pathProtection.noDelete, "pathProtection.noDelete"),
				}
			: undefined,
		permissionGate: permissionGate
			? {
					patterns: parsePermissionPatternRules(permissionGate.patterns, "permissionGate.patterns"),
				}
			: undefined,
	};
}

function mergeConfig(base: GuardrailsConfig, override: PartialGuardrailsConfig): GuardrailsConfig {
	return {
		enabled: override.enabled ?? base.enabled,
		features: {
			pathProtection: override.features?.pathProtection ?? base.features.pathProtection,
			permissionGate: override.features?.permissionGate ?? base.features.permissionGate,
		},
		pathProtection: {
			zeroAccess: override.pathProtection?.zeroAccess ?? base.pathProtection.zeroAccess,
			readOnly: override.pathProtection?.readOnly ?? base.pathProtection.readOnly,
			noDelete: override.pathProtection?.noDelete ?? base.pathProtection.noDelete,
		},
		permissionGate: {
			patterns: override.permissionGate?.patterns ?? base.permissionGate.patterns,
		},
	};
}

function countRules(config: GuardrailsConfig): number {
	return config.pathProtection.zeroAccess.length + config.pathProtection.readOnly.length + config.pathProtection.noDelete.length + config.permissionGate.patterns.length;
}

function formatRuleDescription(rule: PathRule | PermissionPatternRule, fallback: string): string {
	return rule.description?.trim() || fallback;
}

interface PermissionRuleInput {
	target: PermissionTarget;
	value: string;
}

const DEFAULT_PERMISSION_GATE_TOOLS = new Set(["bash"]);

const DEFAULT_PERMISSION_GATE_TARGETS: Record<string, PermissionTarget[]> = {
	bash: ["command"],
	read: ["path"],
	write: ["path", "content"],
	edit: ["path", "content"],
	grep: ["path"],
	find: ["path"],
	ls: ["path"],
};

function matchesRegex(regex: RegExp, value: string): boolean {
	regex.lastIndex = 0;
	return regex.test(value);
}

type GuardrailsConfigScope = "project" | "global" | "repo-default";

export default function (pi: ExtensionAPI) {
	let config: GuardrailsConfig = DEFAULT_CONFIG;
	let compiledPermissionRules: CompiledPermissionRule[] = [];
	let activeConfigScopes: string[] = [];

	function compilePermissionRules(rawRules: PermissionPatternRule[], notify: (message: string) => void): CompiledPermissionRule[] {
		const compiled: CompiledPermissionRule[] = [];
		for (const rule of rawRules) {
			try {
				const tools = rule.tools?.length ? new Set(rule.tools.map((tool) => tool.toLowerCase())) : null;
				const targets = rule.targets?.length ? new Set(rule.targets) : null;
				compiled.push({ rule, regex: new RegExp(rule.pattern), tools, targets });
			} catch {
				notify(`Guardrails: invalid regex ignored: ${rule.pattern}`);
			}
		}
		return compiled;
	}

	function resolvePath(inputPath: string, cwd: string): string {
		if (inputPath.startsWith("~")) {
			inputPath = path.join(os.homedir(), inputPath.slice(1));
		}
		return path.resolve(cwd, inputPath);
	}

	function isPathMatch(targetPath: string, pattern: string, cwd: string): boolean {
		const resolvedPattern = pattern.startsWith("~") ? path.join(os.homedir(), pattern.slice(1)) : pattern;

		if (resolvedPattern.endsWith("/")) {
			const absolutePattern = path.isAbsolute(resolvedPattern) ? resolvedPattern : path.resolve(cwd, resolvedPattern);
			return targetPath.startsWith(absolutePattern);
		}

		const regexPattern = resolvedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
		const regex = new RegExp(`^${regexPattern}$|^${regexPattern}/|/${regexPattern}$|/${regexPattern}/`);
		const relativePath = path.relative(cwd, targetPath);

		return regex.test(targetPath) || regex.test(relativePath);
	}

	function escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function commandReferencesPathPattern(command: string, pattern: string): boolean {
		const normalizedPattern = pattern.trim();
		if (normalizedPattern.length === 0) return false;

		const wildcardPattern = escapeRegExp(normalizedPattern).replace(/\\\*/g, "[^\\s\"'|&;<>]*");
		const boundaryChars = "[\\s\"'=:/\\\\|&;,<>(){}\\[\\]]";
		const needsSuffixBoundary = !normalizedPattern.endsWith("/");
		const suffix = needsSuffixBoundary ? `(?=$|${boundaryChars})` : "";
		const regex = new RegExp(`(^|${boundaryChars})${wildcardPattern}${suffix}`);

		return regex.test(command);
	}

	function getPermissionRuleInputs(event: ToolCallEvent): PermissionRuleInput[] {
		const inputs: PermissionRuleInput[] = [];

		if (isToolCallEventType("bash", event)) {
			inputs.push({ target: "command", value: event.input.command });
			return inputs;
		}

		if (isToolCallEventType("read", event) || isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			inputs.push({ target: "path", value: event.input.path });
		}

		if (isToolCallEventType("grep", event)) {
			inputs.push({ target: "path", value: event.input.path || "." });
			if (event.input.glob) inputs.push({ target: "path", value: event.input.glob });
		}

		if (isToolCallEventType("find", event) || isToolCallEventType("ls", event)) {
			inputs.push({ target: "path", value: event.input.path || "." });
		}

		if (isToolCallEventType("write", event)) {
			inputs.push({ target: "content", value: event.input.content });
		}

		if (isToolCallEventType("edit", event)) {
			for (const edit of event.input.edits) {
				inputs.push({ target: "content", value: edit.newText });
			}
		}

		return inputs;
	}

	function getDefaultPermissionTargets(toolName: string): Set<PermissionTarget> {
		const defaults = DEFAULT_PERMISSION_GATE_TARGETS[toolName];
		return new Set(defaults ?? []);
	}

	function resolvePermissionRuleTools(rule: CompiledPermissionRule): Set<string> {
		return rule.tools ?? DEFAULT_PERMISSION_GATE_TOOLS;
	}

	function resolvePermissionRuleTargets(rule: CompiledPermissionRule, toolName: string): Set<PermissionTarget> {
		return rule.targets ?? getDefaultPermissionTargets(toolName);
	}

	function resolveConfig(cwd: string) {
		return resolveJsonConfig<PartialGuardrailsConfig>({
			cwd,
			extensionFileUrl: import.meta.url,
			fileName: "guardrails.json",
			defaultConfig: {},
			parse: parseGuardrailsConfig,
			merge: (base, override) => ({
				...base,
				...override,
				features: { ...base.features, ...override.features },
				pathProtection: {
					...base.pathProtection,
					...override.pathProtection,
					zeroAccess: [...(base.pathProtection?.zeroAccess ?? []), ...(override.pathProtection?.zeroAccess ?? [])],
					readOnly: [...(base.pathProtection?.readOnly ?? []), ...(override.pathProtection?.readOnly ?? [])],
					noDelete: [...(base.pathProtection?.noDelete ?? []), ...(override.pathProtection?.noDelete ?? [])],
				},
				permissionGate: {
					...base.permissionGate,
					...override.permissionGate,
					patterns: [...(base.permissionGate?.patterns ?? []), ...(override.permissionGate?.patterns ?? [])],
				},
			}),
		});
	}

	function applyResolvedConfig(
		resolved: ReturnType<typeof resolveConfig>,
		notify: (message: string, type?: "info" | "warning" | "error") => void,
		setStatus: (text: string) => void,
		options?: { verbose?: boolean },
	): void {
		config = mergeConfig(DEFAULT_CONFIG, resolved.config);
		compiledPermissionRules = compilePermissionRules(config.permissionGate.patterns, (message) => notify(message, "warning"));
		activeConfigScopes = resolved.appliedSources.map((source) => source.scope);

		if (options?.verbose) {
			if (resolved.sources.length === 0) {
				notify(
					`Guardrails: no config found at ${resolved.paths.projectPath}, ${resolved.paths.globalPath}, or ${resolved.paths.repoDefaultPath}`,
					"info",
				);
			} else if (!config.enabled) {
				const lastSource = resolved.appliedSources[resolved.appliedSources.length - 1];
				if (lastSource) {
					notify(`Guardrails: disabled by ${lastSource.scope} config at ${lastSource.path}`, "warning");
				} else {
					notify("Guardrails: disabled by config", "warning");
				}
			} else {
				const sourceSummary = resolved.appliedSources.map((source) => `${source.scope} (${source.path})`).join(" + ");
				notify(`Guardrails: loaded ${countRules(config)} rules from ${sourceSummary}`, "info");
			}
		}

		const status = config.enabled ? `Guardrails: ${countRules(config)} rules` : "Guardrails: disabled";
		setStatus(status);
	}

	function parseScopeArg(args: string): GuardrailsConfigScope | "status" | undefined {
		const normalized = args.trim().toLowerCase();
		if (normalized === "") return "status";
		if (normalized === "status") return "status";
		if (normalized === "project" || normalized === "global" || normalized === "repo-default") return normalized;
		return undefined;
	}

	function getScopePath(resolved: ReturnType<typeof resolveConfig>, scope: GuardrailsConfigScope): string {
		if (scope === "project") return resolved.paths.projectPath;
		if (scope === "global") return resolved.paths.globalPath;
		return resolved.paths.repoDefaultPath;
	}

	pi.registerCommand("settings:guardrails", {
		description: "Show or edit guardrails config (status | project | global | repo-default)",
		getArgumentCompletions: (prefix) => {
			const options = ["status", "project", "global", "repo-default"];
			const filtered = options
				.filter((option) => option.startsWith(prefix.trim().toLowerCase()))
				.map((option) => ({
					value: option,
					label: option,
					description:
						option === "status"
							? "Show active config sources"
							: `Edit ${option} guardrails config file`,
				}));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const parsedScope = parseScopeArg(args);
			if (!parsedScope) {
				ctx.ui.notify("Usage: /settings:guardrails [status|project|global|repo-default]", "warning");
				return;
			}

			const resolved = resolveConfig(ctx.cwd);
			if (parsedScope === "status") {
				const loaded =
					resolved.appliedSources.length > 0
						? resolved.appliedSources.map((source) => `${source.scope} (${source.path})`).join(" + ")
						: "none";
				ctx.ui.notify(`Guardrails config sources: ${loaded}`, "info");
				return;
			}

			const targetPath = getScopePath(resolved, parsedScope);
			const initialRaw = existsSync(targetPath)
				? readFileSync(targetPath, "utf8")
				: `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`;
			const edited = await ctx.ui.editor(`Edit guardrails (${parsedScope})`, initialRaw);
			if (edited === undefined) {
				ctx.ui.notify("Guardrails config edit cancelled", "info");
				return;
			}

			try {
				const parsed = JSON.parse(edited) as unknown;
				parseGuardrailsConfig(parsed);
				mkdirSync(path.dirname(targetPath), { recursive: true });
				writeFileSync(targetPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
				ctx.ui.notify(`Saved guardrails config: ${targetPath}`, "success");

				const reloaded = resolveConfig(ctx.cwd);
				applyResolvedConfig(
					reloaded,
					(message, type) => ctx.ui.notify(message, type),
					(text) => ctx.ui.setStatus(text),
					{ verbose: true },
				);
			} catch (error) {
				ctx.ui.notify(`Guardrails config not saved: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		try {
			const resolved = resolveConfig(ctx.cwd);
			applyResolvedConfig(
				resolved,
				(message, type) => ctx.ui.notify(message, type),
				(text) => ctx.ui.setStatus(text),
				{ verbose: true },
			);
		} catch (err) {
			ctx.ui.notify(`Guardrails: failed to load config: ${err instanceof Error ? err.message : String(err)}`);
			config = DEFAULT_CONFIG;
			compiledPermissionRules = [];
			activeConfigScopes = [];
			ctx.ui.setStatus("Guardrails: disabled");
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!config.enabled) {
			return { block: false };
		}

		let violationReason: string | null = null;
		let shouldAsk = false;

		const checkZeroAccessPaths = (pathsToCheck: string[]) => {
			for (const currentPath of pathsToCheck) {
				const resolved = resolvePath(currentPath, ctx.cwd);
				for (const rule of config.pathProtection.zeroAccess) {
					if (isPathMatch(resolved, rule.pattern, ctx.cwd)) {
						return `Access restricted: ${formatRuleDescription(rule, rule.pattern)}`;
					}
				}
			}
			return null;
		};

		const inputPaths: string[] = [];
		if (config.features.pathProtection) {
			if (isToolCallEventType("read", event) || isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
				inputPaths.push(event.input.path);
			} else if (isToolCallEventType("grep", event) || isToolCallEventType("find", event) || isToolCallEventType("ls", event)) {
				inputPaths.push(event.input.path || ".");
			}

			if (isToolCallEventType("grep", event) && event.input.glob) {
				for (const rule of config.pathProtection.zeroAccess) {
					if (isPathMatch(event.input.glob, rule.pattern, ctx.cwd)) {
						violationReason = `Glob matches restricted path: ${formatRuleDescription(rule, rule.pattern)}`;
						break;
					}
				}
			}

			if (!violationReason) {
				violationReason = checkZeroAccessPaths(inputPaths);
			}
		}

		if (!violationReason && config.features.permissionGate) {
			const permissionInputs = getPermissionRuleInputs(event);
			const toolName = event.toolName.toLowerCase();

			ruleLoop: for (const rule of compiledPermissionRules) {
				const allowedTools = resolvePermissionRuleTools(rule);
				if (!allowedTools.has(toolName)) continue;

				const allowedTargets = resolvePermissionRuleTargets(rule, toolName);
				if (allowedTargets.size === 0) continue;

				for (const input of permissionInputs) {
					if (!allowedTargets.has(input.target)) continue;
					if (!matchesRegex(rule.regex, input.value)) continue;

					violationReason = formatRuleDescription(rule.rule, rule.rule.pattern);
					shouldAsk = rule.rule.requireConfirmation ?? false;
					break ruleLoop;
				}
			}
		}

		if (!violationReason && isToolCallEventType("bash", event)) {
			const command = event.input.command;

			if (!violationReason && config.features.pathProtection) {
				for (const rule of config.pathProtection.zeroAccess) {
					if (commandReferencesPathPattern(command, rule.pattern)) {
						violationReason = `Bash command references restricted path: ${formatRuleDescription(rule, rule.pattern)}`;
						break;
					}
				}
			}

			if (!violationReason && config.features.pathProtection) {
				for (const rule of config.pathProtection.readOnly) {
					if (commandReferencesPathPattern(command, rule.pattern) && (/[^\S\r\n]*[>|]/.test(command) || command.includes("rm") || command.includes("mv") || command.includes("sed"))) {
						violationReason = `Bash command may modify read-only path: ${formatRuleDescription(rule, rule.pattern)}`;
						break;
					}
				}
			}

			if (!violationReason && config.features.pathProtection) {
				for (const rule of config.pathProtection.noDelete) {
					if (commandReferencesPathPattern(command, rule.pattern) && (command.includes("rm") || command.includes("mv"))) {
						violationReason = `Bash command attempts to delete protected path: ${formatRuleDescription(rule, rule.pattern)}`;
						break;
					}
				}
			}
		} else if (!violationReason && config.features.pathProtection && (isToolCallEventType("write", event) || isToolCallEventType("edit", event))) {
			for (const currentPath of inputPaths) {
				const resolved = resolvePath(currentPath, ctx.cwd);
				for (const rule of config.pathProtection.readOnly) {
					if (isPathMatch(resolved, rule.pattern, ctx.cwd)) {
						violationReason = `Modification restricted for read-only path: ${formatRuleDescription(rule, rule.pattern)}`;
						break;
					}
				}
				if (violationReason) break;
			}
		}

		if (violationReason) {
			const scopeSuffix = activeConfigScopes.length > 0 ? `\n\nConfig scopes: ${activeConfigScopes.join(" | ")}` : "";
			const commandSummary = isToolCallEventType("bash", event) ? event.input.command : JSON.stringify(event.input);
			if (shouldAsk) {
				pi.sendMessage({
					customType: "guardrails-confirmation",
					content: `Guardrails requires confirmation for ${event.toolName}.\n\nReason: ${violationReason}\n\nCommand:\n\`\`\`\n${commandSummary}\n\`\`\``,
					display: true,
					details: {
						phase: "prompt",
						tool: event.toolName,
						rule: violationReason,
						command: commandSummary,
						timestamp: Date.now(),
					},
				});

				const confirmed = await ctx.ui.confirm(
					"Guardrails Confirmation",
					`Dangerous command detected: ${violationReason}\n\nCommand: ${commandSummary}\n\nDo you want to proceed?`,
					{ timeout: 30000 },
				);

				if (!confirmed) {
					pi.sendMessage({
						customType: "guardrails-confirmation",
						content: `Guardrails blocked ${event.toolName} after confirmation prompt.\n\nReason: ${violationReason}`,
						display: true,
						details: {
							phase: "blocked_by_user",
							tool: event.toolName,
							rule: violationReason,
							command: commandSummary,
							timestamp: Date.now(),
						},
					});
					ctx.ui.setStatus(`Guardrails blocked: ${violationReason.slice(0, 40)}`);
					pi.appendEntry("guardrails-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "blocked_by_user" });
					ctx.abort();
					return {
						block: true,
						reason: `BLOCKED by Guardrails: ${violationReason}${scopeSuffix}\n\nDO NOT attempt to work around this restriction. DO NOT retry with alternative commands, paths, or approaches that achieve the same result. Report this block to the user exactly as stated and ask how they would like to proceed.`,
					};
				}

				pi.sendMessage({
					customType: "guardrails-confirmation",
					content: `Guardrails confirmation approved for ${event.toolName}.\n\nReason: ${violationReason}`,
					display: true,
					details: {
						phase: "confirmed_by_user",
						tool: event.toolName,
						rule: violationReason,
						command: commandSummary,
						timestamp: Date.now(),
					},
				});
				pi.appendEntry("guardrails-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "confirmed_by_user" });
				return { block: false };
			}

			ctx.ui.notify(`Guardrails: blocked ${event.toolName} due to ${violationReason}`);
			ctx.ui.setStatus(`Guardrails blocked: ${violationReason.slice(0, 40)}`);
			pi.appendEntry("guardrails-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "blocked" });
			ctx.abort();
			return {
				block: true,
				reason: `BLOCKED by Guardrails: ${violationReason}${scopeSuffix}\n\nDO NOT attempt to work around this restriction. DO NOT retry with alternative commands, paths, or approaches that achieve the same result. Report this block to the user exactly as stated and ask how they would like to proceed.`,
			};
		}

		return { block: false };
	});
}
