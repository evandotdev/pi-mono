/**
 * Background service that periodically fetches usage data from OAuth providers
 * that support it (e.g. Anthropic's 5h/7d utilization windows).
 *
 * Results are cached for CACHE_TTL to avoid hammering provider APIs.
 * On startup and after each TTL, all configured OAuth providers are queried.
 */

import type { ProviderUsage } from "@mariozechner/pi-ai";
import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import type { AuthStorage, OAuthCredential } from "./auth-storage.js";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

type CacheEntry = {
	usage: ProviderUsage;
	fetchedAt: number;
};

export type OAuthAccountUsage = {
	credentialIndex: number;
	accountId?: string;
	usage: ProviderUsage;
	active: boolean;
};

export class UsageService {
	private cache = new Map<string, CacheEntry>();
	private accountUsage = new Map<string, OAuthAccountUsage[]>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	constructor(
		private readonly authStorage: AuthStorage,
		private readonly onUsageUpdate: (providerId: string, usage: ProviderUsage) => void,
	) {}

	/** Start background polling. Fetches immediately, then every CACHE_TTL. */
	start(): void {
		if (this.disposed) return;
		void this.fetchAll();
		this.scheduleNext();
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	getAllAccountUsage(): ReadonlyMap<string, readonly OAuthAccountUsage[]> {
		return this.accountUsage;
	}

	/**
	 * Refresh usage for one provider immediately.
	 * Uses cache when fresh, otherwise fetches from provider.
	 */
	async refreshProvider(providerId: string): Promise<void> {
		if (this.disposed) return;
		await this.fetchProvider(providerId);
	}

	/**
	 * Get active account usage for a provider from current cache/state.
	 */
	getActiveUsage(providerId: string): ProviderUsage | undefined {
		const activeIndex = this.authStorage.getActiveIndex(providerId);
		return this.accountUsage.get(providerId)?.find((entry) => entry.credentialIndex === activeIndex)?.usage;
	}

	private getCacheKey(providerId: string, credentialIndex: number, accountId?: string): string {
		return `${providerId}:${accountId ?? `index:${credentialIndex}`}`;
	}

	private async ensureFreshCredential(
		providerId: string,
		credentialIndex: number,
		credential: OAuthCredential,
	): Promise<OAuthCredential> {
		if (Date.now() < credential.expires) {
			return credential;
		}

		const provider = getOAuthProvider(providerId);
		if (!provider) {
			return credential;
		}

		try {
			const refreshed = await provider.refreshToken(credential);
			const nextCredential: OAuthCredential = { type: "oauth", ...refreshed };
			this.authStorage.setCredentialAt(providerId, credentialIndex, nextCredential);
			return nextCredential;
		} catch {
			return credential;
		}
	}

	private scheduleNext(): void {
		if (this.disposed) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			if (!this.disposed) {
				void this.fetchAll();
				this.scheduleNext();
			}
		}, CACHE_TTL);
	}

	private async fetchAll(): Promise<void> {
		for (const providerId of this.authStorage.list()) {
			await this.fetchProvider(providerId);
		}
	}

	private async fetchProvider(providerId: string): Promise<void> {
		const provider = getOAuthProvider(providerId);
		if (!provider?.fetchUsage) {
			this.accountUsage.delete(providerId);
			return;
		}

		const credentials = this.authStorage.getCredentials(providerId);
		const activeIndex = this.authStorage.getActiveIndex(providerId);
		const nextAccountUsage: OAuthAccountUsage[] = [];

		for (let credentialIndex = 0; credentialIndex < credentials.length; credentialIndex++) {
			const credential = credentials[credentialIndex];
			if (!credential || credential.type !== "oauth") continue;

			const accountId = typeof credential.accountId === "string" ? credential.accountId : undefined;
			const cacheKey = this.getCacheKey(providerId, credentialIndex, accountId);
			const cached = this.cache.get(cacheKey);
			let usage: ProviderUsage | undefined;

			if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
				usage = cached.usage;
			} else {
				const freshCredential = await this.ensureFreshCredential(providerId, credentialIndex, credential);
				try {
					const fetchedUsage = await provider.fetchUsage(freshCredential);
					if (fetchedUsage && !this.disposed) {
						this.cache.set(cacheKey, { usage: fetchedUsage, fetchedAt: Date.now() });
						usage = fetchedUsage;
					}
				} catch {
					usage = cached?.usage;
				}
			}

			if (!usage) continue;

			const active = credentialIndex === activeIndex;
			nextAccountUsage.push({
				credentialIndex,
				accountId,
				usage,
				active,
			});
		}

		if (nextAccountUsage.length > 0) {
			this.accountUsage.set(providerId, nextAccountUsage);
			const activeUsage = nextAccountUsage.find((entry) => entry.active)?.usage;
			if (activeUsage) {
				this.onUsageUpdate(providerId, activeUsage);
			}
		} else {
			this.accountUsage.delete(providerId);
		}
	}
}
