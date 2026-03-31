import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface PathRule {
	pattern: string;
	description?: string;
}

interface PermissionPatternRule {
	pattern: string;
	description?: string;
	requireConfirmation?: boolean;
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

interface ConfigReadResult {
	hasConfig: boolean;
	config: PartialGuardrailsConfig;
}

interface CompiledPermissionRule {
	rule: PermissionPatternRule;
	regex: RegExp;
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
		rules.push({
			pattern: item.pattern,
			description: item.description,
			requireConfirmation: item.requireConfirmation,
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

function readConfigFile(configPath: string): ConfigReadResult | null {
	if (!fs.existsSync(configPath)) return null;

	const content = fs.readFileSync(configPath, "utf8");
	const parsed = JSON.parse(content) as unknown;
	return {
		hasConfig: true,
		config: parseGuardrailsConfig(parsed),
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

export default function (pi: ExtensionAPI) {
	let config: GuardrailsConfig = DEFAULT_CONFIG;
	let compiledPermissionRules: CompiledPermissionRule[] = [];

	function compilePermissionRules(rawRules: PermissionPatternRule[], notify: (message: string) => void): CompiledPermissionRule[] {
		const compiled: CompiledPermissionRule[] = [];
		for (const rule of rawRules) {
			try {
				compiled.push({ rule, regex: new RegExp(rule.pattern) });
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

		return regex.test(targetPath) || regex.test(relativePath) || targetPath.includes(resolvedPattern) || relativePath.includes(resolvedPattern);
	}

	pi.on("session_start", async (_event, ctx) => {
		const projectConfigPath = path.join(ctx.cwd, ".pi", "guardrails.json");
		const globalConfigPath = path.join(os.homedir(), ".pi", "agent", "guardrails.json");

		try {
			const globalConfig = readConfigFile(globalConfigPath);
			const projectConfig = readConfigFile(projectConfigPath);

			const mergedGlobal = globalConfig ? mergeConfig(DEFAULT_CONFIG, globalConfig.config) : DEFAULT_CONFIG;
			config = projectConfig ? mergeConfig(mergedGlobal, projectConfig.config) : mergedGlobal;
			compiledPermissionRules = compilePermissionRules(config.permissionGate.patterns, (message) => ctx.ui.notify(message));

			const hasProject = projectConfig?.hasConfig ?? false;
			const hasGlobal = globalConfig?.hasConfig ?? false;
			if (!hasProject && !hasGlobal) {
				ctx.ui.notify("Guardrails: no .pi/guardrails.json or ~/.pi/agent/guardrails.json found");
			} else if (!config.enabled) {
				ctx.ui.notify("Guardrails: disabled by config");
			} else {
				const source = hasProject && hasGlobal ? "project + global" : hasProject ? "project" : "global";
				ctx.ui.notify(`Guardrails: loaded ${countRules(config)} rules from ${source} config`);
			}
		} catch (err) {
			ctx.ui.notify(`Guardrails: failed to load config: ${err instanceof Error ? err.message : String(err)}`);
			config = DEFAULT_CONFIG;
			compiledPermissionRules = [];
		}

		const status = config.enabled ? `Guardrails: ${countRules(config)} rules` : "Guardrails: disabled";
		ctx.ui.setStatus(status);
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
					if (event.input.glob.includes(rule.pattern) || isPathMatch(event.input.glob, rule.pattern, ctx.cwd)) {
						violationReason = `Glob matches restricted path: ${formatRuleDescription(rule, rule.pattern)}`;
						break;
					}
				}
			}

			if (!violationReason) {
				violationReason = checkZeroAccessPaths(inputPaths);
			}
		}

		if (!violationReason && isToolCallEventType("bash", event)) {
			const command = event.input.command;

			if (config.features.permissionGate) {
				for (const { rule, regex } of compiledPermissionRules) {
					if (regex.test(command)) {
						violationReason = formatRuleDescription(rule, rule.pattern);
						shouldAsk = rule.requireConfirmation ?? false;
						break;
					}
				}
			}

			if (!violationReason && config.features.pathProtection) {
				for (const rule of config.pathProtection.zeroAccess) {
					if (command.includes(rule.pattern)) {
						violationReason = `Bash command references restricted path: ${formatRuleDescription(rule, rule.pattern)}`;
						break;
					}
				}
			}

			if (!violationReason && config.features.pathProtection) {
				for (const rule of config.pathProtection.readOnly) {
					if (command.includes(rule.pattern) && (/[^\S\r\n]*[>|]/.test(command) || command.includes("rm") || command.includes("mv") || command.includes("sed"))) {
						violationReason = `Bash command may modify read-only path: ${formatRuleDescription(rule, rule.pattern)}`;
						break;
					}
				}
			}

			if (!violationReason && config.features.pathProtection) {
				for (const rule of config.pathProtection.noDelete) {
					if (command.includes(rule.pattern) && (command.includes("rm") || command.includes("mv"))) {
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
			if (shouldAsk) {
				const confirmed = await ctx.ui.confirm(
					"Guardrails Confirmation",
					`Dangerous command detected: ${violationReason}\n\nCommand: ${isToolCallEventType("bash", event) ? event.input.command : JSON.stringify(event.input)}\n\nDo you want to proceed?`,
					{ timeout: 30000 },
				);

				if (!confirmed) {
					ctx.ui.setStatus(`Guardrails blocked: ${violationReason.slice(0, 40)}`);
					pi.appendEntry("guardrails-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "blocked_by_user" });
					ctx.abort();
					return {
						block: true,
						reason: `BLOCKED by Guardrails: ${violationReason}\n\nDO NOT attempt to work around this restriction. DO NOT retry with alternative commands, paths, or approaches that achieve the same result. Report this block to the user exactly as stated and ask how they would like to proceed.`,
					};
				}

				pi.appendEntry("guardrails-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "confirmed_by_user" });
				return { block: false };
			}

			ctx.ui.notify(`Guardrails: blocked ${event.toolName} due to ${violationReason}`);
			ctx.ui.setStatus(`Guardrails blocked: ${violationReason.slice(0, 40)}`);
			pi.appendEntry("guardrails-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "blocked" });
			ctx.abort();
			return {
				block: true,
				reason: `BLOCKED by Guardrails: ${violationReason}\n\nDO NOT attempt to work around this restriction. DO NOT retry with alternative commands, paths, or approaches that achieve the same result. Report this block to the user exactly as stated and ask how they would like to proceed.`,
			};
		}

		return { block: false };
	});
}
