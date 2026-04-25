import { z } from "zod";
import { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { JiraService } from "../services/jira.js";
import { wrapTool } from "./common.js";

const paramsSchema = {
  issue_key: z.string().min(1).describe("Jira issue key, e.g. ENG-123"),
  include_children: z.boolean().default(true),
  include_status_history: z.boolean().default(true),
} as const;

const inputSchema = z.object(paramsSchema);
type Input = z.infer<typeof inputSchema>;

export function nexusJiraContextTool(params: { config: Config; logger: Logger }) {
  return wrapTool({
    name: "nexus_jira_context",
    description:
      "Deep-fetch Jira ticket metadata (links, parent/children, and status history). Returns a structured context blob for downstream tools.",
    paramsSchema,
    logger: params.logger,
    fn: async (args: Input, ctx) => {
      const jira = new JiraService(params.config);
      const issue = await jira.getIssue({
        trace_id: ctx.trace_id,
        issueKey: args.issue_key,
        expand: ["changelog"],
      });

      const fields = (issue["fields"] ?? {}) as Record<string, unknown>;
      const key = String(issue["key"] ?? args.issue_key);

      const parentKey = (fields["parent"] as any)?.key as string | undefined;
      const links = (fields["issuelinks"] as any[]) ?? [];

      const children = args.include_children
        ? await jira.search({
            trace_id: ctx.trace_id,
            jql: `parent=${key} order by created desc`,
            maxResults: 50,
          })
        : null;

      const statusHistory = args.include_status_history
        ? extractStatusHistory(issue)
        : [];

      return {
        issue: {
          key,
          summary: (fields["summary"] as string | undefined) ?? null,
          status: (fields["status"] as any)?.name ?? null,
          type: (fields["issuetype"] as any)?.name ?? null,
          priority: (fields["priority"] as any)?.name ?? null,
          assignee: (fields["assignee"] as any)?.displayName ?? null,
          reporter: (fields["reporter"] as any)?.displayName ?? null,
          parent_key: parentKey ?? null,
        },
        links: links.map((l) => simplifyIssueLink(l)).filter(Boolean),
        children,
        status_history: statusHistory,
      };
    },
  });
}

function simplifyIssueLink(l: any) {
  const type = l?.type?.name ?? l?.type?.inward ?? l?.type?.outward ?? null;
  const inward = l?.inwardIssue?.key ? { key: l.inwardIssue.key, summary: l.inwardIssue.fields?.summary } : null;
  const outward = l?.outwardIssue?.key ? { key: l.outwardIssue.key, summary: l.outwardIssue.fields?.summary } : null;
  if (!type && !inward && !outward) return null;
  return { type, inward, outward };
}

function extractStatusHistory(issue: Record<string, unknown>) {
  const changelog = issue["changelog"] as any;
  const histories = (changelog?.histories as any[]) ?? [];
  const events: Array<{ at: string; from: string | null; to: string | null; author: string | null }> = [];

  for (const h of histories) {
    const created = h?.created as string | undefined;
    const author = h?.author?.displayName as string | undefined;
    for (const item of (h?.items as any[]) ?? []) {
      if (item?.field !== "status") continue;
      events.push({
        at: created ?? "",
        from: item?.fromString ?? null,
        to: item?.toString ?? null,
        author: author ?? null,
      });
    }
  }

  return events.filter((e) => e.at);
}
