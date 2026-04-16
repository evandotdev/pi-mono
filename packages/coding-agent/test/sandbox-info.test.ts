import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectSandboxReport, formatSandboxReport } from "../src/core/sandbox-info.js";

describe("sandbox info report", () => {
	let tempDir: string;
	let homeDir: string;
	let agentDir: string;
	let projectRoot: string;
	let nestedCwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-sandbox-info-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		homeDir = join(tempDir, "home");
		agentDir = join(tempDir, "agent");
		projectRoot = join(tempDir, "project");
		nestedCwd = join(projectRoot, "packages", "coding-agent");

		mkdirSync(homeDir, { recursive: true });
		mkdirSync(join(agentDir, "extensions"), { recursive: true });
		mkdirSync(join(projectRoot, ".pi"), { recursive: true });
		mkdirSync(nestedCwd, { recursive: true });

		const dotfilesPi = join(tempDir, "dotfiles", ".pi");
		mkdirSync(dotfilesPi, { recursive: true });
		symlinkSync(dotfilesPi, join(homeDir, ".pi"));

		writeFileSync(
			join(agentDir, "extensions", "sandbox.json"),
			JSON.stringify(
				{
					enabled: true,
					network: {
						allowedDomains: ["global.example"],
						deniedDomains: ["deny.global"],
					},
					filesystem: {
						allowWrite: [".", "/tmp"],
						denyRead: ["~/.aws"],
					},
				},
				null,
				2,
			),
		);

		writeFileSync(
			join(agentDir, "extensions", "docker-sandbox.json"),
			JSON.stringify(
				{
					enabled: true,
					image: "global-image",
					network: "bridge",
					folders: ["."],
				},
				null,
				2,
			),
		);

		writeFileSync(
			join(projectRoot, ".pi", "sandbox.json"),
			JSON.stringify(
				{
					enabled: false,
					network: {
						deniedDomains: ["deny.project"],
					},
					filesystem: {
						denyWrite: [".env"],
					},
				},
				null,
				2,
			),
		);

		writeFileSync(
			join(projectRoot, ".pi", "docker-sandbox.json"),
			JSON.stringify(
				{
					folders: [".", "../shared"],
					passEnv: false,
				},
				null,
				2,
			),
		);
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("collects config precedence, ownership, and file map details", () => {
		const report = collectSandboxReport({ cwd: nestedCwd, homeDir, agentDir });
		const output = formatSandboxReport(report);

		expect(report.projectRoot).toBe(projectRoot);
		expect(report.homePi.kind).toBe("symlink");
		expect(report.homePi.target).toBe(join(tempDir, "dotfiles", ".pi"));
		expect(report.osSandbox.resolved.enabled).toBe(false);
		expect(report.osSandbox.resolved.network?.allowedDomains).toContain("global.example");
		expect(report.osSandbox.resolved.network?.deniedDomains).toContain("deny.project");
		expect(report.osSandbox.resolved.filesystem?.denyWrite).toContain(".env");
		expect(report.dockerSandbox.resolved.image).toBe("global-image");
		expect(report.dockerSandbox.resolved.network).toBe("bridge");
		expect(report.dockerSandbox.resolved.folders).toEqual([".", "../shared"]);
		expect(report.dockerSandbox.resolved.passEnv).toBe(false);
		expect(output).toContain("/sandbox:info");
		expect(output).toContain("scripts/pi-sandbox.mjs");
		expect(output).toContain(".mise/tasks/pi/stow/mise/install");
		expect(output).toContain("Editing map:");
		expect(output).toContain("Docker sandbox config:");
		expect(output).toContain("OS sandbox config:");
	});
});
