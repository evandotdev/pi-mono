declare module "@anthropic-ai/sandbox-runtime" {
	export interface SandboxNetworkConfig {
		allowedDomains?: string[];
		deniedDomains?: string[];
	}

	export interface SandboxFilesystemConfig {
		denyRead?: string[];
		allowWrite?: string[];
		denyWrite?: string[];
	}

	export interface SandboxRuntimeConfig {
		enabled?: boolean;
		network?: SandboxNetworkConfig;
		filesystem?: SandboxFilesystemConfig;
		ignoreViolations?: Record<string, string[]>;
		enableWeakerNestedSandbox?: boolean;
	}

	export interface SandboxInitializeOptions extends SandboxRuntimeConfig {}

	export const SandboxManager: {
		initialize(options?: SandboxInitializeOptions): Promise<void>;
		wrapWithSandbox(command: string): Promise<string>;
		reset(): Promise<void>;
	};
}
