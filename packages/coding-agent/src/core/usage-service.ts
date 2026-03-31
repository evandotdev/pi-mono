/**
 * Background service that periodically fetches usage data from OAuth providers
 * that support it (e.g. Anthropic's 5h/7d utilization windows).
 *
 * Results are cached for CACHE_TTL to avoid hammering provider APIs.
 * On startup and after each TTL, all configured OAuth providers are queried.
 */

import type { ProviderUsage } from "@mariozechner/pi-ai";
import { getOAuthProvider } from "@mariozechner/pi-ai/oauth";
import type { AuthStorage } from "./auth-storage.js";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

type CacheEntry = {
	usage: ProviderUsage;
	fetchedAt: number;
};

export class UsageService {
	private cache = new Map<string, CacheEntry>();
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
			const cred = this.authStorage.get(providerId);
			if (cred?.type !== "oauth") continue;

			const provider = getOAuthProvider(providerId);
			if (!provider?.fetchUsage) continue;

			// Re-emit cached value immediately if still fresh
			const cached = this.cache.get(providerId);
			if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
				this.onUsageUpdate(providerId, cached.usage);
				continue;
			}

			// Get a valid access token (may trigger a refresh)
			let accessToken: string | undefined;
			try {
				accessToken = await this.authStorage.getApiKey(providerId);
			} catch {
				continue;
			}
			if (!accessToken) continue;

			try {
				const usage = await provider.fetchUsage(accessToken);
				if (usage && !this.disposed) {
					this.cache.set(providerId, { usage, fetchedAt: Date.now() });
					this.onUsageUpdate(providerId, usage);
				}
			} catch {
				// Silently ignore fetch errors; stale cache remains
			}
		}
	}
}
