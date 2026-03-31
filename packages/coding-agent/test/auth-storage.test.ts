import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerOAuthProvider } from "@mariozechner/pi-ai/oauth";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { clearConfigValueCache } from "../src/core/resolve-config-value.js";

describe("AuthStorage", () => {
	let tempDir: string;
	let authJsonPath: string;
	let authStorage: AuthStorage;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-test-auth-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		authJsonPath = join(tempDir, "auth.json");
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
		clearConfigValueCache();
		vi.restoreAllMocks();
	});

	function writeAuthJson(data: Record<string, unknown>) {
		writeFileSync(authJsonPath, JSON.stringify(data));
	}

	function toShPath(value: string): string {
		return value.replace(/\\/g, "/").replace(/"/g, '\\"');
	}

	describe("API key resolution", () => {
		test("literal API key is returned directly", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "sk-ant-literal-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBe("sk-ant-literal-key");
		});

		test("apiKey with ! prefix executes command and uses stdout", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!echo test-api-key-from-command" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBe("test-api-key-from-command");
		});

		test("apiKey with ! prefix trims whitespace from command output", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!echo '  spaced-key  '" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBe("spaced-key");
		});

		test("apiKey with ! prefix handles multiline output (uses trimmed result)", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!printf 'line1\\nline2'" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBe("line1\nline2");
		});

		test("apiKey with ! prefix returns undefined on command failure", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!exit 1" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey with ! prefix returns undefined on nonexistent command", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!nonexistent-command-12345" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey with ! prefix returns undefined on empty output", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!printf ''" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBeUndefined();
		});

		test("apiKey as environment variable name resolves to env value", async () => {
			const originalEnv = process.env.TEST_AUTH_API_KEY_12345;
			process.env.TEST_AUTH_API_KEY_12345 = "env-api-key-value";

			try {
				writeAuthJson({
					anthropic: { type: "api_key", key: "TEST_AUTH_API_KEY_12345" },
				});

				authStorage = AuthStorage.create(authJsonPath);
				const apiKey = await authStorage.getApiKey("anthropic");

				expect(apiKey).toBe("env-api-key-value");
			} finally {
				if (originalEnv === undefined) {
					delete process.env.TEST_AUTH_API_KEY_12345;
				} else {
					process.env.TEST_AUTH_API_KEY_12345 = originalEnv;
				}
			}
		});

		test("apiKey as literal value is used directly when not an env var", async () => {
			// Make sure this isn't an env var
			delete process.env.literal_api_key_value;

			writeAuthJson({
				anthropic: { type: "api_key", key: "literal_api_key_value" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBe("literal_api_key_value");
		});

		test("apiKey command can use shell features like pipes", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!echo 'hello world' | tr ' ' '-'" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBe("hello-world");
		});

		describe("caching", () => {
			test("command is only executed once per process", async () => {
				// Use a command that writes to a file to count invocations
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeAuthJson({
					anthropic: { type: "api_key", key: command },
				});

				authStorage = AuthStorage.create(authJsonPath);

				// Call multiple times
				await authStorage.getApiKey("anthropic");
				await authStorage.getApiKey("anthropic");
				await authStorage.getApiKey("anthropic");

				// Command should have only run once
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(1);
			});

			test("cache persists across AuthStorage instances", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeAuthJson({
					anthropic: { type: "api_key", key: command },
				});

				// Create multiple AuthStorage instances
				const storage1 = AuthStorage.create(authJsonPath);
				await storage1.getApiKey("anthropic");

				const storage2 = AuthStorage.create(authJsonPath);
				await storage2.getApiKey("anthropic");

				// Command should still have only run once
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(1);
			});

			test("clearConfigValueCache allows command to run again", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
				writeAuthJson({
					anthropic: { type: "api_key", key: command },
				});

				authStorage = AuthStorage.create(authJsonPath);
				await authStorage.getApiKey("anthropic");

				// Clear cache and call again
				clearConfigValueCache();
				await authStorage.getApiKey("anthropic");

				// Command should have run twice
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(2);
			});

			test("different commands are cached separately", async () => {
				writeAuthJson({
					anthropic: { type: "api_key", key: "!echo key-anthropic" },
					openai: { type: "api_key", key: "!echo key-openai" },
				});

				authStorage = AuthStorage.create(authJsonPath);

				const keyA = await authStorage.getApiKey("anthropic");
				const keyB = await authStorage.getApiKey("openai");

				expect(keyA).toBe("key-anthropic");
				expect(keyB).toBe("key-openai");
			});

			test("failed commands are cached (not retried)", async () => {
				const counterFile = join(tempDir, "counter");
				writeFileSync(counterFile, "0");

				const counterPath = toShPath(counterFile);
				const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; exit 1'`;
				writeAuthJson({
					anthropic: { type: "api_key", key: command },
				});

				authStorage = AuthStorage.create(authJsonPath);

				// Call multiple times - all should return undefined
				const key1 = await authStorage.getApiKey("anthropic");
				const key2 = await authStorage.getApiKey("anthropic");

				expect(key1).toBeUndefined();
				expect(key2).toBeUndefined();

				// Command should have only run once despite failures
				const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
				expect(count).toBe(1);
			});

			test("environment variables are not cached (changes are picked up)", async () => {
				const envVarName = "TEST_AUTH_KEY_CACHE_TEST_98765";
				const originalEnv = process.env[envVarName];

				try {
					process.env[envVarName] = "first-value";

					writeAuthJson({
						anthropic: { type: "api_key", key: envVarName },
					});

					authStorage = AuthStorage.create(authJsonPath);

					const key1 = await authStorage.getApiKey("anthropic");
					expect(key1).toBe("first-value");

					// Change env var
					process.env[envVarName] = "second-value";

					const key2 = await authStorage.getApiKey("anthropic");
					expect(key2).toBe("second-value");
				} finally {
					if (originalEnv === undefined) {
						delete process.env[envVarName];
					} else {
						process.env[envVarName] = originalEnv;
					}
				}
			});
		});
	});

	describe("oauth lock compromise handling", () => {
		test("returns undefined on compromised lock and allows a later retry", async () => {
			const providerId = `test-oauth-provider-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			registerOAuthProvider({
				id: providerId,
				name: "Test OAuth Provider",
				async login() {
					throw new Error("Not used in this test");
				},
				async refreshToken(credentials) {
					return {
						...credentials,
						access: "refreshed-access-token",
						expires: Date.now() + 60_000,
					};
				},
				getApiKey(credentials) {
					return `Bearer ${credentials.access}`;
				},
			});

			writeAuthJson({
				[providerId]: {
					type: "oauth",
					refresh: "refresh-token",
					access: "expired-access-token",
					expires: Date.now() - 10_000,
				},
			});

			authStorage = AuthStorage.create(authJsonPath);

			const realLock = lockfile.lock.bind(lockfile);
			const lockSpy = vi.spyOn(lockfile, "lock");
			lockSpy.mockImplementationOnce(async (file, options) => {
				options?.onCompromised?.(new Error("Unable to update lock within the stale threshold"));
				return realLock(file, options);
			});

			const firstTry = await authStorage.getApiKey(providerId);
			expect(firstTry).toBeUndefined();

			lockSpy.mockRestore();

			const secondTry = await authStorage.getApiKey(providerId);
			expect(secondTry).toBe("Bearer refreshed-access-token");
		});
	});

	describe("persistence semantics", () => {
		test("set preserves unrelated external edits", () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "old-anthropic" },
				openai: { type: "api_key", key: "openai-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);

			// Simulate external edit while process is running
			writeAuthJson({
				anthropic: { type: "api_key", key: "old-anthropic" },
				openai: { type: "api_key", key: "openai-key" },
				google: { type: "api_key", key: "google-key" },
			});

			authStorage.set("anthropic", { type: "api_key", key: "new-anthropic" });

			const updated = JSON.parse(readFileSync(authJsonPath, "utf-8")) as Record<string, { key: string }>;
			expect(updated.anthropic.key).toBe("new-anthropic");
			expect(updated.openai.key).toBe("openai-key");
			expect(updated.google.key).toBe("google-key");
		});

		test("remove preserves unrelated external edits", () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "anthropic-key" },
				openai: { type: "api_key", key: "openai-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);

			// Simulate external edit while process is running
			writeAuthJson({
				anthropic: { type: "api_key", key: "anthropic-key" },
				openai: { type: "api_key", key: "openai-key" },
				google: { type: "api_key", key: "google-key" },
			});

			authStorage.remove("anthropic");

			const updated = JSON.parse(readFileSync(authJsonPath, "utf-8")) as Record<string, { key: string }>;
			expect(updated.anthropic).toBeUndefined();
			expect(updated.openai.key).toBe("openai-key");
			expect(updated.google.key).toBe("google-key");
		});

		test("does not overwrite malformed auth file after load error", () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "anthropic-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			writeFileSync(authJsonPath, "{invalid-json", "utf-8");

			authStorage.reload();
			authStorage.set("openai", { type: "api_key", key: "openai-key" });

			const raw = readFileSync(authJsonPath, "utf-8");
			expect(raw).toBe("{invalid-json");
		});

		test("reload records parse errors and drainErrors clears buffer", () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "anthropic-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			writeFileSync(authJsonPath, "{invalid-json", "utf-8");

			authStorage.reload();

			// Keeps previous in-memory data on reload failure
			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "anthropic-key" });

			const firstDrain = authStorage.drainErrors();
			expect(firstDrain.length).toBeGreaterThan(0);
			expect(firstDrain[0]).toBeInstanceOf(Error);

			const secondDrain = authStorage.drainErrors();
			expect(secondDrain).toHaveLength(0);
		});
	});

	describe("multi-credential pool", () => {
		test("addCredential creates array when provider already has a credential", () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "key-1" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.addCredential("anthropic", { type: "api_key", key: "key-2" });

			expect(authStorage.getCredentialCount("anthropic")).toBe(2);
			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "key-1" });

			const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
			expect(Array.isArray(raw.anthropic)).toBe(true);
			expect(raw.anthropic).toHaveLength(2);
		});

		test("addCredential on empty provider stores single credential (not array)", () => {
			writeAuthJson({});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.addCredential("anthropic", { type: "api_key", key: "key-1" });

			expect(authStorage.getCredentialCount("anthropic")).toBe(1);

			const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
			expect(Array.isArray(raw.anthropic)).toBe(false);
			expect(raw.anthropic.key).toBe("key-1");
		});

		test("get returns active credential based on index", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
					{ type: "api_key", key: "key-C" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);

			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "key-A" });
			expect(authStorage.getActiveIndex("anthropic")).toBe(0);
		});

		test("rotateCredential cycles through credentials", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
					{ type: "api_key", key: "key-C" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);

			expect(authStorage.rotateCredential("anthropic")).toBe(true);
			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "key-B" });
			expect(authStorage.getActiveIndex("anthropic")).toBe(1);

			expect(authStorage.rotateCredential("anthropic")).toBe(true);
			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "key-C" });

			// Wraps around
			expect(authStorage.rotateCredential("anthropic")).toBe(true);
			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "key-A" });
			expect(authStorage.getActiveIndex("anthropic")).toBe(0);
		});

		test("rotateCredential returns false for single credential", () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "key-only" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			expect(authStorage.rotateCredential("anthropic")).toBe(false);
		});

		test("rotateCredential returns false for missing provider", () => {
			writeAuthJson({});

			authStorage = AuthStorage.create(authJsonPath);
			expect(authStorage.rotateCredential("anthropic")).toBe(false);
		});

		test("getApiKey returns key for active credential in pool", async () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);

			const key1 = await authStorage.getApiKey("anthropic");
			expect(key1).toBe("key-A");

			authStorage.rotateCredential("anthropic");

			const key2 = await authStorage.getApiKey("anthropic");
			expect(key2).toBe("key-B");
		});

		test("removeCredentialAt removes specific credential and adjusts pool", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
					{ type: "api_key", key: "key-C" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.removeCredentialAt("anthropic", 1);

			expect(authStorage.getCredentialCount("anthropic")).toBe(2);
			expect(authStorage.getCredentials("anthropic")).toEqual([
				{ type: "api_key", key: "key-A" },
				{ type: "api_key", key: "key-C" },
			]);

			const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
			expect(raw.anthropic).toHaveLength(2);
		});

		test("removeCredentialAt collapses array to single credential when one left", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.removeCredentialAt("anthropic", 0);

			expect(authStorage.getCredentialCount("anthropic")).toBe(1);
			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "key-B" });

			const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
			expect(Array.isArray(raw.anthropic)).toBe(false);
			expect(raw.anthropic.key).toBe("key-B");
		});

		test("removeCredentialAt adjusts active index when removing before it", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
					{ type: "api_key", key: "key-C" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);
			// Rotate to key-C (index 2)
			authStorage.rotateCredential("anthropic");
			authStorage.rotateCredential("anthropic");
			expect(authStorage.getActiveIndex("anthropic")).toBe(2);

			// Remove last element, active index should clamp
			authStorage.removeCredentialAt("anthropic", 2);
			expect(authStorage.getActiveIndex("anthropic")).toBe(1);
			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "key-B" });
		});

		test("remove clears all credentials and active index", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.rotateCredential("anthropic");
			authStorage.remove("anthropic");

			expect(authStorage.has("anthropic")).toBe(false);
			expect(authStorage.getCredentialCount("anthropic")).toBe(0);
			expect(authStorage.get("anthropic")).toBeUndefined();
		});

		test("set replaces entire pool with single credential", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.rotateCredential("anthropic");
			authStorage.set("anthropic", { type: "api_key", key: "key-new" });

			expect(authStorage.getCredentialCount("anthropic")).toBe(1);
			expect(authStorage.get("anthropic")).toEqual({ type: "api_key", key: "key-new" });
			expect(authStorage.getActiveIndex("anthropic")).toBe(0);
		});

		test("getCredentials returns full array for pool", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);
			const creds = authStorage.getCredentials("anthropic");
			expect(creds).toHaveLength(2);
			expect(creds[0]).toEqual({ type: "api_key", key: "key-A" });
			expect(creds[1]).toEqual({ type: "api_key", key: "key-B" });
		});

		test("getCredentials returns single-element array for non-pool", () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "key-only" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			const creds = authStorage.getCredentials("anthropic");
			expect(creds).toHaveLength(1);
			expect(creds[0]).toEqual({ type: "api_key", key: "key-only" });
		});

		test("login replaces credential with matching accountId", async () => {
			const providerId = `test-accountid-replace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			let callCount = 0;
			registerOAuthProvider({
				id: providerId,
				name: "Test AccountId Provider",
				async login() {
					callCount++;
					return {
						refresh: `refresh-${callCount}`,
						access: `access-${callCount}`,
						expires: Date.now() + 60_000,
						accountId: callCount === 1 ? "account-A" : "account-B",
					};
				},
				async refreshToken(credentials) {
					return credentials;
				},
				getApiKey(credentials) {
					return credentials.access;
				},
			});

			writeAuthJson({});
			authStorage = AuthStorage.create(authJsonPath);

			const callbacks = {
				onAuth: () => {},
				onPrompt: async () => "",
			};

			// First login: account-A (callCount=1, access-1)
			await authStorage.login(providerId, callbacks);
			expect(authStorage.getCredentialCount(providerId)).toBe(1);

			// Second login: account-B (callCount=2, access-2) — different account, appended
			await authStorage.login(providerId, callbacks);
			expect(authStorage.getCredentialCount(providerId)).toBe(2);

			// Third login: account-B again (callCount=3, access-3) — same accountId, replaces index 1
			await authStorage.login(providerId, callbacks);
			expect(authStorage.getCredentialCount(providerId)).toBe(2);

			const all = authStorage.getCredentials(providerId);
			expect(all[0]).toMatchObject({ accountId: "account-A", access: "access-1" });
			expect(all[1]).toMatchObject({ accountId: "account-B", access: "access-3" });
		});

		test("login appends to existing credentials via addCredential", async () => {
			const providerId = `test-login-pool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			let callCount = 0;
			registerOAuthProvider({
				id: providerId,
				name: "Test Pool Provider",
				async login() {
					callCount++;
					return {
						refresh: `refresh-${callCount}`,
						access: `access-${callCount}`,
						expires: Date.now() + 60_000,
					};
				},
				async refreshToken(credentials) {
					return credentials;
				},
				getApiKey(credentials) {
					return credentials.access;
				},
			});

			writeAuthJson({});
			authStorage = AuthStorage.create(authJsonPath);

			const callbacks = {
				onAuth: () => {},
				onPrompt: async () => "",
			};

			// First login
			await authStorage.login(providerId, callbacks);
			expect(authStorage.getCredentialCount(providerId)).toBe(1);

			// Second login appends
			await authStorage.login(providerId, callbacks);
			expect(authStorage.getCredentialCount(providerId)).toBe(2);

			// Both credentials are available
			const key1 = await authStorage.getApiKey(providerId);
			expect(key1).toBe("access-1");

			authStorage.rotateCredential(providerId);
			const key2 = await authStorage.getApiKey(providerId);
			expect(key2).toBe("access-2");
		});

		test("oauth refresh works for specific credential in pool", async () => {
			const providerId = `test-refresh-pool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			registerOAuthProvider({
				id: providerId,
				name: "Test Refresh Pool",
				async login() {
					throw new Error("Not used");
				},
				async refreshToken(credentials) {
					return {
						...credentials,
						access: `refreshed-${credentials.refresh}`,
						expires: Date.now() + 60_000,
					};
				},
				getApiKey(credentials) {
					return credentials.access;
				},
			});

			writeAuthJson({
				[providerId]: [
					{
						type: "oauth",
						refresh: "refresh-1",
						access: "valid-access-1",
						expires: Date.now() + 60_000,
					},
					{
						type: "oauth",
						refresh: "refresh-2",
						access: "expired-access-2",
						expires: Date.now() - 10_000,
					},
				],
			});

			authStorage = AuthStorage.create(authJsonPath);

			// First credential is valid
			const key1 = await authStorage.getApiKey(providerId);
			expect(key1).toBe("valid-access-1");

			// Rotate to expired credential - should auto-refresh
			authStorage.rotateCredential(providerId);
			const key2 = await authStorage.getApiKey(providerId);
			expect(key2).toBe("refreshed-refresh-2");

			// Verify only the second credential was refreshed on disk
			const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
			const arr = raw[providerId];
			expect(arr).toHaveLength(2);
			expect(arr[0].access).toBe("valid-access-1");
			expect(arr[1].access).toBe("refreshed-refresh-2");
		});

		test("has and hasAuth work with credential pools", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
				],
			});

			authStorage = AuthStorage.create(authJsonPath);
			expect(authStorage.has("anthropic")).toBe(true);
			expect(authStorage.hasAuth("anthropic")).toBe(true);
			expect(authStorage.has("openai")).toBe(false);
		});

		test("list returns providers with credential pools", () => {
			writeAuthJson({
				anthropic: [
					{ type: "api_key", key: "key-A" },
					{ type: "api_key", key: "key-B" },
				],
				openai: { type: "api_key", key: "key-openai" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			expect(authStorage.list()).toEqual(["anthropic", "openai"]);
		});

		test("addCredential persists array to disk preserving unrelated providers", () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "key-A" },
				openai: { type: "api_key", key: "key-openai" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.addCredential("anthropic", { type: "api_key", key: "key-B" });

			const raw = JSON.parse(readFileSync(authJsonPath, "utf-8"));
			expect(raw.anthropic).toHaveLength(2);
			expect(raw.openai.key).toBe("key-openai");
		});
	});

	describe("runtime overrides", () => {
		test("runtime override takes priority over auth.json", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!echo stored-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.setRuntimeApiKey("anthropic", "runtime-key");

			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBe("runtime-key");
		});

		test("removing runtime override falls back to auth.json", async () => {
			writeAuthJson({
				anthropic: { type: "api_key", key: "!echo stored-key" },
			});

			authStorage = AuthStorage.create(authJsonPath);
			authStorage.setRuntimeApiKey("anthropic", "runtime-key");
			authStorage.removeRuntimeApiKey("anthropic");

			const apiKey = await authStorage.getApiKey("anthropic");

			expect(apiKey).toBe("stored-key");
		});
	});
});
