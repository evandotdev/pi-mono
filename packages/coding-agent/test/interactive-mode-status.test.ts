import type { Model } from "@mariozechner/pi-ai";
import { Container } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function renderLastLine(container: Container, width = 120): string {
	const last = container.children[container.children.length - 1];
	if (!last) return "";
	return last.render(width).join("\n");
}

function renderAll(container: Container, width = 120): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

describe("InteractiveMode.showStatus", () => {
	beforeAll(() => {
		// showStatus uses the global theme instance
		initTheme("dark");
	});

	test("coalesces immediately-sequential status messages", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_ONE");

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// second status updates the previous line instead of appending
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
		expect(renderLastLine(fakeThis.chatContainer)).not.toContain("STATUS_ONE");
	});

	test("appends a new status line if something else was added in between", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);

		// Something else gets added to the chat in between status updates
		fakeThis.chatContainer.addChild({ render: () => ["OTHER"], invalidate: () => {} });
		expect(fakeThis.chatContainer.children).toHaveLength(3);

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// adds spacer + text
		expect(fakeThis.chatContainer.children).toHaveLength(5);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
	});
});

describe("InteractiveMode.createExtensionUIContext setTheme", () => {
	test("persists theme changes to settings manager", () => {
		initTheme("dark");

		let currentTheme = "dark";
		const settingsManager = {
			getTheme: vi.fn(() => currentTheme),
			setTheme: vi.fn((theme: string) => {
				currentTheme = theme;
			}),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("light");

		expect(result.success).toBe(true);
		expect(settingsManager.setTheme).toHaveBeenCalledWith("light");
		expect(currentTheme).toBe("light");
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
	});

	test("does not persist invalid theme names", () => {
		initTheme("dark");

		const settingsManager = {
			getTheme: vi.fn(() => "dark"),
			setTheme: vi.fn(),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("__missing_theme__");

		expect(result.success).toBe(false);
		expect(settingsManager.setTheme).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();
	});
});

describe("InteractiveMode.setupAutocomplete", () => {
	test("suggests /model:* namespace commands first, then only models for scoped command arguments", async () => {
		const model: Model<"anthropic-messages"> = {
			id: "claude-sonnet-4-5",
			name: "Claude Sonnet 4.5",
			provider: "anthropic",
			api: "anthropic-messages",
			reasoning: true,
			input: ["text"],
			cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200000,
			maxTokens: 8192,
			baseUrl: "https://api.anthropic.com",
		};

		const fakeEditor = {
			setAutocompleteProvider: vi.fn(),
		};

		const fakeThis: any = {
			session: {
				scopedModels: [],
				modelRegistry: {
					getAvailable: () => [model],
				},
				promptTemplates: [],
				extensionRunner: undefined,
				resourceLoader: {
					getSkills: () => ({ skills: [] }),
				},
			},
			sessionManager: {
				getCwd: () => process.cwd(),
			},
			settingsManager: {
				getModelSelections: () => ({
					default: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
					plan: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
					"extension:answer": { provider: "anthropic", modelId: "claude-sonnet-4-5" },
				}),
				getEnableSkillCommands: () => false,
			},
			normalizeModelScope: (scope: string) => {
				const normalized = scope.trim().toLowerCase();
				return normalized === "normal" ? "default" : normalized;
			},
			prefixAutocompleteDescription: (description?: string) => description,
			defaultEditor: fakeEditor,
			editor: fakeEditor,
			skillCommands: new Map(),
		};

		(InteractiveMode as any).prototype.setupAutocomplete.call(fakeThis, undefined);
		expect(fakeEditor.setAutocompleteProvider).toHaveBeenCalledTimes(1);
		expect(fakeThis.autocompleteProvider).toBeDefined();

		const provider = fakeThis.autocompleteProvider;
		const namespaceSuggestions = await provider.getSuggestions(["/model"], 0, "/model".length, {
			signal: new AbortController().signal,
		});
		expect(namespaceSuggestions?.items.some((item: { value: string }) => item.value === "model:list")).toBe(true);
		expect(namespaceSuggestions?.items.some((item: { value: string }) => item.value === "model:show")).toBe(true);
		expect(namespaceSuggestions?.items.some((item: { value: string }) => item.value === "model:default")).toBe(true);
		expect(namespaceSuggestions?.items.some((item: { value: string }) => item.value === "model:plan")).toBe(true);
		expect(
			namespaceSuggestions?.items.some((item: { value: string }) => item.value === "model:extension:answer"),
		).toBe(true);
		expect(
			namespaceSuggestions?.items.some((item: { value: string }) => item.value === "anthropic/claude-sonnet-4-5"),
		).toBe(false);

		const scopedArgSuggestions = await provider.getSuggestions(["/model:plan "], 0, "/model:plan ".length, {
			signal: new AbortController().signal,
		});
		expect(
			scopedArgSuggestions?.items.some((item: { value: string }) => item.value === "anthropic/claude-sonnet-4-5"),
		).toBe(true);
		expect(scopedArgSuggestions?.items.some((item: { value: string }) => item.value === "show")).toBe(false);
	});
});

describe("InteractiveMode.showLoadedResources", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	function createShowLoadedResourcesThis(options: {
		quietStartup: boolean;
		verbose?: boolean;
		skills?: Array<{ filePath: string }>;
		skillDiagnostics?: Array<{ type: "warning" | "error" | "collision"; message: string }>;
	}) {
		const fakeThis: any = {
			options: { verbose: options.verbose ?? false },
			chatContainer: new Container(),
			settingsManager: {
				getQuietStartup: () => options.quietStartup,
			},
			session: {
				promptTemplates: [],
				extensionRunner: undefined,
				resourceLoader: {
					getPathMetadata: () => new Map(),
					getAgentsFiles: () => ({ agentsFiles: [] }),
					getSkills: () => ({
						skills: options.skills ?? [],
						diagnostics: options.skillDiagnostics ?? [],
					}),
					getPrompts: () => ({ prompts: [], diagnostics: [] }),
					getExtensions: () => ({ extensions: [], errors: [], runtime: {} }),
					getThemes: () => ({ themes: [], diagnostics: [] }),
				},
			},
			formatDisplayPath: (p: string) => p,
			buildScopeGroups: () => [],
			formatScopeGroups: () => "resource-list",
			getShortPath: (p: string) => p,
			formatDiagnostics: () => "diagnostics",
			getBuiltInCommandConflictDiagnostics: () => [],
		};

		return fakeThis;
	}

	test("does not show verbose listing on quiet startup during reload", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			extensions: [{ path: "/tmp/ext/index.ts" }],
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		expect(fakeThis.chatContainer.children).toHaveLength(0);
	});

	test("still shows diagnostics on quiet startup when requested", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
			skillDiagnostics: [{ type: "warning", message: "duplicate skill name" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		const output = renderAll(fakeThis.chatContainer);
		expect(output).toContain("[Skill conflicts]");
		expect(output).not.toContain("[Skills]");
	});
});
