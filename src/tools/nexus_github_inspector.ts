import { z } from "zod";
import { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { createOctokit } from "../auth/github.js";
import { GithubService } from "../services/github.js";
import { wrapTool } from "./common.js";

const paramsSchema = {
  mode: z.enum(["code_search", "semantic_diff"]).default("code_search"),
  query: z
    .string()
    .min(1)
    .optional()
    .describe('GitHub code search query (supports qualifiers like "repo:org/repo"). Required for code_search.'),
  repo: z.string().min(3).optional().describe('Repo in "owner/repo" form. Required for semantic_diff.'),
  base: z.string().min(4).optional().describe("Base commit SHA/branch/tag for semantic_diff."),
  head: z.string().min(4).optional().describe("Head commit SHA/branch/tag for semantic_diff."),
  max_results: z.number().int().min(1).max(20).default(10),
} as const;

const inputSchema = z.object(paramsSchema);
type Input = z.infer<typeof inputSchema>;

export function nexusGithubInspectorTool(params: { config: Config; logger: Logger }) {
  return wrapTool({
    name: "nexus_github_inspector",
    description:
      "Search code across repositories and fetch semantic diffs between commits. Useful for tracing regressions and finding changes that correlate with incidents.",
    paramsSchema,
    logger: params.logger,
    fn: async (args: Input, ctx) => {
      const octokit = await createOctokit(params.config);
      const gh = new GithubService(octokit);

      if (args.mode === "code_search") {
        if (!args.query) throw new Error('Missing "query" for code_search mode.');
        const data = await gh.searchCode({ trace_id: ctx.trace_id, query: args.query, perPage: args.max_results });
        return {
          mode: "code_search",
          total_count: (data["total_count"] as number | undefined) ?? null,
          items: Array.isArray((data as any).items)
            ? (data as any).items.slice(0, args.max_results).map((it: any) => ({
                name: it?.name ?? null,
                path: it?.path ?? null,
                repo: it?.repository?.full_name ?? null,
                sha: it?.sha ?? null,
                html_url: it?.html_url ?? null,
              }))
            : [],
        };
      }

      if (!args.repo || !args.base || !args.head) {
        throw new Error('semantic_diff requires "repo", "base", and "head".');
      }

      const { owner, repo } = GithubService.parseOwnerRepo(args.repo);
      const compare = await gh.compareCommits({
        trace_id: ctx.trace_id,
        owner,
        repo,
        base: args.base,
        head: args.head,
      });

      const files = Array.isArray((compare as any).files) ? ((compare as any).files as any[]) : [];
      const semanticFiles = files.slice(0, 50).map((f) => ({
        filename: f?.filename ?? null,
        status: f?.status ?? null,
        additions: f?.additions ?? null,
        deletions: f?.deletions ?? null,
        changes: f?.changes ?? null,
        patch_summary: summarizePatch(f?.patch ?? ""),
      }));

      return {
        mode: "semantic_diff",
        repo: `${owner}/${repo}`,
        base_commit: (compare as any).base_commit?.sha ?? args.base,
        head_commit: (compare as any).merge_base_commit?.sha ?? args.head,
        ahead_by: (compare as any).ahead_by ?? null,
        behind_by: (compare as any).behind_by ?? null,
        total_commits: Array.isArray((compare as any).commits) ? (compare as any).commits.length : null,
        files: semanticFiles,
      };
    },
  });
}

function summarizePatch(patch: string): { touched_symbols: string[]; risk_signals: string[] } {
  if (!patch) return { touched_symbols: [], risk_signals: [] };
  const touched = new Set<string>();
  const risks = new Set<string>();

  for (const line of patch.split("\n")) {
    const hunk = line.match(/^@@ .* @@\s*(.*)$/);
    if (hunk?.[1]) touched.add(hunk[1].trim().slice(0, 120));

    if (line.startsWith("+") || line.startsWith("-")) {
      const l = line.toLowerCase();
      if (l.includes("timeout") || l.includes("retry") || l.includes("backoff")) risks.add("timing_or_retry_changed");
      if (l.includes("http") && (l.includes("500") || l.includes("status"))) risks.add("http_behavior_changed");
      if (l.includes("feature flag") || l.includes("toggle")) risks.add("feature_flag_changed");
      if (l.includes("cache") || l.includes("ttl")) risks.add("cache_changed");
      if (l.includes("auth") || l.includes("token") || l.includes("permission")) risks.add("auth_changed");
    }
  }

  return { touched_symbols: [...touched].slice(0, 12), risk_signals: [...risks] };
}
