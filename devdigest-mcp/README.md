# devdigest-mcp

MCP server (stdio) exposing one read-only tool, `get_blast_radius`, backed by the DevDigest API
(`GET /pulls/:id/blast`, the same data the PR Overview tab shows).

Standalone package (own `package.json` + lockfile, like the other packages in this repo).

## Setup

```bash
cd devdigest-mcp
pnpm install
pnpm test        # unit tests (mocked fetch)
pnpm build       # tsc -> dist/
```

## Run

The DevDigest API must be running (`./scripts/dev.sh`, port 3001).

```bash
pnpm start       # tsx src/index.ts, speaks MCP on stdio
```

| Env | Default | Meaning |
|---|---|---|
| `DEVDIGEST_API_BASE` | `http://localhost:3001` | API base URL |

No credentials: the API's local auth provider (`LocalNoAuthProvider`, see
`server/src/modules/_shared/context.ts`) ignores the request and resolves the default workspace
and user itself, so the MCP server sends no auth header. This only works against that local
provider. If a real auth provider is added, the header (token, workspace) must be added in
`src/api.ts`, the single place that calls the API.

## Tool

`get_blast_radius` takes either `{ pr_id: uuid }` or `{ repo: "owner/name", number: <GitHub PR number> }`
(the PR page URL contains the GitHub number, not the uuid) and returns the JSON body of
`GET /pulls/:id/blast` (`changed_symbols`, `downstream`, `summary`, `degraded`, `reason`). With
`repo` + `number` the server first looks the PR up through `GET /repos` and `GET /repos/:id/pulls`.
Errors (unknown repo or PR, 404, 403, network) come back as an `isError` tool result with a hint.

## Claude Code

Add to `.mcp.json` (adjust the path):

```json
{
  "mcpServers": {
    "devdigest": {
      "command": "pnpm",
      "args": ["--dir", "devdigest-mcp", "start"],
      "env": { "DEVDIGEST_API_BASE": "http://localhost:3001" }
    }
  }
}
```

or: `claude mcp add devdigest -- pnpm --dir devdigest-mcp start`
