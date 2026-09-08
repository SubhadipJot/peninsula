# mcp-store

Stop configuring the same MCP servers in Cursor, Claude Code, opencode, … one by one.

**mcp-store** is a central store of MCP server configs plus a single **gateway** MCP server.
Each coding agent connects to the gateway once; the gateway spawns/links every stored MCP
server and exposes their tools, resources and prompts through that one connection.

```
 Cursor / Claude Code / …  ──one MCP connection──▶  mcp-store gateway
                                                        │ spawn / connect
                                              ┌─────────┼──────────┐
                                              ▼         ▼          ▼
                                           github    sentry    linear (http)
                                              ▲
                                       store/*.json + .env
```

## Quick start

```bash
npm install
npm run build

# serve everything in ./store
node dist/cli/main.js

# or a named profile from store/profiles.json
node dist/cli/main.js --profile fullstack
```

Try it interactively:

```bash
npx @modelcontextprotocol/inspector node dist/cli/main.js
```

## Store format

One JSON file per server in `store/`:

```jsonc
// store/github.json
{
  "name": "github",                 // lowercase, hyphens only (no "__")
  "description": "GitHub repos, issues, PRs",
  "transport": "stdio",             // stdio | http | sse
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_TOKEN}" },
  "tags": ["vcs"],
  "enabled": true,
  "timeoutMs": 60000                // optional, per-server request timeout
}
```

Remote servers:

```jsonc
// store/linear.json
{
  "name": "linear",
  "transport": "http",
  "url": "https://mcp.linear.app/mcp",
  "headers": { "Authorization": "Bearer {env:LINEAR_API_KEY}" },
  "enabled": false
}
```

`{env:VAR}` placeholders are interpolated from the environment (`.env` in the repo root and
`store/.env` are auto-loaded without overriding real env vars). Servers with missing vars are
skipped with a warning — everything else keeps working. Secrets never live in store files.

Profiles group servers in `store/profiles.json`:

```json
{ "default": ["everything"], "fullstack": ["everything", "github", "linear"] }
```

## CLI

```
mcp-store [options]
  --store <dir>       store directory (default: ./store)
  --profile <name>    only serve servers from this profile (repeatable)
  --only <a,b>        only these servers
  --except <a,b>      all enabled servers except these
  --timeout <ms>      default upstream request timeout (default: 30000)
  --log <level>       debug | info | warn | error
```

## Wire up your agents

Add **one** entry per agent — every stored server becomes available automatically.

**Cursor** (`~/.cursor/mcp.json`) and **Claude Code** (`claude mcp add mcp-store -- node …`):

```json
{
  "mcpServers": {
    "mcp-store": {
      "command": "node",
      "args": ["C:/Users/YOU/Desktop/mcp-store/dist/cli/main.js", "--store", "C:/Users/YOU/Desktop/mcp-store/store"]
    }
  }
}
```

opencode (`opencode.json`):

```json
{ "mcp": { "mcp-store": { "type": "local", "command": ["node", "path/to/mcp-store/dist/cli/main.js"] } } }
```

Switch profiles per agent with `--profile`: e.g. Cursor uses `--profile fullstack`,
a lightweight editor profile uses `--profile default`.

## How tools are namespaced

- Tools and prompts: `<server>__<tool>` — e.g. `github__create_issue`, plus meta tools:
  - `store__list_servers` — what's in the store, connection status, tool counts
  - `store__server_status` — detail for one server (secrets redacted)
  - `store__reload` — pick up store edits without restarting the agent
- Resources: URI scheme is prefixed — `github+file:///x`.
- Upstream `list_changed` notifications propagate to the agent.

## Development

```bash
npm test              # unit + e2e (builds first; e2e spawns a fake upstream through the real gateway)
npm run test:watch
npm run typecheck
npm run smoke         # manual smoke against ./store
```

### Project layout

```
src/
├── index.ts            # public API (re-exports the modules below)
├── cli/                # executable entry point
│   ├── main.ts         #   node dist/cli/main.js  (the `mcp-store` bin)
│   └── args.ts         #   flag parsing + help text
├── core/               # shared, transport-agnostic building blocks
│   ├── config.ts       #   zod schemas for store/*.json + profiles.json
│   ├── registry.ts     #   load, validate, {env:VAR} interpolate, filter
│   ├── errors.ts       #   StoreError hierarchy (config/connection/usage)
│   ├── logger.ts       #   leveled stderr logging (stdout is MCP traffic)
│   └── version.ts      #   single source of name/version
├── upstream/           # one MCP client connection per stored server
│   ├── connection.ts   #   stdio/http/sse transports, lazy + reconnect
│   └── index.ts
└── gateway/            # the single MCP server agents connect to
    ├── gateway.ts      #   request handlers, tool/resource/prompt caching
    ├── namespacing.ts  #   `server__tool` + `server+uri` encode/decode
    ├── meta-tools.ts   #   store__list_servers / server_status / reload
    └── index.ts

test/
├── unit/               # registry, namespacing, redaction, cli args
├── e2e/                # full gateway spawn over stdio
└── fixtures/           # fake-upstream MCP server used by e2e
```

## Roadmap

- HTTP/SSE **serving** mode (`--http <port>`) so multiple machines/agents share one store
- `mcp-store sync` — generate native Cursor/Claude Code/opencode configs from the store
- OAuth for remote servers; per-tool allow/deny filters; `mcp-store add/remove` CLI
