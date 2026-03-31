import { isGrepToolResult, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function (pi: ExtensionAPI) {
	const home = process.env.HOME?.replace(/\/+$/, "");
	if (!home) return;

	const homePrefix = new RegExp(`${escapeRegExp(home)}(?=/|$)`, "g");

	pi.on("tool_result", (event) => {
		if (!isGrepToolResult(event) || event.isError) return;

		let changed = false;
		const content = event.content.map((part) => {
			if (part.type !== "text") return part;

			const nextText = part.text.replace(homePrefix, "~");
			if (nextText !== part.text) changed = true;

			return nextText === part.text ? part : { ...part, text: nextText };
		});

		if (!changed) return;
		return { content };
	});
}
