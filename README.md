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

## Running Modes

Nexus supports two operational patterns:

- **Local laptop (stdio):** Nexus runs as a subprocess owned by your MCP host/agent on your machine.
- **Cloud / CI:** Either run Nexus as a **shared hosted SSE service** (recommended for teams) or run it **ephemerally in the CI job** (stdio) alongside the agent.

### Local Laptop (stdio)

1) Create `.env` locally:

```bash
cp .env.example .env
```

2) Install/build:

```bash
npm install
npm run build
```

3) Run:

```bash
npm start -- --transport stdio
```

4) Register with an MCP host (example: Claude Desktop)

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

Notes:

- You can keep credentials in `.env` for `npm start`, but MCP hosts typically pass env vars directly in their config.
- Jira/GitHub/AWS tools will fail with actionable errors until their corresponding env vars are set.

### Cloud / CI Option A (Recommended): Shared Hosted SSE Service

Use this when multiple agents/users should share the same integration surface, audit/logging, and centralized credential management.

Run Nexus in a container/task and expose HTTP endpoints:

```bash
npm start -- --transport sse --host 0.0.0.0 --port 8787
```

Endpoints:

- `GET /sse` opens the Server-Sent Events stream
- `POST /message?sessionId=...` sends client → server messages (SDK-managed)
- `GET /healthz` health check

Required configuration (environment variables):

- Jira: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_AUTH_TOKEN`
- GitHub: `GITHUB_PAT` **or** `GITHUB_APP_ID` + `GITHUB_PRIVATE_KEY` + `GITHUB_INSTALLATION_ID`
- AWS: `AWS_REGION` (+ optional `AWS_ROLE_ARN`)
- Optional: `NEXUS_PUBLIC_BASE_URL` if you’re behind an ALB/API gateway and need Nexus to advertise the correct message endpoint.

Your agent/MCP host should be configured to connect to the Nexus SSE URL (host-specific).

### Cloud / CI Option B: Ephemeral CI Job (stdio)

Use this when you want Nexus available only during a CI run (e.g., a LangGraph/agent workflow that runs inside GitHub Actions).

High-level flow:

1) CI job sets credentials via secrets.
2) CI job builds Nexus.
3) CI job runs the agent which spawns Nexus via stdio (as a child process).

Example (GitHub Actions) skeleton:

```yaml
name: agent-workflow
on: [workflow_dispatch]
jobs:
  run-agent:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # for AWS OIDC (optional)
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
      - run: npm run build
      - name: Run agent with Nexus (stdio)
        env:
          JIRA_BASE_URL: ${{ secrets.JIRA_BASE_URL }}
          JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}
          JIRA_AUTH_TOKEN: ${{ secrets.JIRA_AUTH_TOKEN }}
          GITHUB_PAT: ${{ secrets.GITHUB_PAT }}
          AWS_REGION: us-east-1
          AWS_ROLE_ARN: ${{ secrets.AWS_ROLE_ARN }} # optional
        run: |
          # Your agent/runner command goes here. Configure it to spawn:
          # node dist/index.js --transport stdio
          echo "Run your agent here"
```

Notes:

- In CI, prefer AWS auth via **OIDC + AssumeRole** (set `AWS_ROLE_ARN` and ensure the runner has `id-token: write` + proper trust policy).
- If you need shared caching/rate-limits/observability across many runs, prefer the shared SSE service.

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
