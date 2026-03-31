import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolvedConfigPaths {
	projectPath: string;
	globalPath: string;
	repoDefaultPath: string;
}

export type ConfigSource = "repo-default" | "global" | "project";

export interface AppliedConfigSource {
	scope: ConfigSource;
	path: string;
}

export interface ResolvedConfigResult<T> {
	config: T;
	sources: ConfigSource[];
	appliedSources: AppliedConfigSource[];
	paths: ResolvedConfigPaths;
}

export interface ResolveJsonConfigOptions<T> {
	cwd: string;
	extensionFileUrl: string;
	fileName: string;
	defaultConfig: T;
	parse: (value: unknown) => T;
	merge: (base: T, override: T) => T;
}

function getRepoRootFromExtensionFile(extensionFileUrl: string): string {
	const extensionFilePath = fileURLToPath(extensionFileUrl);
	return path.resolve(path.dirname(extensionFilePath), "..", "..");
}

function readJsonFile<T>(configPath: string, parse: (value: unknown) => T): T | null {
	if (!fs.existsSync(configPath)) return null;
	const content = fs.readFileSync(configPath, "utf8");
	const parsed = JSON.parse(content) as unknown;
	return parse(parsed);
}

export function resolveJsonConfig<T>(options: ResolveJsonConfigOptions<T>): ResolvedConfigResult<T> {
	const repoRoot = getRepoRootFromExtensionFile(options.extensionFileUrl);
	const projectPath = path.join(options.cwd, ".pi", options.fileName);
	const globalPath = path.join(os.homedir(), ".pi", "agent", options.fileName);
	const repoDefaultPath = path.join(repoRoot, ".pi", options.fileName);

	let config = options.defaultConfig;
	const sources: ConfigSource[] = [];
	const appliedSources: AppliedConfigSource[] = [];

	const repoDefault = readJsonFile(repoDefaultPath, options.parse);
	if (repoDefault !== null) {
		config = options.merge(config, repoDefault);
		sources.push("repo-default");
		appliedSources.push({ scope: "repo-default", path: repoDefaultPath });
	}

	const globalConfig = readJsonFile(globalPath, options.parse);
	if (globalConfig !== null) {
		config = options.merge(config, globalConfig);
		sources.push("global");
		appliedSources.push({ scope: "global", path: globalPath });
	}

	const projectConfig = readJsonFile(projectPath, options.parse);
	if (projectConfig !== null) {
		config = options.merge(config, projectConfig);
		sources.push("project");
		appliedSources.push({ scope: "project", path: projectPath });
	}

	return {
		config,
		sources,
		appliedSources,
		paths: {
			projectPath,
			globalPath,
			repoDefaultPath,
		},
	};
}
