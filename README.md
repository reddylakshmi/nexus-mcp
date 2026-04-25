# Nexus (MCP Server)

Nexus is a production-grade **Model Context Protocol (MCP)** server that exposes tools spanning:

- **Jira**: deep issue context (`nexus_jira_context`)
- **GitHub**: code search + semantic diffs (`nexus_github_inspector`)
- **AWS CloudWatch**: log triage + structured impact summaries (`nexus_aws_triage`)
- **Identity mapping**: GitHub ↔ Jira ownership resolution (`nexus_cross_reference`)

It is designed to be **stateless** and emits a `trace_id` for every tool call so you can correlate logs across services.

## Quickstart

### 1) Configure environment

Copy `.env.example` to `.env` and fill in credentials.

### 2) Install + build

```bash
npm install
npm run build
```

### 3) Run (stdio transport)

```bash
npm start -- --transport stdio
```

This is the recommended mode for local MCP hosts like Claude Desktop.

## Transports

### Stdio (local)

- `--transport stdio` (default)
- Uses the MCP SDK’s stdio transport for local debugging and desktop hosts.

### SSE (container / hosted)

```bash
npm start -- --transport sse --host 0.0.0.0 --port 8787
```

Endpoints:

- `GET /sse` opens the Server-Sent Events stream
- `POST /message?sessionId=...` sends client → server messages (SDK-managed)
- `GET /healthz` simple health check

Notes:

- SSE requires an active `GET /sse` session before `POST /message`.
- For deployments behind a public base URL, set `NEXUS_PUBLIC_BASE_URL` so the server emits the correct message endpoint in the SSE transport.

## Registering Nexus with an MCP Host

### Claude Desktop (example)

Add an MCP server entry (adjust paths to your machine):

```json
{
  "mcpServers": {
    "nexus": {
      "command": "node",
      "args": ["/ABS/PATH/TO/nexus-mcp/dist/index.js", "--transport", "stdio"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "you@company.com",
        "JIRA_AUTH_TOKEN": "…",
        "GITHUB_PAT": "…",
        "AWS_REGION": "us-east-1"
      }
    }
  }
}
```

For SSE-hosted Nexus, configure the host to connect via the MCP SSE URL (host-specific).

## Tool Catalog

All tools:

- Validate arguments with **Zod**
- Use exponential backoff retries for third-party calls
- Return structured JSON as text, including `trace_id`
- Return **actionable error strings** (no stack traces)

### `nexus_jira_context`

Deep-fetch issue metadata: parent/child links, issue links, and status history via changelog.

### `nexus_github_inspector`

- `code_search`: GitHub code search across repos
- `semantic_diff`: commit comparison with patch heuristics (“risk signals”)

### `nexus_aws_triage`

Runs a CloudWatch Logs Insights query and emits an `impact_summary` including error classification and samples.

### `nexus_cross_reference`

Resolves likely owners by mapping GitHub users to Jira users using best-effort search + scoring, optionally boosted with `known_mappings`.

## Security & Guardrails

### The “Write Firewall” (non-negotiable)

Nexus includes a middleware-style guard in `src/tools/common.ts`:

- Any tool marked `mutates: true` must receive `approval.approved=true`
- Otherwise it returns:
  - `requires_approval: { tool, summary }`
  - and does **not** call the upstream API

This ensures the client-side LLM must pause and obtain a human confirmation before any mutation occurs (e.g., “merge PR”, “create Jira ticket”, “update AWS resource”).

See `security.md` for IAM guidance.

