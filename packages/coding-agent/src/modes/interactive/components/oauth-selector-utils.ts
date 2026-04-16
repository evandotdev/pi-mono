export function formatOAuthUsageErrorLabel(mode: "login" | "logout", error: string | undefined): string | undefined {
	if (mode !== "login") return undefined;
	const message = error?.trim();
	if (!message) return undefined;
	return `usage unavailable: ${message}`;
}
