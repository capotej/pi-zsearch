/**
 * Web Search Extension (powered by Z.AI)
 *
 * Adds a `web_search` tool that calls the Z.AI Web Search API
 * (https://docs.z.ai/guides/tools/web-search). Requires ZAI_API_KEY
 * in the environment.
 */
import { Type } from "typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, } from "@mariozechner/pi-coding-agent";
const ZAI_BASE_URL = "https://api.z.ai/api/paas/v4/web_search";
function getApiKey() {
    const key = process.env.ZAI_API_KEY;
    if (!key) {
        throw new Error("ZAI_API_KEY environment variable is not set. Get your key at https://z.ai/manage-apikey/apikey-list");
    }
    return key;
}
function formatResults(results) {
    if (results.length === 0) {
        return "No results found.";
    }
    const lines = [];
    for (const r of results) {
        lines.push(`## ${r.title}`);
        if (r.media)
            lines.push(`Source: ${r.media}`);
        if (r.publish_date)
            lines.push(`Published: ${r.publish_date}`);
        lines.push(`URL: ${r.link}`);
        lines.push(r.content);
        lines.push("");
    }
    const text = lines.join("\n");
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
export default function (pi) {
    pi.registerTool({
        name: "web_search",
        label: "Web Search",
        description: "Search the web using the Z.AI Web Search API. Returns structured results with titles, summaries, URLs, source names, and publication dates. Useful for finding current information, looking up documentation, researching topics, or getting up-to-date answers.",
        promptSnippet: "Search the web for current information",
        promptGuidelines: [
            "Use web_search when you need current or real-time information that may not be in your training data.",
            "Use web_search when the user asks about recent events, news, or any time-sensitive topic.",
        ],
        parameters: Type.Object({
            query: Type.String({
                description: "The search query string",
            }),
            count: Type.Optional(Type.Number({
                description: "Number of results to return (1-50, default 10)",
                minimum: 1,
                maximum: 50,
            })),
            domain: Type.Optional(Type.String({
                description: "Limit results to a specific domain (e.g. 'github.com')",
            })),
            recency: Type.Optional(StringEnum([
                "oneDay",
                "oneWeek",
                "oneMonth",
                "oneYear",
                "noLimit",
            ], {
                description: "Time range filter: oneDay, oneWeek, oneMonth, oneYear, noLimit (default)",
            })),
        }),
        async execute(_toolCallId, params, signal) {
            const apiKey = getApiKey();
            const body = {
                search_engine: "search-prime",
                search_query: params.query,
            };
            if (params.count)
                body.count = params.count;
            if (params.domain)
                body.search_domain_filter = params.domain;
            if (params.recency)
                body.search_recency_filter = params.recency;
            const response = await fetch(ZAI_BASE_URL, {
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
            const data = (await response.json());
            const formatted = formatResults(data.search_result ?? []);
            return {
                content: [{ type: "text", text: formatted }],
                details: {
                    resultCount: data.search_result?.length ?? 0,
                    requestId: data.id,
                },
            };
        },
    });
}
