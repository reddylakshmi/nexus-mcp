# Nexus Security

Nexus is intentionally **read-heavy** by default. It provides guardrails for any future write-capable tools via a strict “Write Firewall”.

## Credential Injection (Environment Only)

Nexus reads credentials exclusively from environment variables:

- Jira: `JIRA_BASE_URL`, `JIRA_AUTH_TOKEN`, `JIRA_EMAIL`
- GitHub: `GITHUB_PAT` **or** `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`
- AWS: `AWS_REGION`, optional `AWS_ROLE_ARN`

No credential files are read from disk by default.

## Write Firewall

If a tool is marked as mutating, Nexus will refuse to execute it unless the request includes:

```json
{ "approval": { "approved": true, "approver": "Jane Doe", "reason": "…" } }
```

Without approval, it returns a `requires_approval` object and performs no external calls.

## AWS IAM (CloudWatch triage)

Minimum permissions for CloudWatch Logs Insights triage (account-local):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:StartQuery",
        "logs:GetQueryResults",
        "logs:StopQuery"
      ],
      "Resource": "*"
    }
  ]
}
```

If `AWS_ROLE_ARN` is used, the runtime principal also needs:

- `sts:AssumeRole` on the target role

And the target role’s trust policy must allow that principal.

## GitHub Permissions

Recommended GitHub App permissions (read-only):

- Contents: **Read**
- Metadata: **Read**

Nexus uses:

- Code search
- Commit comparisons (semantic diff)
- User lookups (for identity mapping)

For PAT mode, grant least-privilege scopes appropriate to your org policies (prefer fine-grained tokens).

## Jira Permissions

Nexus uses Jira REST v3 endpoints to read:

- Issues (including changelog when available)
- User search (best-effort; email visibility depends on org policy)

Use a dedicated API token and account with read-only access to the required projects.

## Logging and Trace IDs

Every tool call emits a `trace_id` and logs structured JSON events:

- `tool.start`
- `tool.ok`
- `tool.error`

Forward logs to your aggregator (e.g., CloudWatch Logs, Datadog) and filter by `trace_id` to correlate multi-step investigations.

