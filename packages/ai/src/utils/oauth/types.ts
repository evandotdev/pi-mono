import type { Api, Model } from "../../types.js";

export type OAuthCredentials = {
	refresh: string;
	access: string;
	expires: number;
	[key: string]: unknown;
};

export type OAuthProviderId = string;

/** @deprecated Use OAuthProviderId instead */
export type OAuthProvider = OAuthProviderId;

export type OAuthPrompt = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
};

export type OAuthAuthInfo = {
	url: string;
	instructions?: string;
};

export interface OAuthLoginCallbacks {
	onAuth: (info: OAuthAuthInfo) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	signal?: AbortSignal;
}

export type UsageWindow = {
	/** Utilization as a percentage (0–100) */
	utilizationPercent: number;
	/** When this window resets, epoch ms */
	resetsAt?: number;
};

export type ProviderUsage = {
	/** Named usage windows, e.g. "5h", "7d" */
	windows: Record<string, UsageWindow>;
};

export interface OAuthProviderInterface {
	readonly id: OAuthProviderId;
	readonly name: string;

	/** Run the login flow, return credentials to persist */
	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;

	/** Whether login uses a local callback server and supports manual code input. */
	usesCallbackServer?: boolean;

	/** Refresh expired credentials, return updated credentials to persist */
	refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;

	/** Convert credentials to API key string for the provider */
	getApiKey(credentials: OAuthCredentials): string;

	/** Optional: fetch current usage/limit data for this provider */
	fetchUsage?(credentials: OAuthCredentials): Promise<ProviderUsage | null>;

	/** Optional: modify models for this provider (e.g., update baseUrl) */
	modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[];
}

/** @deprecated Use OAuthProviderInterface instead */
export interface OAuthProviderInfo {
	id: OAuthProviderId;
	name: string;
	available: boolean;
}
