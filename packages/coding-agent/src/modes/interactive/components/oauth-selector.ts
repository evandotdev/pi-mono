import type { OAuthProviderInterface } from "@mariozechner/pi-ai";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { Container, getKeybindings, Spacer, TruncatedText } from "@mariozechner/pi-tui";
import type { AuthCredential, AuthStorage } from "../../../core/auth-storage.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

type HeaderRow = {
	kind: "header";
	text: string;
};

type SelectableRow = {
	kind: "selectable";
	text: string;
	providerId: string;
	/** null = add new account; number = replace credential at that index */
	targetIndex: number | null;
};

type Row = HeaderRow | SelectableRow;

/**
 * Component that renders an OAuth provider / account selector.
 *
 * For providers with existing credentials the list expands inline:
 *   ProviderName  (header, non-selectable)
 *     Account 1  (accountId prefix)   ← selectable, replaces slot
 *     Account 2  (accountId prefix)   ← selectable, replaces slot
 *     + Add new account               ← selectable, appends
 *
 * For providers with no credentials the provider row itself is selectable.
 *
 * Logout mode shows only providers with credentials; each account is a
 * selectable row that removes that specific credential.
 */
export class OAuthSelectorComponent extends Container {
	private listContainer: Container;
	private allProviders: OAuthProviderInterface[] = [];
	private rows: Row[] = [];
	private selectedIndex = 0; // index into selectable rows only
	private selectableRows: SelectableRow[] = [];
	private mode: "login" | "logout";
	private authStorage: AuthStorage;
	private onSelectCallback: (providerId: string, targetIndex: number | null) => void;
	private onCancelCallback: () => void;

	constructor(
		mode: "login" | "logout",
		authStorage: AuthStorage,
		onSelect: (providerId: string, targetIndex: number | null) => void,
		onCancel: () => void,
	) {
		super();
		this.mode = mode;
		this.authStorage = authStorage;
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		this.allProviders = getOAuthProviders();
		this.buildRows();

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		const title = mode === "login" ? "Select provider to login:" : "Select provider to logout:";
		this.addChild(new TruncatedText(theme.bold(title)));
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.renderList();
	}

	private accountLabel(cred: AuthCredential, index: number): string {
		const accountId =
			cred.type === "oauth" && typeof cred.accountId === "string" ? (cred.accountId as string) : undefined;
		const idSuffix = accountId ? `  ${theme.fg("dim", accountId.slice(0, 8))}` : "";
		return `Account ${index + 1}${idSuffix}`;
	}

	private buildRows(): void {
		this.rows = [];
		this.selectableRows = [];

		for (const provider of this.allProviders) {
			const creds = this.authStorage.getCredentials(provider.id);
			const oauthCreds = creds.filter((c) => c.type === "oauth");

			if (this.mode === "login") {
				if (oauthCreds.length === 0) {
					// No existing credentials — provider row is directly selectable
					const row: SelectableRow = {
						kind: "selectable",
						text: provider.name,
						providerId: provider.id,
						targetIndex: null,
					};
					this.rows.push(row);
					this.selectableRows.push(row);
				} else {
					// Header (non-selectable)
					const count = oauthCreds.length;
					this.rows.push({
						kind: "header",
						text: `${provider.name}  ${theme.fg("success", `✓ ${count} account${count > 1 ? "s" : ""}`)}`,
					});
					// One row per existing credential
					for (let i = 0; i < creds.length; i++) {
						const c = creds[i]!;
						if (c.type !== "oauth") continue;
						const credIdx = i;
						const row: SelectableRow = {
							kind: "selectable",
							text: `  ${this.accountLabel(c, credIdx)}`,
							providerId: provider.id,
							targetIndex: credIdx,
						};
						this.rows.push(row);
						this.selectableRows.push(row);
					}
					// Add new account
					const addRow: SelectableRow = {
						kind: "selectable",
						text: `  + Add new account`,
						providerId: provider.id,
						targetIndex: null,
					};
					this.rows.push(addRow);
					this.selectableRows.push(addRow);
				}
			} else {
				// Logout mode — only show providers with credentials
				if (oauthCreds.length === 0) continue;

				if (oauthCreds.length === 1) {
					// Single credential — provider row is directly selectable
					const cred = oauthCreds[0]!;
					const credIdx = creds.indexOf(cred);
					const idSuffix =
						cred.type === "oauth" && typeof cred.accountId === "string"
							? `  ${theme.fg("dim", (cred.accountId as string).slice(0, 8))}`
							: "";
					const row: SelectableRow = {
						kind: "selectable",
						text: `${provider.name}${idSuffix}  ${theme.fg("success", "✓ logged in")}`,
						providerId: provider.id,
						targetIndex: credIdx,
					};
					this.rows.push(row);
					this.selectableRows.push(row);
				} else {
					// Multiple credentials — header + per-account rows
					this.rows.push({
						kind: "header",
						text: `${provider.name}  ${theme.fg("success", `✓ ${oauthCreds.length} accounts`)}`,
					});
					for (let i = 0; i < creds.length; i++) {
						const c = creds[i]!;
						if (c.type !== "oauth") continue;
						const row: SelectableRow = {
							kind: "selectable",
							text: `  ${this.accountLabel(c, i)}`,
							providerId: provider.id,
							targetIndex: i,
						};
						this.rows.push(row);
						this.selectableRows.push(row);
					}
				}
			}
		}

		if (this.selectableRows.length === 0) {
			this.rows.push({
				kind: "header",
				text:
					this.mode === "login"
						? "No OAuth providers available"
						: "No OAuth providers logged in. Use /login first.",
			});
		}

		// Clamp selectedIndex
		if (this.selectedIndex >= this.selectableRows.length) {
			this.selectedIndex = Math.max(0, this.selectableRows.length - 1);
		}
	}

	private renderList(): void {
		this.listContainer.clear();

		const selectedSelectable = this.selectableRows[this.selectedIndex];

		for (const row of this.rows) {
			if (row.kind === "header") {
				this.listContainer.addChild(new TruncatedText(`  ${row.text}`, 0, 0));
			} else {
				const isSelected = row === selectedSelectable;
				let line: string;
				if (isSelected) {
					// Strip any leading spaces used for indentation, replace with arrow
					const indented = row.text.startsWith("  ");
					const prefix = indented ? theme.fg("accent", "  → ") : theme.fg("accent", "→ ");
					const body = theme.fg("accent", row.text.trimStart());
					line = prefix + body;
				} else {
					line = `  ${row.text}`;
				}
				this.listContainer.addChild(new TruncatedText(line, 0, 0));
			}
		}
	}

	handleInput(keyData: string): void {
		const kb = getKeybindings();

		if (kb.matches(keyData, "tui.select.up")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.renderList();
		} else if (kb.matches(keyData, "tui.select.down")) {
			this.selectedIndex = Math.min(this.selectableRows.length - 1, this.selectedIndex + 1);
			this.renderList();
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			const row = this.selectableRows[this.selectedIndex];
			if (row) {
				this.onSelectCallback(row.providerId, row.targetIndex);
			}
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			this.onCancelCallback();
		}
	}
}
