import type { SourceInfo } from "./source-info.js";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{
		name: "model",
		description: "Switch active model, list with /model:list, or configure named selections via /model:<scope>",
	},
	{ name: "thinking", description: "Set thinking level" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "share:system-prompt", description: "Share the current effective system prompt as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "session:name", description: "Set session display name" },
	{ name: "session:rename", description: "Alias for /session:name" },
	{ name: "name", description: "Alias for /session:name" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous message" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "login", description: "Login with OAuth provider" },
	{ name: "logout", description: "Logout from OAuth provider" },
	{ name: "session:new", description: "Start a new session" },
	{ name: "new", description: "Alias for /session:new" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "context", description: "Show context breakdown or clear current branch context" },
	{ name: "session:resume", description: "Resume a different session" },
	{ name: "resume", description: "Alias for /session:resume" },
	{ name: "usage", description: "Show OAuth provider usage across all accounts" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
	{ name: "generate-models", description: "Run pi-ai model generation" },
	{ name: "quit", description: "Quit pi" },
];
