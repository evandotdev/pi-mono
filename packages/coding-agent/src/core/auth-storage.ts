/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, and refreshing credentials from auth.json.
 *
 * Uses file locking to prevent race conditions when multiple pi instances
 * try to refresh tokens simultaneously.
 */

import {
	getEnvApiKey,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type OAuthProviderId,
} from "@mariozechner/pi-ai";
import { getOAuthApiKey, getOAuthProvider, getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../config.js";
import { resolveConfigValue } from "./resolve-config-value.js";

export type ApiKeyCredential = {
	type: "api_key";
	key: string;
};

export type OAuthCredential = {
	type: "oauth";
} & OAuthCredentials;

export type AuthCredential = ApiKeyCredential | OAuthCredential;

/** A single credential or an array of credentials for round-robin rotation. */
export type AuthStorageValue = AuthCredential | AuthCredential[];

export type AuthStorageData = Record<string, AuthStorageValue>;

type LockResult<T> = {
	result: T;
	next?: string;
};

export interface AuthStorageBackend {
	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
	withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T>;
}

export class FileAuthStorageBackend implements AuthStorageBackend {
	constructor(private authPath: string = join(getAgentDir(), "auth.json")) {}

	private ensureParentDir(): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
	}

	private ensureFileExists(): void {
		if (!existsSync(this.authPath)) {
			writeFileSync(this.authPath, "{}", "utf-8");
			chmodSync(this.authPath, 0o600);
		}
	}

	private acquireLockSyncWithRetry(path: string): () => void {
		const maxAttempts = 10;
		const delayMs = 20;
		let lastError: unknown;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				return lockfile.lockSync(path, { realpath: false });
			} catch (error) {
				const code =
					typeof error === "object" && error !== null && "code" in error
						? String((error as { code?: unknown }).code)
						: undefined;
				if (code !== "ELOCKED" || attempt === maxAttempts) {
					throw error;
				}
				lastError = error;
				const start = Date.now();
				while (Date.now() - start < delayMs) {
					// Sleep synchronously to avoid changing callers to async.
				}
			}
		}

		throw (lastError as Error) ?? new Error("Failed to acquire auth storage lock");
	}

	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => void) | undefined;
		try {
			release = this.acquireLockSyncWithRetry(this.authPath);
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = fn(current);
			if (next !== undefined) {
				writeFileSync(this.authPath, next, "utf-8");
				chmodSync(this.authPath, 0o600);
			}
			return result;
		} finally {
			if (release) {
				release();
			}
		}
	}

	async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
		this.ensureParentDir();
		this.ensureFileExists();

		let release: (() => Promise<void>) | undefined;
		let lockCompromised = false;
		let lockCompromisedError: Error | undefined;
		const throwIfCompromised = () => {
			if (lockCompromised) {
				throw lockCompromisedError ?? new Error("Auth storage lock was compromised");
			}
		};

		try {
			release = await lockfile.lock(this.authPath, {
				retries: {
					retries: 10,
					factor: 2,
					minTimeout: 100,
					maxTimeout: 10000,
					randomize: true,
				},
				stale: 30000,
				onCompromised: (err) => {
					lockCompromised = true;
					lockCompromisedError = err;
				},
			});

			throwIfCompromised();
			const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
			const { result, next } = await fn(current);
			throwIfCompromised();
			if (next !== undefined) {
				writeFileSync(this.authPath, next, "utf-8");
				chmodSync(this.authPath, 0o600);
			}
			throwIfCompromised();
			return result;
		} finally {
			if (release) {
				try {
					await release();
				} catch {
					// Ignore unlock errors when lock is compromised.
				}
			}
		}
	}
}

export class InMemoryAuthStorageBackend implements AuthStorageBackend {
	private value: string | undefined;

	withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
		const { result, next } = fn(this.value);
		if (next !== undefined) {
			this.value = next;
		}
		return result;
	}

	async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
		const { result, next } = await fn(this.value);
		if (next !== undefined) {
			this.value = next;
		}
		return result;
	}
}

/**
 * Credential storage backed by a JSON file.
 *
 * Supports multiple credentials per provider for round-robin rotation.
 * When a single credential is stored, auth.json uses the original flat format.
 * When multiple credentials exist, they are stored as an array.
 */
export class AuthStorage {
	private data: AuthStorageData = {};
	private runtimeOverrides: Map<string, string> = new Map();
	private fallbackResolver?: (provider: string) => string | undefined;
	private loadError: Error | null = null;
	private errors: Error[] = [];
	/** In-memory active credential index per provider (not persisted). */
	private activeIndices: Map<string, number> = new Map();

	private constructor(private storage: AuthStorageBackend) {
		this.reload();
	}

	static create(authPath?: string): AuthStorage {
		return new AuthStorage(new FileAuthStorageBackend(authPath ?? join(getAgentDir(), "auth.json")));
	}

	static fromStorage(storage: AuthStorageBackend): AuthStorage {
		return new AuthStorage(storage);
	}

	static inMemory(data: AuthStorageData = {}): AuthStorage {
		const storage = new InMemoryAuthStorageBackend();
		storage.withLock(() => ({ result: undefined, next: JSON.stringify(data, null, 2) }));
		return AuthStorage.fromStorage(storage);
	}

	/**
	 * Set a runtime API key override (not persisted to disk).
	 * Used for CLI --api-key flag.
	 */
	setRuntimeApiKey(provider: string, apiKey: string): void {
		this.runtimeOverrides.set(provider, apiKey);
	}

	/**
	 * Remove a runtime API key override.
	 */
	removeRuntimeApiKey(provider: string): void {
		this.runtimeOverrides.delete(provider);
	}

	/**
	 * Set a fallback resolver for API keys not found in auth.json or env vars.
	 * Used for custom provider keys from models.json.
	 */
	setFallbackResolver(resolver: (provider: string) => string | undefined): void {
		this.fallbackResolver = resolver;
	}

	private recordError(error: unknown): void {
		const normalizedError = error instanceof Error ? error : new Error(String(error));
		this.errors.push(normalizedError);
	}

	private parseStorageData(content: string | undefined): AuthStorageData {
		if (!content) {
			return {};
		}
		return JSON.parse(content) as AuthStorageData;
	}

	/**
	 * Normalize a storage value to an array of credentials.
	 */
	private toArray(value: AuthStorageValue | undefined): AuthCredential[] {
		if (!value) return [];
		return Array.isArray(value) ? value : [value];
	}

	/**
	 * Normalize an array back to a storage value (single credential or array).
	 */
	private fromArray(arr: AuthCredential[]): AuthStorageValue | undefined {
		if (arr.length === 0) return undefined;
		if (arr.length === 1) return arr[0];
		return arr;
	}

	/**
	 * Reload credentials from storage.
	 */
	reload(): void {
		let content: string | undefined;
		try {
			this.storage.withLock((current) => {
				content = current;
				return { result: undefined };
			});
			this.data = this.parseStorageData(content);
			this.loadError = null;
		} catch (error) {
			this.loadError = error as Error;
			this.recordError(error);
		}
	}

	private persistProviderChange(provider: string, value: AuthStorageValue | undefined): void {
		if (this.loadError) {
			return;
		}

		try {
			this.storage.withLock((current) => {
				const currentData = this.parseStorageData(current);
				const merged: AuthStorageData = { ...currentData };
				if (value !== undefined) {
					merged[provider] = value;
				} else {
					delete merged[provider];
				}
				return { result: undefined, next: JSON.stringify(merged, null, 2) };
			});
		} catch (error) {
			this.recordError(error);
		}
	}

	/**
	 * Get the active credential for a provider.
	 * When multiple credentials are stored, returns the one at the active index.
	 */
	get(provider: string): AuthCredential | undefined {
		const arr = this.toArray(this.data[provider]);
		if (arr.length === 0) return undefined;
		const index = this.activeIndices.get(provider) ?? 0;
		return arr[index % arr.length];
	}

	/**
	 * Get all credentials for a provider as an array.
	 */
	getCredentials(provider: string): AuthCredential[] {
		return this.toArray(this.data[provider]);
	}

	/**
	 * Get number of credentials stored for a provider.
	 */
	getCredentialCount(provider: string): number {
		return this.toArray(this.data[provider]).length;
	}

	/**
	 * Get the active credential index for a provider.
	 */
	getActiveIndex(provider: string): number {
		const arr = this.toArray(this.data[provider]);
		if (arr.length === 0) return 0;
		return (this.activeIndices.get(provider) ?? 0) % arr.length;
	}

	/**
	 * Set credential for a provider (replaces all existing credentials).
	 */
	set(provider: string, credential: AuthCredential): void {
		this.data[provider] = credential;
		this.activeIndices.delete(provider);
		this.persistProviderChange(provider, credential);
	}

	/**
	 * Add a credential to a provider's pool.
	 * If the provider already has credentials, appends to the list.
	 */
	addCredential(provider: string, credential: AuthCredential): void {
		const existing = this.toArray(this.data[provider]);
		existing.push(credential);
		const value = this.fromArray(existing)!;
		this.data[provider] = value;
		this.persistProviderChange(provider, value);
	}

	/**
	 * Replace the credential at a specific index.
	 */
	setCredentialAt(provider: string, index: number, credential: AuthCredential): void {
		const arr = this.toArray(this.data[provider]);
		if (index < 0 || index >= arr.length) return;
		arr[index] = credential;
		const value = this.fromArray(arr)!;
		this.data[provider] = value;
		this.persistProviderChange(provider, value);
	}

	/**
	 * Remove a specific credential by index.
	 */
	removeCredentialAt(provider: string, index: number): void {
		const arr = this.toArray(this.data[provider]);
		if (index < 0 || index >= arr.length) return;
		arr.splice(index, 1);
		const value = this.fromArray(arr);
		if (value !== undefined) {
			this.data[provider] = value;
		} else {
			delete this.data[provider];
		}
		// Adjust active index
		const activeIdx = this.activeIndices.get(provider) ?? 0;
		if (arr.length === 0) {
			this.activeIndices.delete(provider);
		} else if (activeIdx >= arr.length) {
			this.activeIndices.set(provider, arr.length - 1);
		}
		this.persistProviderChange(provider, value);
	}

	/**
	 * Remove all credentials for a provider.
	 */
	remove(provider: string): void {
		delete this.data[provider];
		this.activeIndices.delete(provider);
		this.persistProviderChange(provider, undefined);
	}

	/**
	 * Rotate to the next credential for a provider.
	 * @returns true if rotation happened (i.e., multiple credentials exist)
	 */
	rotateCredential(provider: string): boolean {
		const arr = this.toArray(this.data[provider]);
		if (arr.length <= 1) return false;
		const currentIndex = this.activeIndices.get(provider) ?? 0;
		const nextIndex = (currentIndex + 1) % arr.length;
		this.activeIndices.set(provider, nextIndex);
		return true;
	}

	/**
	 * Set the active credential index for a provider.
	 * Returns false if the index is out of bounds or the provider has no credentials.
	 */
	setActiveCredentialIndex(provider: string, index: number): boolean {
		const arr = this.toArray(this.data[provider]);
		if (arr.length === 0 || index < 0 || index >= arr.length) {
			return false;
		}
		this.activeIndices.set(provider, index);
		return true;
	}

	/**
	 * List all providers with credentials.
	 */
	list(): string[] {
		return Object.keys(this.data);
	}

	/**
	 * Check if credentials exist for a provider in auth.json.
	 */
	has(provider: string): boolean {
		return provider in this.data;
	}

	/**
	 * Check if any form of auth is configured for a provider.
	 * Unlike getApiKey(), this doesn't refresh OAuth tokens.
	 */
	hasAuth(provider: string): boolean {
		if (this.runtimeOverrides.has(provider)) return true;
		if (this.data[provider]) return true;
		if (getEnvApiKey(provider)) return true;
		if (this.fallbackResolver?.(provider)) return true;
		return false;
	}

	/**
	 * Get all credentials (for passing to getOAuthApiKey).
	 */
	getAll(): AuthStorageData {
		return { ...this.data };
	}

	drainErrors(): Error[] {
		const drained = [...this.errors];
		this.errors = [];
		return drained;
	}

	/**
	 * Login to an OAuth provider.
	 *
	 * If `targetIndex` is provided, the credential at that index is replaced
	 * unconditionally (used when the user explicitly picks a slot from the UI).
	 *
	 * Otherwise, if the new credential carries an accountId matching an existing
	 * entry in the pool it is replaced in-place; if not it is appended.
	 */
	async login(providerId: OAuthProviderId, callbacks: OAuthLoginCallbacks, targetIndex?: number): Promise<void> {
		const provider = getOAuthProvider(providerId);
		if (!provider) {
			throw new Error(`Unknown OAuth provider: ${providerId}`);
		}

		const credentials = await provider.login(callbacks);
		const newCred: AuthCredential = { type: "oauth", ...credentials };

		// Explicit slot selection from the UI — replace in-place
		if (targetIndex !== undefined) {
			const existing = this.toArray(this.data[providerId]);
			if (targetIndex >= 0 && targetIndex < existing.length) {
				this.setCredentialAt(providerId, targetIndex, newCred);
				return;
			}
		}

		// Automatic deduplication by accountId
		const accountId = typeof credentials.accountId === "string" ? credentials.accountId : undefined;
		if (accountId) {
			const existing = this.toArray(this.data[providerId]);
			const matchIdx = existing.findIndex((c) => c.type === "oauth" && c.accountId === accountId);
			if (matchIdx !== -1) {
				this.setCredentialAt(providerId, matchIdx, newCred);
				return;
			}
		}

		this.addCredential(providerId, newCred);
	}

	/**
	 * Logout from a provider.
	 */
	logout(provider: string): void {
		this.remove(provider);
	}

	/**
	 * Refresh OAuth token with backend locking to prevent race conditions.
	 * Multiple pi instances may try to refresh simultaneously when tokens expire.
	 * @param credIndex - The index of the credential within the provider's pool to refresh.
	 */
	private async refreshOAuthTokenWithLock(
		providerId: OAuthProviderId,
		credIndex: number,
	): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
		const provider = getOAuthProvider(providerId);
		if (!provider) {
			return null;
		}

		const result = await this.storage.withLockAsync(async (current) => {
			const currentData = this.parseStorageData(current);
			this.data = currentData;
			this.loadError = null;

			const arr = this.toArray(currentData[providerId]);
			const cred = arr[credIndex];
			if (!cred || cred.type !== "oauth") {
				return { result: null };
			}

			if (Date.now() < cred.expires) {
				return { result: { apiKey: provider.getApiKey(cred), newCredentials: cred } };
			}

			// Build single-entry map for getOAuthApiKey (it expects Record<providerId, creds>)
			const oauthCreds: Record<string, OAuthCredentials> = { [providerId]: cred };

			const refreshed = await getOAuthApiKey(providerId, oauthCreds);
			if (!refreshed) {
				return { result: null };
			}

			// Update the specific credential in the array
			const updatedArr = [...arr];
			updatedArr[credIndex] = { type: "oauth", ...refreshed.newCredentials };
			const value = this.fromArray(updatedArr)!;

			const merged: AuthStorageData = {
				...currentData,
				[providerId]: value,
			};
			this.data = merged;
			this.loadError = null;
			return { result: refreshed, next: JSON.stringify(merged, null, 2) };
		});

		return result;
	}

	/**
	 * Get API key for a provider.
	 * Priority:
	 * 1. Runtime override (CLI --api-key)
	 * 2. API key from auth.json
	 * 3. OAuth token from auth.json (auto-refreshed with locking)
	 * 4. Environment variable
	 * 5. Fallback resolver (models.json custom providers)
	 */
	async getApiKey(providerId: string, options?: { includeFallback?: boolean }): Promise<string | undefined> {
		// Runtime override takes highest priority
		const runtimeKey = this.runtimeOverrides.get(providerId);
		if (runtimeKey) {
			return runtimeKey;
		}

		const arr = this.toArray(this.data[providerId]);
		const activeIdx = this.activeIndices.get(providerId) ?? 0;
		const cred = arr.length > 0 ? arr[activeIdx % arr.length] : undefined;

		if (cred?.type === "api_key") {
			return resolveConfigValue(cred.key);
		}

		if (cred?.type === "oauth") {
			const provider = getOAuthProvider(providerId);
			if (!provider) {
				// Unknown OAuth provider, can't get API key
				return undefined;
			}

			const credIndex = activeIdx % arr.length;

			// Check if token needs refresh
			const needsRefresh = Date.now() >= cred.expires;

			if (needsRefresh) {
				// Use locked refresh to prevent race conditions
				try {
					const result = await this.refreshOAuthTokenWithLock(providerId, credIndex);
					if (result) {
						return result.apiKey;
					}
				} catch (error) {
					this.recordError(error);
					// Refresh failed - re-read file to check if another instance succeeded
					this.reload();
					const updatedArr = this.toArray(this.data[providerId]);
					const updatedCred = updatedArr[credIndex];

					if (updatedCred?.type === "oauth" && Date.now() < updatedCred.expires) {
						// Another instance refreshed successfully, use those credentials
						return provider.getApiKey(updatedCred);
					}

					// Refresh truly failed - return undefined so model discovery skips this provider
					// User can /login to re-authenticate (credentials preserved for retry)
					return undefined;
				}
			} else {
				// Token not expired, use current access token
				return provider.getApiKey(cred);
			}
		}

		// Fall back to environment variable
		const envKey = getEnvApiKey(providerId);
		if (envKey) return envKey;

		// Fall back to custom resolver (e.g., models.json custom providers)
		if (options?.includeFallback !== false) {
			return this.fallbackResolver?.(providerId) ?? undefined;
		}

		return undefined;
	}

	/**
	 * Get all registered OAuth providers
	 */
	getOAuthProviders() {
		return getOAuthProviders();
	}
}
