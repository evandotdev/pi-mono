#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_IMAGE = "pi-sandbox:latest";
const DEFAULT_IMAGE_REPO = "pi-sandbox";

const HASH_ENTRIES = [
	"docker/pi-sandbox/Dockerfile",
	"package.json",
	"package-lock.json",
	"tsconfig.base.json",
	"tsconfig.json",
	"biome.json",
	"packages/ai",
	"packages/agent",
	"packages/tui",
	"packages/coding-agent",
];

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".next", ".turbo", "coverage", ".cache"]);

export function isDefaultSandboxImage(image) {
	if (!image) return true;
	return image.trim() === DEFAULT_IMAGE;
}

function collectFiles(root, relativePath, out) {
	const absolutePath = path.join(root, relativePath);
	if (!existsSync(absolutePath)) return;

	const stats = statSync(absolutePath);
	if (stats.isFile()) {
		out.push(relativePath.split(path.sep).join("/"));
		return;
	}

	if (!stats.isDirectory()) return;

	const entries = readdirSync(absolutePath, { withFileTypes: true })
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	for (const entry of entries) {
		if (SKIP_DIRS.has(entry)) continue;
		collectFiles(root, path.join(relativePath, entry), out);
	}
}

export function computeLocalSandboxImageTag(repoRoot) {
	const files = [];
	for (const entry of HASH_ENTRIES) {
		collectFiles(repoRoot, entry, files);
	}

	const hash = createHash("sha256");
	for (const relativePath of files) {
		const absolutePath = path.join(repoRoot, relativePath);
		hash.update(relativePath);
		hash.update("\n");
		hash.update(readFileSync(absolutePath));
		hash.update("\n");
	}

	const digest = hash.digest("hex").slice(0, 12);
	return `${DEFAULT_IMAGE_REPO}:${digest}`;
}

export function resolveSandboxImage(image, repoRoot) {
	if (isDefaultSandboxImage(image)) {
		return computeLocalSandboxImageTag(repoRoot);
	}
	return image.trim();
}

const scriptPath = fileURLToPath(import.meta.url);

function parseArgs(argv) {
	let repoRoot = path.resolve(path.dirname(scriptPath), "..");
	let image = DEFAULT_IMAGE;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--repo-root") {
			repoRoot = path.resolve(argv[++i]);
			continue;
		}
		if (arg === "--image") {
			image = argv[++i];
			continue;
		}
	}

	return { repoRoot, image };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath);
if (isMain) {
	const { repoRoot, image } = parseArgs(process.argv.slice(2));
	process.stdout.write(resolveSandboxImage(image, repoRoot));
}
