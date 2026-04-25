import { z } from "zod";
import { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { createOctokit } from "../auth/github.js";
import { GithubService } from "../services/github.js";
import { JiraService } from "../services/jira.js";
import { wrapTool } from "./common.js";

const paramsSchema = {
  github_usernames: z.array(z.string().min(1)).min(1).describe("GitHub usernames (logins) to map."),
  jira_project_key: z.string().min(1).optional().describe("Optional Jira project key to bias searches (best-effort)."),
  known_mappings: z
    .array(
      z.object({
        github_username: z.string().min(1),
        jira_account_id: z.string().min(1).optional(),
        jira_query: z
          .string()
          .min(1)
          .optional()
          .describe("Email or name hint usable with Jira user search."),
      }),
    )
    .optional()
    .describe("Optional operator-provided hints to improve mapping accuracy."),
  max_candidates_per_user: z.number().int().min(1).max(10).default(5),
} as const;

const inputSchema = z.object(paramsSchema);
type Input = z.infer<typeof inputSchema>;

export function nexusCrossReferenceTool(params: { config: Config; logger: Logger }) {
  return wrapTool({
    name: "nexus_cross_reference",
    description:
      "Map GitHub contributors to Jira assignees (identity resolution) to identify likely owners and notification targets.",
    paramsSchema,
    logger: params.logger,
    fn: async (args: Input, ctx) => {
      const octokit = await createOctokit(params.config);
      const gh = new GithubService(octokit);

      const jiraAvailable = Boolean(params.config.jiraBaseUrl && params.config.jiraAuthToken && params.config.jiraEmail);
      const jira = jiraAvailable ? new JiraService(params.config) : null;

      const hints = new Map<string, { jira_account_id?: string; jira_query?: string }>();
      for (const h of args.known_mappings ?? []) {
        hints.set(h.github_username.toLowerCase(), { jira_account_id: h.jira_account_id, jira_query: h.jira_query });
      }

      const results = [];
      for (const username of args.github_usernames) {
        const ghUser = await gh.getUser({ trace_id: ctx.trace_id, username });
        const hint = hints.get(username.toLowerCase());

        const candidates = jira
          ? await findJiraCandidates({
              jira,
              trace_id: ctx.trace_id,
              ghUser,
              hintQuery: hint?.jira_query,
              max: args.max_candidates_per_user,
            })
          : [];

        const scored = candidates
          .map((c) => ({
            candidate: c,
            score: scoreCandidate({ ghUser, jiraUser: c, hintAccountId: hint?.jira_account_id }),
          }))
          .sort((a, b) => b.score - a.score);

        const best = scored[0];
        results.push({
          github: simplifyGitHubUser(ghUser),
          jira_best_match: best ? simplifyJiraUser(best.candidate) : null,
          confidence: best ? clamp01(best.score / 10) : 0,
          alternatives: scored.slice(1, args.max_candidates_per_user).map((s) => ({
            jira: simplifyJiraUser(s.candidate),
            confidence: clamp01(s.score / 10),
          })),
          notes: jira
            ? undefined
            : "Jira not configured (set JIRA_BASE_URL/JIRA_EMAIL/JIRA_AUTH_TOKEN) so only GitHub identities are returned.",
        });
      }

      return {
        mapping: results,
        strategy: {
          jira_user_search: jira ? "enabled" : "disabled",
          scoring: [
            "Exact Jira accountId hint match",
            "Case-insensitive match on displayName vs GitHub name/login",
            "Heuristic match on local-part tokens (e.g., 'jdoe')",
          ],
        },
      };
    },
  });
}

async function findJiraCandidates(params: {
  jira: JiraService;
  trace_id: string;
  ghUser: Record<string, unknown>;
  hintQuery?: string;
  max: number;
}) {
  const login = String(params.ghUser["login"] ?? "");
  const name = typeof params.ghUser["name"] === "string" ? (params.ghUser["name"] as string) : "";
  const tokens = new Set<string>();
  for (const t of [params.hintQuery, login, name]) {
    if (!t) continue;
    const trimmed = t.trim();
    if (trimmed) tokens.add(trimmed);
  }

  // Try a few variants that work with Jira user search even when email is masked.
  const queries = [...tokens].flatMap((t) => {
    const parts = t.split(/\s+/).filter(Boolean);
    const variants = new Set<string>([t]);
    for (const p of parts) variants.add(p);
    variants.add(t.replace(/[^a-z0-9]/gi, ""));
    return [...variants].filter((v) => v.length >= 2);
  });

  const seen = new Map<string, any>();
  for (const q of queries.slice(0, 6)) {
    const users = await params.jira.userSearch({ trace_id: params.trace_id, query: q, maxResults: params.max * 2 });
    for (const u of users) {
      const id = (u as any)?.accountId ?? (u as any)?.key ?? JSON.stringify(u);
      if (!seen.has(id)) seen.set(id, u);
    }
    if (seen.size >= params.max) break;
  }
  return [...seen.values()].slice(0, params.max);
}

function scoreCandidate(params: {
  ghUser: Record<string, unknown>;
  jiraUser: any;
  hintAccountId?: string;
}): number {
  const login = String(params.ghUser["login"] ?? "").toLowerCase();
  const name = typeof params.ghUser["name"] === "string" ? (params.ghUser["name"] as string).toLowerCase() : "";

  const accountId = String(params.jiraUser?.accountId ?? "");
  const displayName = String(params.jiraUser?.displayName ?? "").toLowerCase();

  let score = 0;
  if (params.hintAccountId && accountId && params.hintAccountId === accountId) score += 10;

  if (displayName && name && displayName === name) score += 6;
  if (displayName && name && displayName.includes(name)) score += 4;
  if (displayName && login && displayName.includes(login)) score += 4;

  const displayTokens = new Set(displayName.split(/[^a-z0-9]+/).filter(Boolean));
  if (login && displayTokens.has(login)) score += 3;

  const nameTokens = new Set(name.split(/[^a-z0-9]+/).filter(Boolean));
  for (const t of nameTokens) if (t && displayTokens.has(t)) score += 1;

  return score;
}

function simplifyGitHubUser(u: Record<string, unknown>) {
  return {
    login: u["login"] ?? null,
    name: u["name"] ?? null,
    html_url: u["html_url"] ?? null,
    company: u["company"] ?? null,
  };
}

function simplifyJiraUser(u: any) {
  return {
    accountId: u?.accountId ?? null,
    displayName: u?.displayName ?? null,
    active: u?.active ?? null,
  };
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
