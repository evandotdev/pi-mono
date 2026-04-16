import type { OAuthProviderInterface, ProviderUsage } from "@mariozechner/pi-ai";
import { getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { Container, getKeybindings, Spacer, TruncatedText } from "@mariozechner/pi-tui";
import type { AuthCredential, AuthStorage } from "../../../core/auth-storage.js";
import type { OAuthAccountUsage } from "../../../core/usage-service.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { formatOAuthUsageErrorLabel } from "./oauth-selector-utils.js";

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
	private providerAccountUsage: ReadonlyMap<string, readonly OAuthAccountUsage[]>;
	private getUsageFetchError: (providerId: string, credentialIndex: number) => string | undefined;
	private onSelectCallback: (providerId: string, targetIndex: number | null) => void;
	private onCancelCallback: () => void;

	constructor(
		mode: "login" | "logout",
		authStorage: AuthStorage,
		providerAccountUsage: ReadonlyMap<string, readonly OAuthAccountUsage[]>,
		getUsageFetchError: (providerId: string, credentialIndex: number) => string | undefined,
		onSelect: (providerId: string, targetIndex: number | null) => void,
		onCancel: () => void,
	) {
		super();
		this.mode = mode;
		this.authStorage = authStorage;
		this.providerAccountUsage = providerAccountUsage;
		this.getUsageFetchError = getUsageFetchError;
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

	private colorizeUsagePercent(percent: number): string {
		const label = `${Math.round(percent)}%`;
		if (percent > 95) return theme.fg("error", label);
		if (percent >= 70) return theme.fg("warning", label);
		if (percent > 50) return theme.fg("accent", label);
		if (percent > 30) {
			const lightYellow = theme.getColorMode() === "truecolor" ? "\x1b[38;2;255;245;157m" : "\x1b[38;5;229m";
			return `${lightYellow}${label}\x1b[39m`;
		}
		return theme.fg("success", label);
	}

	private formatUsageLabel(usage: ProviderUsage): string {
		const durationInSeconds = (name: string): number => {
			const match = name.match(/^(\d+)([mhd])$/);
			if (!match) return Number.MAX_SAFE_INTEGER;
			const value = parseInt(match[1], 10);
			const unit = match[2];
			switch (unit) {
				case "m":
					return value * 60;
				case "h":
					return value * 3600;
				case "d":
					return value * 86400;
				default:
					return Number.MAX_SAFE_INTEGER;
			}
		};

		const windows = Object.entries(usage.windows).sort((a, b) => {
			const durationA = durationInSeconds(a[0]);
			const durationB = durationInSeconds(b[0]);
			if (durationA !== durationB) return durationA - durationB;
			return a[0].localeCompare(b[0]);
		});
		return windows
			.map(([windowName, window]) => `${windowName} ${this.colorizeUsagePercent(window.utilizationPercent)}`)
			.join(theme.fg("dim", " · "));
	}

	private getUsageEntry(providerId: string, credentialIndex: number): OAuthAccountUsage | undefined {
		return this.providerAccountUsage.get(providerId)?.find((entry) => entry.credentialIndex === credentialIndex);
	}

	private getUsageLabel(providerId: string, credentialIndex: number): string {
		const usageEntry = this.getUsageEntry(providerId, credentialIndex);
		if (usageEntry) {
			const activeLabel = usageEntry.active ? ` ${theme.fg("success", "active")}` : "";
			return `  ${this.formatUsageLabel(usageEntry.usage)}${activeLabel}`;
		}
		const errorLabel = formatOAuthUsageErrorLabel(this.mode, this.getUsageFetchError(providerId, credentialIndex));
		if (!errorLabel) return "";
		return `  ${theme.fg("error", errorLabel)}`;
	}

	private accountLabel(providerId: string, cred: AuthCredential, index: number): string {
		const accountId =
			cred.type === "oauth" && typeof cred.accountId === "string" ? (cred.accountId as string) : undefined;
		const idSuffix = accountId ? `  ${theme.fg("dim", accountId.slice(0, 8))}` : "";
		return `Account ${index + 1}${idSuffix}${this.getUsageLabel(providerId, index)}`;
	}

	private buildRows(): void {
		this.rows = [];
		this.selectableRows = [];

		for (const provider of this.allProviders) {
			const creds = this.authStorage.getCredentials(provider.id);
			const oauthCreds = creds.filter((c) => c.type === "oauth");

			if (this.mode === "login") {
				if (oauthCreds.length === 0) {
					const row: SelectableRow = {
						kind: "selectable",
						text: provider.name,
						providerId: provider.id,
						targetIndex: null,
					};
					this.rows.push(row);
					this.selectableRows.push(row);
				} else {
					const count = oauthCreds.length;
					this.rows.push({
						kind: "header",
						text: `${provider.name}  ${theme.fg("success", `✓ ${count} account${count > 1 ? "s" : ""}`)}`,
					});
					for (let i = 0; i < creds.length; i++) {
						const credential = creds[i];
						if (!credential || credential.type !== "oauth") continue;
						const row: SelectableRow = {
							kind: "selectable",
							text: `  ${this.accountLabel(provider.id, credential, i)}`,
							providerId: provider.id,
							targetIndex: i,
						};
						this.rows.push(row);
						this.selectableRows.push(row);
					}
					const addRow: SelectableRow = {
						kind: "selectable",
						text: "  + Add new account",
						providerId: provider.id,
						targetIndex: null,
					};
					this.rows.push(addRow);
					this.selectableRows.push(addRow);
				}
			} else {
				if (oauthCreds.length === 0) continue;

				if (oauthCreds.length === 1) {
					const credential = oauthCreds[0]!;
					const credentialIndex = creds.indexOf(credential);
					const idSuffix =
						credential.type === "oauth" && typeof credential.accountId === "string"
							? `  ${theme.fg("dim", credential.accountId.slice(0, 8))}`
							: "";
					const row: SelectableRow = {
						kind: "selectable",
						text: `${provider.name}${idSuffix}  ${theme.fg("success", "✓ logged in")}${this.getUsageLabel(provider.id, credentialIndex)}`,
						providerId: provider.id,
						targetIndex: credentialIndex,
					};
					this.rows.push(row);
					this.selectableRows.push(row);
				} else {
					this.rows.push({
						kind: "header",
						text: `${provider.name}  ${theme.fg("success", `✓ ${oauthCreds.length} accounts`)}`,
					});
					for (let i = 0; i < creds.length; i++) {
						const credential = creds[i];
						if (!credential || credential.type !== "oauth") continue;
						const row: SelectableRow = {
							kind: "selectable",
							text: `  ${this.accountLabel(provider.id, credential, i)}`,
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
