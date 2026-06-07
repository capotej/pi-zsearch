# @capotej/pi-zsearch

A [pi](https://github.com/badlogic/pi-mono) extension that adds a `web_search` tool powered by the [Z.AI Web Search API](https://docs.z.ai/guides/tools/web-search).

## Installation

```
pi install npm:@capotej/pi-zsearch
```

## Setup

Set the `ZAI_API_KEY` environment variable. Get your API key at [z.ai/manage-apikey](https://z.ai/manage-apikey/apikey-list).

```bash
export ZAI_API_KEY="your-api-key"
```

## Usage

Once installed, the `web_search` tool is automatically available to the LLM. It will search the web when it needs current information.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | The search query |
| `count` | number | no | Number of results (1-50, default 10) |
| `domain` | string | no | Limit to a specific domain (e.g. `github.com`) |
| `recency` | string | no | Time filter: `oneDay`, `oneWeek`, `oneMonth`, `oneYear`, `noLimit` (default) |

## Development

```bash
npm install
npm run build
```

## License

MIT
