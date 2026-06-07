/**
 * Web Search & Reader Extension (powered by Z.AI)
 *
 * Adds `web_search` and `web_read` tools that call the Z.AI APIs.
 * Requires ZAI_API_KEY in the environment.
 *
 * - web_search: https://docs.z.ai/guides/tools/web-search
 * - web_read:   https://docs.z.ai/api-reference/tools/web-reader
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const ZAI_SEARCH_URL = "https://api.z.ai/api/paas/v4/web_search";
const ZAI_READER_URL = "https://api.z.ai/api/paas/v4/reader";

// ── Types ────────────────────────────────────────────────────────────────

interface ZaiSearchResult {
	title: string;
	content: string;
	link: string;
	media: string;
	icon: string;
	refer: string;
	publish_date: string;
}

interface ZaiSearchResponse {
	id: string;
	created: number;
	search_result: ZaiSearchResult[];
}

interface ZaiReaderResponse {
	id: string;
	created: number;
	reader_result: {
		content: string;
		description: string;
	};
}

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

async function zaiFetch(
	endpoint: string,
	body: Record<string, unknown>,
	signal: AbortSignal | undefined,
): Promise<unknown> {
	const apiKey = getApiKey();

	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
		signal,
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(`Z.AI API error (${response.status}): ${errorText || response.statusText}`);
	}

	return response.json();
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

function formatSearchResults(results: ZaiSearchResult[]): string {
	if (results.length === 0) {
		return "No results found.";
	}

	const lines: string[] = [];
	for (const r of results) {
		lines.push(`## ${r.title}`);
		if (r.media) {
			lines.push(`Source: ${r.media}`);
		}
		if (r.publish_date) {
			lines.push(`Published: ${r.publish_date}`);
		}
		lines.push(`URL: ${r.link}`);
		lines.push(r.content);
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
			"Search the web using the Z.AI Web Search API. Returns structured results with titles, summaries, URLs, source names, and publication dates. Useful for finding current information, looking up documentation, researching topics, or getting up-to-date answers.",
		promptSnippet: "Search the web for current information",
		promptGuidelines: [
			"Use web_search when you need current or real-time information that may not be in your training data.",
			"Use web_search when the user asks about recent events, news, or any time-sensitive topic.",
		],
		parameters: Type.Object({
			query: Type.String({
				description: "The search query string",
			}),
			count: Type.Optional(
				Type.Number({
					description: "Number of results to return (1-50, default 10)",
					minimum: 1,
					maximum: 50,
				}),
			),
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
		}),

		async execute(
			_toolCallId: string,
			params: {
				query: string;
				count?: number;
				domain?: string;
				recency?: string;
			},
			signal: AbortSignal | undefined,
		) {
			const body: Record<string, unknown> = {
				search_engine: "search-prime",
				search_query: params.query,
			};

			if (params.count) {
				body.count = params.count;
			}
			if (params.domain) {
				body.search_domain_filter = params.domain;
			}
			if (params.recency) {
				body.search_recency_filter = params.recency;
			}

			const data = (await zaiFetch(ZAI_SEARCH_URL, body, signal)) as ZaiSearchResponse;
			const formatted = formatSearchResults(data.search_result ?? []);

			return {
				content: [{ type: "text" as const, text: formatted }],
				details: {
					resultCount: data.search_result?.length ?? 0,
					requestId: data.id,
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
		parameters: Type.Object({
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
			with_images_summary: Type.Optional(
				Type.Boolean({
					description:
						"Whether to include a summary of images found on the page. Default is false.",
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
		}),

		async execute(
			_toolCallId: string,
			params: {
				url: string;
				return_format?: string;
				no_cache?: boolean;
				retain_images?: boolean;
				with_images_summary?: boolean;
				with_links_summary?: boolean;
				timeout?: number;
			},
			signal: AbortSignal | undefined,
		) {
			const body: Record<string, unknown> = { url: params.url };

			if (params.return_format) {
				body.return_format = params.return_format;
			}
			if (params.no_cache !== undefined) {
				body.no_cache = params.no_cache;
			}
			if (params.retain_images !== undefined) {
				body.retain_images = params.retain_images;
			}
			if (params.with_images_summary !== undefined) {
				body.with_images_summary = params.with_images_summary;
			}
			if (params.with_links_summary !== undefined) {
				body.with_links_summary = params.with_links_summary;
			}
			if (params.timeout) {
				body.timeout = params.timeout;
			}

			const data = (await zaiFetch(ZAI_READER_URL, body, signal)) as ZaiReaderResponse;

			const result = data.reader_result;
			if (!result?.content) {
				throw new Error(
					"No content returned from the Z.AI Reader API. The URL may be inaccessible or blocked.",
				);
			}

			const content = truncateOutput(result.content);

			return {
				content: [{ type: "text" as const, text: content }],
				details: {
					description: result.description ?? "",
					requestId: data.id,
				},
			};
		},
	});
}
