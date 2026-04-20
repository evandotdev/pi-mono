import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { SessionManager } from "../src/core/session-manager.js";

type RuntimeFixture = {
	runtimeHost: Awaited<ReturnType<typeof createAgentSessionRuntime>>;
	repoA: string;
	repoB: string;
	sessionDir: string;
	cleanup: () => Promise<void>;
};

describe("AgentSessionRuntime cwd switching", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) {
			await cleanups.pop()?.();
		}
	});

	async function createRuntimeFixture(): Promise<RuntimeFixture> {
		const tempDir = join(tmpdir(), `pi-runtime-cwd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const repoA = join(tempDir, "repo-a");
		const repoB = join(tempDir, "repo-b");
		const agentDir = join(tempDir, "agent");
		const sessionDir = join(tempDir, "sessions");
		mkdirSync(repoA, { recursive: true });
		mkdirSync(repoB, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(sessionDir, { recursive: true });

		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);

		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(faux.getModel().provider, "faux-key");

		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				authStorage,
				modelRegistry: undefined,
				resourceLoaderOptions: {
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
				},
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtimeHost = await createAgentSessionRuntime(createRuntime, {
			cwd: repoA,
			agentDir,
			sessionManager: SessionManager.create(repoA, sessionDir),
		});

		const cleanup = async () => {
			await runtimeHost.dispose();
			faux.unregister();
			process.chdir(tmpdir());
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true, force: true });
			}
		};
		cleanups.push(cleanup);

		return { runtimeHost, repoA, repoB, sessionDir, cleanup };
	}

	it("switches the effective cwd while keeping session storage anchored", async () => {
		const { runtimeHost, repoA, repoB, sessionDir } = await createRuntimeFixture();
		await runtimeHost.session.prompt("hello");

		const sessionFile = runtimeHost.session.sessionFile;
		expect(sessionFile).toBeTruthy();
		expect(runtimeHost.session.sessionManager.getCwd()).toBe(repoA);
		expect(runtimeHost.session.sessionManager.getSessionDir()).toBe(sessionDir);

		const result = await runtimeHost.switchCwd(repoB);
		expect(result).toEqual({ cancelled: false, changed: true });
		expect(runtimeHost.cwd).toBe(repoB);
		expect(runtimeHost.session.sessionManager.getCwd()).toBe(repoB);
		expect(runtimeHost.session.sessionManager.getSessionDir()).toBe(sessionDir);
		expect(runtimeHost.session.sessionFile).toBe(sessionFile);
		expect(SessionManager.open(sessionFile!, sessionDir).getCwd()).toBe(repoB);
	});

	it("does not treat shell cd commands as session cwd changes", async () => {
		const { runtimeHost, repoA, repoB } = await createRuntimeFixture();

		const result = await runtimeHost.session.executeBash(`cd ${JSON.stringify(repoB)} && pwd`);
		expect(result.exitCode).toBe(0);
		expect(runtimeHost.session.sessionManager.getCwd()).toBe(repoA);
		expect(runtimeHost.cwd).toBe(repoA);
	});
});
