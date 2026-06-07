/**
 * Web Search & Reader Extension (powered by Z.AI)
 *
 * Adds `web_search` and `web_read` tools that talk to the Z.AI MCP endpoints
 * (Streamable HTTP transport). Requires ZAI_API_KEY in the environment.
 *
 * - web_search -> /api/mcp/web_search_prime/mcp (tool: web_search_prime)
 * - web_read   -> /api/mcp/web_reader/mcp      (tool: webReader)
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@mariozechner/pi-coding-agent";
import { type Static, Type } from "typebox";

const ZAI_SEARCH_MCP_URL = "https://api.z.ai/api/mcp/web_search_prime/mcp";
const ZAI_READER_MCP_URL = "https://api.z.ai/api/mcp/web_reader/mcp";
const MCP_PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

// ── Types ────────────────────────────────────────────────────────────────

interface McpSearchItem {
	title?: string;
	link?: string;
	content?: string;
	refer?: string;
	media?: string;
	icon?: string;
	publish_date?: string;
}

interface McpReaderResult {
	title?: string;
	url?: string;
	content?: string;
	metadata?: Record<string, unknown>;
}

interface McpContentBlock {
	type: string;
	text?: string;
}

interface McpToolResult {
	content?: McpContentBlock[];
	isError?: boolean;
}

interface McpErrorPayload {
	code?: number;
	msg?: string;
	message?: string;
	success?: boolean;
}

// ── Parameter Schemas ───────────────────────────────────────────────────

const WebSearchParams = Type.Object({
	query: Type.String({
		description: "The search query string",
	}),
	domain: Type.Optional(
		Type.String({
			description: "Limit results to a specific domain (e.g. 'github.com')",
		}),
	),
	recency: Type.Optional(
		StringEnum(["oneDay", "oneWeek", "oneMonth", "oneYear", "noLimit"] as const, {
			description: "Time range filter: oneDay, oneWeek, oneMonth, oneYear, noLimit (default)",
		}),
	),
	content_size: Type.Optional(
		StringEnum(["medium", "high"] as const, {
			description:
				"Controls summary length. 'medium' (default): balanced, ~400-600 words. 'high': maximize context, ~2500 words, higher cost.",
		}),
	),
	location: Type.Optional(
		StringEnum(["cn", "us"] as const, {
			description:
				"Region to bias results. 'cn' (default): Chinese region. 'us': non-Chinese region.",
		}),
	),
});

const WebReadParams = Type.Object({
	url: Type.String({
		description: "The URL to read and parse",
	}),
	return_format: Type.Optional(
		StringEnum(["markdown", "text"] as const, {
			description: "Return format for the page content. Default is markdown.",
		}),
	),
	no_cache: Type.Optional(
		Type.Boolean({
			description: "Whether to disable caching. Default is false.",
		}),
	),
	retain_images: Type.Optional(
		Type.Boolean({
			description: "Whether to retain images in the output. Default is true.",
		}),
	),
	no_gfm: Type.Optional(
		Type.Boolean({
			description: "Whether to disable GitHub Flavored Markdown. Default is false.",
		}),
	),
	keep_img_data_url: Type.Optional(
		Type.Boolean({
			description: "Whether to keep image data URLs. Default is false.",
		}),
	),
	with_images_summary: Type.Optional(
		Type.Boolean({
			description: "Whether to include a summary of images found on the page. Default is false.",
		}),
	),
	with_links_summary: Type.Optional(
		Type.Boolean({
			description: "Whether to include a summary of links found on the page. Default is false.",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: "Request timeout in seconds. Default is 20.",
		}),
	),
});

type WebSearchParamsType = Static<typeof WebSearchParams>;
type WebReadParamsType = Static<typeof WebReadParams>;

// ── Helpers ──────────────────────────────────────────────────────────────

function getApiKey(): string {
	const key = process.env.ZAI_API_KEY;
	if (!key) {
		throw new Error(
			"ZAI_API_KEY environment variable is not set. Get your key at https://z.ai/manage-apikey/apikey-list",
		);
	}
	return key;
}

const URL_PATTERN = /^https?:\/\//i;
const SSE_LINE_SPLIT = /\r?\n/;
const SSE_DATA_PREFIX = /^data:\s?/;

function validateUrl(url: string): void {
	if (!URL_PATTERN.test(url)) {
		throw new Error(`Invalid URL: must start with http:// or https://, got "${url}"`);
	}
}

/** Parse an MCP response body, which may be SSE-framed (`data:` lines) or plain JSON. */
function parseMcpBody(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}

	const dataLines = trimmed
		.split(SSE_LINE_SPLIT)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.replace(SSE_DATA_PREFIX, ""));

	const jsonText = dataLines.length > 0 ? dataLines.join("\n") : trimmed;
	if (!jsonText) {
		return null;
	}

	try {
		return JSON.parse(jsonText);
	} catch {
		throw new Error(`Z.AI MCP returned non-JSON response: ${raw.slice(0, 500)}`);
	}
}

function timeoutSignal(signal: AbortSignal | undefined): AbortSignal {
	return signal
		? AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS)])
		: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);
}

/** POST a single JSON-RPC message to the MCP endpoint, returning the parsed payload and session id. */
async function postMcp(
	url: string,
	body: Record<string, unknown>,
	sessionId: string | undefined,
	signal: AbortSignal | undefined,
): Promise<{ payload: unknown; sessionId: string | null }> {
	const apiKey = getApiKey();

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: "application/json, text/event-stream",
		Authorization: `Bearer ${apiKey}`,
	};
	if (sessionId) {
		headers["mcp-session-id"] = sessionId;
	}

	const response = await fetch(url, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
		signal: timeoutSignal(signal),
	});

	const text = await response.text().catch(() => "");
	if (!response.ok) {
		throw new Error(`Z.AI MCP HTTP error (${response.status}): ${text || response.statusText}`);
	}

	const payload = parseMcpBody(text);

	// Gateway-level errors come back as plain JSON like { success:false, code, msg }.
	const errPayload = payload as McpErrorPayload | null;
	if (errPayload && errPayload.success === false) {
		const detail = errPayload.msg ?? errPayload.message ?? errPayload.code ?? "request failed";
		throw new Error(`Z.AI MCP error: ${detail}`);
	}

	return { payload, sessionId: response.headers.get("mcp-session-id") };
}

/**
 * Run a full MCP round-trip against the given endpoint: initialize (capturing
 * the session id), send notifications/initialized, then call the named tool.
 * Each call performs its own handshake, so there is no shared session state.
 *
 * Returns the tool's text content block, JSON-unwrapped (the server encodes the
 * real payload as a JSON string inside the text field).
 */
async function callMcpTool(
	url: string,
	toolName: string,
	arguments_: Record<string, unknown>,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	// 1. initialize
	const { sessionId } = await postMcp(
		url,
		{
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "pi-zsearch", version: "1.1.0" },
			},
		},
		undefined,
		signal,
	);

	if (!sessionId) {
		throw new Error("Z.AI MCP server did not return an mcp-session-id");
	}

	// 2. notifications/initialized (notification: no id, no result expected)
	await postMcp(
		url,
		{
			jsonrpc: "2.0",
			method: "notifications/initialized",
		},
		sessionId,
		signal,
	);

	// 3. tools/call
	const { payload } = await postMcp(
		url,
		{
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: toolName, arguments: arguments_ },
		},
		sessionId,
		signal,
	);

	const envelope = payload as { result?: McpToolResult; error?: unknown } | null;
	if (!envelope) {
		throw new Error(`Z.AI MCP tool '${toolName}' returned an empty response`);
	}
	if (envelope.error !== undefined) {
		throw new Error(`Z.AI MCP tool '${toolName}' error: ${JSON.stringify(envelope.error)}`);
	}

	const result = envelope.result;
	if (!result) {
		throw new Error(`Z.AI MCP tool '${toolName}' returned no result`);
	}
	if (result.isError) {
		const errText = Array.isArray(result.content)
			? result.content.map((c) => c.text ?? "").join("\n")
			: JSON.stringify(result);
		throw new Error(`Z.AI MCP tool '${toolName}' reported an error: ${errText}`);
	}

	const textBlock = Array.isArray(result.content)
		? result.content.find((c) => c.type === "text" && typeof c.text === "string")
		: undefined;
	if (!textBlock?.text) {
		throw new Error(`Z.AI MCP tool '${toolName}' returned no text content`);
	}

	// The text field is JSON-encoded, and the server wraps it twice (the text is a
	// JSON string containing another JSON string). Unwrap layer by layer until we
	// reach a non-string value, then return it.
	let parsed: unknown = textBlock.text;
	for (let depth = 0; depth < 3 && typeof parsed === "string"; depth++) {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			break;
		}
	}
	return parsed;
}

function buildReaderArguments(params: WebReadParamsType): Record<string, unknown> {
	const arguments_: Record<string, unknown> = { url: params.url };

	if (params.return_format !== undefined) {
		arguments_.return_format = params.return_format;
	}
	if (params.no_cache !== undefined) {
		arguments_.no_cache = params.no_cache;
	}
	if (params.retain_images !== undefined) {
		arguments_.retain_images = params.retain_images;
	}
	if (params.no_gfm !== undefined) {
		arguments_.no_gfm = params.no_gfm;
	}
	if (params.keep_img_data_url !== undefined) {
		arguments_.keep_img_data_url = params.keep_img_data_url;
	}
	if (params.with_images_summary !== undefined) {
		arguments_.with_images_summary = params.with_images_summary;
	}
	if (params.with_links_summary !== undefined) {
		arguments_.with_links_summary = params.with_links_summary;
	}
	if (params.timeout !== undefined) {
		arguments_.timeout = params.timeout;
	}

	return arguments_;
}

function truncateOutput(text: string): string {
	const truncation = truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	let out = truncation.content;
	if (truncation.truncated) {
		out += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines]`;
	}
	return out;
}

function formatSearchResults(results: McpSearchItem[]): string {
	if (!Array.isArray(results) || results.length === 0) {
		return "No results found.";
	}

	const lines: string[] = [];
	for (const r of results) {
		if (r.title) {
			lines.push(`## ${r.title}`);
		}
		if (r.media) {
			lines.push(`Source: ${r.media}`);
		}
		if (r.publish_date) {
			lines.push(`Published: ${r.publish_date}`);
		}
		if (r.link) {
			lines.push(`URL: ${r.link}`);
		}
		if (r.content) {
			lines.push(r.content);
		}
		lines.push("");
	}

	return truncateOutput(lines.join("\n"));
}

// ── Extension ────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── web_search ──────────────────────────────────────────────────────

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using the Z.AI Web Search API. Returns structured results with titles, summaries, URLs, and source references. Useful for finding current information, looking up documentation, researching topics, or getting up-to-date answers.",
		promptSnippet: "Search the web for current information",
		promptGuidelines: [
			"Use web_search when you need current or real-time information that may not be in your training data.",
			"Use web_search when the user asks about recent events, news, or any time-sensitive topic.",
		],
		parameters: WebSearchParams,

		async execute(
			_toolCallId: string,
			params: WebSearchParamsType,
			signal: AbortSignal | undefined,
		) {
			const arguments_: Record<string, unknown> = {
				search_query: params.query,
			};

			if (params.domain !== undefined) {
				arguments_.search_domain_filter = params.domain;
			}
			if (params.recency !== undefined) {
				arguments_.search_recency_filter = params.recency;
			}
			if (params.content_size !== undefined) {
				arguments_.content_size = params.content_size;
			}
			if (params.location !== undefined) {
				arguments_.location = params.location;
			}

			const data = (await callMcpTool(
				ZAI_SEARCH_MCP_URL,
				"web_search_prime",
				arguments_,
				signal,
			)) as McpSearchItem[];

			const results = Array.isArray(data) ? data : [];
			const formatted = formatSearchResults(results);

			return {
				content: [{ type: "text" as const, text: formatted }],
				details: {
					resultCount: results.length,
				},
			};
		},
	});

	// ── web_read ────────────────────────────────────────────────────────

	pi.registerTool({
		name: "web_read",
		label: "Web Reader",
		description:
			"Read and parse the content of a web page URL using the Z.AI Web Reader API. Returns the page content as markdown or plain text, with optional image retention and link/image summaries. Useful for reading articles, documentation, or any web page when you need the full content.",
		promptSnippet: "Read and parse a web page URL for its full content",
		promptGuidelines: [
			"Use web_read when you need to read the full content of a specific web page URL.",
			"Use web_read to get detailed content from a URL found via web_search.",
		],
		parameters: WebReadParams,

		async execute(_toolCallId: string, params: WebReadParamsType, signal: AbortSignal | undefined) {
			validateUrl(params.url);

			const arguments_ = buildReaderArguments(params);

			const result = (await callMcpTool(
				ZAI_READER_MCP_URL,
				"webReader",
				arguments_,
				signal,
			)) as McpReaderResult | null;

			if (!result?.content) {
				throw new Error(
					"No content returned from the Z.AI Reader API. The URL may be inaccessible or blocked.",
				);
			}

			const content = truncateOutput(result.content);

			return {
				content: [{ type: "text" as const, text: content }],
				details: {
					title: result.title ?? "",
					url: result.url ?? params.url,
				},
			};
		},
	});
}
