# @capotej/pi-zsearch

A [pi](https://github.com/badlogic/pi-mono) extension that adds web search and web page reading capabilities via the [Z.AI API](https://z.ai).

## Tools

### `web_search`

Search the web using the [Z.AI Web Search API](https://docs.z.ai/guides/tools/web-search). Returns structured results with titles, summaries, URLs, source names, and publication dates.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | ✅ | — | The search query |
| `count` | number | ❌ | `10` | Number of results (1–50) |
| `domain` | string | ❌ | — | Limit to a specific domain (e.g. `github.com`) |
| `recency` | enum | ❌ | `noLimit` | Time filter: `oneDay`, `oneWeek`, `oneMonth`, `oneYear`, `noLimit` |

### `web_read`

Read and parse a web page using the [Z.AI Web Reader API](https://docs.z.ai/api-reference/tools/web-reader). Returns page content as markdown or plain text.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | — | The URL to read |
| `return_format` | enum | ❌ | `markdown` | Output format: `markdown` or `text` |
| `no_cache` | boolean | ❌ | `false` | Disable caching |
| `retain_images` | boolean | ❌ | `true` | Keep images in output |
| `with_images_summary` | boolean | ❌ | `false` | Include image summary |
| `with_links_summary` | boolean | ❌ | `false` | Include links summary |
| `timeout` | number | ❌ | `20` | Request timeout in seconds |

## Installation

```bash
pi install npm:@capotej/pi-zsearch
```

## Setup

Set the `ZAI_API_KEY` environment variable. Get your API key at [z.ai/manage-apikey](https://z.ai/manage-apikey/apikey-list).

```bash
export ZAI_API_KEY="your-api-key"
```

## Development

```bash
npm install
npm run build
```

## License

[MIT](./LICENSE)
