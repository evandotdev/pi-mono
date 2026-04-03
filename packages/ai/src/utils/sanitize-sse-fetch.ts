/**
 * Custom fetch wrapper that sanitizes control characters from SSE response streams.
 *
 * The Anthropic API occasionally emits raw C0 control characters (U+0000–U+001F)
 * inside JSON string values in SSE data lines. These are invalid per RFC 8259 and
 * cause `JSON.parse()` to throw "Bad control character in string literal in JSON".
 *
 * Unicode line/paragraph separators (U+2028, U+2029) and NEL (U+0085) can also
 * cause issues with line-based parsers.
 *
 * This wrapper intercepts streaming responses and escapes these characters to their
 * `\uXXXX` equivalents before the SDK's SSE parser sees them.
 *
 * @see https://github.com/anthropics/anthropic-sdk-typescript/issues/882
 */

/**
 * Regex matching characters that are invalid inside JSON string literals:
 * - U+0000–U+0008 (C0 controls before TAB)
 * - U+000B (VT)
 * - U+000C (FF)
 * - U+000E–U+001F (C0 controls after CR)
 * - U+007F (DEL)
 * - U+0085 (NEL)
 * - U+2028 (LINE SEPARATOR)
 * - U+2029 (PARAGRAPH SEPARATOR)
 *
 * Deliberately excludes \t (0x09), \n (0x0A), \r (0x0D) — these are valid SSE
 * framing characters and are handled by JSON.parse when properly escaped by the API.
 */
const BAD_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u0085\u2028\u2029]/g;

function escapeChar(char: string): string {
	return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
}

/**
 * Wraps a fetch function to sanitize control characters from response body streams.
 * Only transforms streaming (SSE) responses; non-streaming responses pass through unchanged.
 */
export function createSanitizingFetch(baseFetch?: typeof globalThis.fetch): typeof globalThis.fetch {
	const fetchFn = baseFetch ?? globalThis.fetch;

	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const response = await fetchFn(input, init);

		// Only transform streaming responses with a body
		if (!response.body) return response;

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		const encoder = new TextEncoder();

		const sanitizedBody = new ReadableStream<Uint8Array>({
			async pull(controller) {
				const { done, value } = await reader.read();
				if (done) {
					// Flush any remaining buffered bytes from the TextDecoder
					const remaining = decoder.decode(undefined, { stream: false });
					if (remaining.length > 0) {
						controller.enqueue(encoder.encode(remaining.replace(BAD_CHARS, escapeChar)));
					}
					controller.close();
					return;
				}
				const text = decoder.decode(value, { stream: true });
				if (BAD_CHARS.test(text)) {
					// Reset lastIndex since we used .test() with a global regex
					BAD_CHARS.lastIndex = 0;
					controller.enqueue(encoder.encode(text.replace(BAD_CHARS, escapeChar)));
				} else {
					BAD_CHARS.lastIndex = 0;
					controller.enqueue(value);
				}
			},
			cancel() {
				reader.cancel();
			},
		});

		return new Response(sanitizedBody, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};
}
