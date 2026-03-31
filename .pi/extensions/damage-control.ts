import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface Rule {
	pattern: string;
	reason: string;
	ask?: boolean;
}

interface Rules {
	bashToolPatterns: Rule[];
	zeroAccessPaths: string[];
	readOnlyPaths: string[];
	noDeletePaths: string[];
}

interface SettingsDamageControl {
	damageControl?: {
		bashToolPatterns?: Rule[];
		zeroAccessPaths?: string[];
		readOnlyPaths?: string[];
		noDeletePaths?: string[];
	};
}

interface SettingsReadResult {
	hasDamageControl: boolean;
	rules: Partial<Rules>;
}

interface CompiledBashRule {
	rule: Rule;
	regex: RegExp;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseStringArray(value: unknown, fieldName: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error(`${fieldName} must be an array`);
	for (const item of value) {
		if (typeof item !== "string") throw new Error(`${fieldName} must contain only strings`);
	}
	return value;
}

function parseRuleArray(value: unknown): Rule[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error("damageControl.bashToolPatterns must be an array");

	const rules: Rule[] = [];
	for (const item of value) {
		if (!isRecord(item)) throw new Error("Each damageControl.bashToolPatterns entry must be an object");
		if (typeof item.pattern !== "string") throw new Error("damageControl.bashToolPatterns[].pattern must be a string");
		if (typeof item.reason !== "string") throw new Error("damageControl.bashToolPatterns[].reason must be a string");
		if (item.ask !== undefined && typeof item.ask !== "boolean") {
			throw new Error("damageControl.bashToolPatterns[].ask must be a boolean");
		}
		rules.push({ pattern: item.pattern, reason: item.reason, ask: item.ask });
	}

	return rules;
}

function parseDamageControlSettings(value: unknown): Partial<Rules> {
	if (!isRecord(value)) throw new Error("damageControl must be an object");

	return {
		bashToolPatterns: parseRuleArray(value.bashToolPatterns),
		zeroAccessPaths: parseStringArray(value.zeroAccessPaths, "damageControl.zeroAccessPaths"),
		readOnlyPaths: parseStringArray(value.readOnlyPaths, "damageControl.readOnlyPaths"),
		noDeletePaths: parseStringArray(value.noDeletePaths, "damageControl.noDeletePaths"),
	};
}

function readSettingsRules(settingsPath: string): SettingsReadResult | null {
	if (!fs.existsSync(settingsPath)) return null;

	const content = fs.readFileSync(settingsPath, "utf8");
	const parsed = JSON.parse(content) as SettingsDamageControl;
	if (!isRecord(parsed)) throw new Error(`Settings file must be a JSON object: ${settingsPath}`);

	if (parsed.damageControl === undefined) {
		return { hasDamageControl: false, rules: {} };
	}

	return {
		hasDamageControl: true,
		rules: parseDamageControlSettings(parsed.damageControl),
	};
}

function mergeRules(globalRules: Partial<Rules>, projectRules: Partial<Rules>): Rules {
	return {
		bashToolPatterns: projectRules.bashToolPatterns ?? globalRules.bashToolPatterns ?? [],
		zeroAccessPaths: projectRules.zeroAccessPaths ?? globalRules.zeroAccessPaths ?? [],
		readOnlyPaths: projectRules.readOnlyPaths ?? globalRules.readOnlyPaths ?? [],
		noDeletePaths: projectRules.noDeletePaths ?? globalRules.noDeletePaths ?? [],
	};
}

export default function (pi: ExtensionAPI) {
	let rules: Rules = {
		bashToolPatterns: [],
		zeroAccessPaths: [],
		readOnlyPaths: [],
		noDeletePaths: [],
	};
	let compiledBashRules: CompiledBashRule[] = [];

	function compileBashRules(rawRules: Rule[], notify: (message: string) => void): CompiledBashRule[] {
		const compiled: CompiledBashRule[] = [];
		for (const rule of rawRules) {
			try {
				compiled.push({ rule, regex: new RegExp(rule.pattern) });
			} catch {
				notify(`🛡️ Damage-Control: Invalid regex ignored: ${rule.pattern}`);
			}
		}
		return compiled;
	}

	function resolvePath(p: string, cwd: string): string {
		if (p.startsWith("~")) {
			p = path.join(os.homedir(), p.slice(1));
		}
		return path.resolve(cwd, p);
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
		const projectSettingsPath = path.join(ctx.cwd, ".pi", "settings.json");
		const globalSettingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");

		try {
			const globalSettings = readSettingsRules(globalSettingsPath);
			const projectSettings = readSettingsRules(projectSettingsPath);

			const globalRules = globalSettings?.rules ?? {};
			const projectRules = projectSettings?.rules ?? {};
			rules = mergeRules(globalRules, projectRules);
			compiledBashRules = compileBashRules(rules.bashToolPatterns, (message) => ctx.ui.notify(message));

			const hasProject = projectSettings?.hasDamageControl ?? false;
			const hasGlobal = globalSettings?.hasDamageControl ?? false;

			if (hasProject || hasGlobal) {
				const source = hasProject && hasGlobal ? "project + global" : hasProject ? "project" : "global";
				ctx.ui.notify(
					`🛡️ Damage-Control: Loaded ${compiledBashRules.length + rules.zeroAccessPaths.length + rules.readOnlyPaths.length + rules.noDeletePaths.length} rules from settings.json (${source}).`,
				);
			} else {
				ctx.ui.notify("🛡️ Damage-Control: No damageControl block found in .pi/settings.json or ~/.pi/agent/settings.json");
			}
		} catch (err) {
			ctx.ui.notify(`🛡️ Damage-Control: Failed to load rules from settings.json: ${err instanceof Error ? err.message : String(err)}`);
			rules = {
				bashToolPatterns: [],
				zeroAccessPaths: [],
				readOnlyPaths: [],
				noDeletePaths: [],
			};
			compiledBashRules = [];
		}

		ctx.ui.setStatus(`🛡️ Damage-Control Active: ${compiledBashRules.length + rules.zeroAccessPaths.length + rules.readOnlyPaths.length + rules.noDeletePaths.length} Rules`);
	});

	pi.on("tool_call", async (event, ctx) => {
		let violationReason: string | null = null;
		let shouldAsk = false;

		const checkPaths = (pathsToCheck: string[]) => {
			for (const p of pathsToCheck) {
				const resolved = resolvePath(p, ctx.cwd);
				for (const zap of rules.zeroAccessPaths) {
					if (isPathMatch(resolved, zap, ctx.cwd)) {
						return `Access to zero-access path restricted: ${zap}`;
					}
				}
			}
			return null;
		};

		const inputPaths: string[] = [];
		if (isToolCallEventType("read", event) || isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			inputPaths.push(event.input.path);
		} else if (isToolCallEventType("grep", event) || isToolCallEventType("find", event) || isToolCallEventType("ls", event)) {
			inputPaths.push(event.input.path || ".");
		}

		if (isToolCallEventType("grep", event) && event.input.glob) {
			for (const zap of rules.zeroAccessPaths) {
				if (event.input.glob.includes(zap) || isPathMatch(event.input.glob, zap, ctx.cwd)) {
					violationReason = `Glob matches zero-access path: ${zap}`;
					break;
				}
			}
		}

		if (!violationReason) {
			violationReason = checkPaths(inputPaths);
		}

		if (!violationReason) {
			if (isToolCallEventType("bash", event)) {
				const command = event.input.command;

				for (const { rule, regex } of compiledBashRules) {
					if (regex.test(command)) {
						violationReason = rule.reason;
						shouldAsk = !!rule.ask;
						break;
					}
				}

				if (!violationReason) {
					for (const zap of rules.zeroAccessPaths) {
						if (command.includes(zap)) {
							violationReason = `Bash command references zero-access path: ${zap}`;
							break;
						}
					}
				}

				if (!violationReason) {
					for (const rop of rules.readOnlyPaths) {
						if (command.includes(rop) && (/[^\S\r\n]*[>|]/.test(command) || command.includes("rm") || command.includes("mv") || command.includes("sed"))) {
							violationReason = `Bash command may modify read-only path: ${rop}`;
							break;
						}
					}
				}

				if (!violationReason) {
					for (const ndp of rules.noDeletePaths) {
						if (command.includes(ndp) && (command.includes("rm") || command.includes("mv"))) {
							violationReason = `Bash command attempts to delete/move protected path: ${ndp}`;
							break;
						}
					}
				}
			} else if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
				for (const p of inputPaths) {
					const resolved = resolvePath(p, ctx.cwd);
					for (const rop of rules.readOnlyPaths) {
						if (isPathMatch(resolved, rop, ctx.cwd)) {
							violationReason = `Modification of read-only path restricted: ${rop}`;
							break;
						}
					}
				}
			}
		}

		if (violationReason) {
			if (shouldAsk) {
				const confirmed = await ctx.ui.confirm(
					"🛡️ Damage-Control Confirmation",
					`Dangerous command detected: ${violationReason}\n\nCommand: ${isToolCallEventType("bash", event) ? event.input.command : JSON.stringify(event.input)}\n\nDo you want to proceed?`,
					{ timeout: 30000 },
				);

				if (!confirmed) {
					ctx.ui.setStatus(`⚠️ Last Violation Blocked: ${violationReason.slice(0, 30)}...`);
					pi.appendEntry("damage-control-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "blocked_by_user" });
					ctx.abort();
					return {
						block: true,
						reason: `🛑 BLOCKED by Damage-Control: ${violationReason} (User denied)\n\nDO NOT attempt to work around this restriction. DO NOT retry with alternative commands, paths, or approaches that achieve the same result. Report this block to the user exactly as stated and ask how they would like to proceed.`,
					};
				}

				pi.appendEntry("damage-control-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "confirmed_by_user" });
				return { block: false };
			}

			ctx.ui.notify(`🛑 Damage-Control: Blocked ${event.toolName} due to ${violationReason}`);
			ctx.ui.setStatus(`⚠️ Last Violation: ${violationReason.slice(0, 30)}...`);
			pi.appendEntry("damage-control-log", { tool: event.toolName, input: event.input, rule: violationReason, action: "blocked" });
			ctx.abort();
			return {
				block: true,
				reason: `🛑 BLOCKED by Damage-Control: ${violationReason}\n\nDO NOT attempt to work around this restriction. DO NOT retry with alternative commands, paths, or approaches that achieve the same result. Report this block to the user exactly as stated and ask how they would like to proceed.`,
			};
		}

		return { block: false };
	});
}
