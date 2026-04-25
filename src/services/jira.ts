import { Config } from "../config.js";
import { fetchJson } from "./http.js";

type JiraIssue = Record<string, unknown>;

export class JiraService {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: Config) {
    const jira = config.requireJira();
    this.baseUrl = jira.baseUrl.replace(/\/+$/, "");
    this.authHeader = `Basic ${Buffer.from(`${jira.email}:${jira.authToken}`, "utf8").toString("base64")}`;
  }

  async getIssue(params: {
    trace_id: string;
    issueKey: string;
    expand?: string[];
    fields?: string[];
  }): Promise<JiraIssue> {
    const qs = new URLSearchParams();
    if (params.expand?.length) qs.set("expand", params.expand.join(","));
    if (params.fields?.length) qs.set("fields", params.fields.join(","));
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(params.issueKey)}?${qs.toString()}`;

    return (await fetchJson(url, {
      operation: "jira.getIssue",
      trace_id: params.trace_id,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
    })) as JiraIssue;
  }

  async search(params: { trace_id: string; jql: string; maxResults?: number }): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/rest/api/3/search`;
    return (await fetchJson(url, {
      operation: "jira.search",
      trace_id: params.trace_id,
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql: params.jql,
        maxResults: params.maxResults ?? 50,
      }),
    })) as Record<string, unknown>;
  }

  async getIssueTransitions(params: { trace_id: string; issueKey: string }): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(params.issueKey)}/transitions?expand=transitions.fields`;
    return (await fetchJson(url, {
      operation: "jira.getTransitions",
      trace_id: params.trace_id,
      headers: { Authorization: this.authHeader, Accept: "application/json" },
    })) as Record<string, unknown>;
  }

  async userSearch(params: { trace_id: string; query: string; maxResults?: number }): Promise<unknown[]> {
    const url = `${this.baseUrl}/rest/api/3/user/search?query=${encodeURIComponent(params.query)}&maxResults=${encodeURIComponent(
      String(params.maxResults ?? 25),
    )}`;
    const result = await fetchJson(url, {
      operation: "jira.userSearch",
      trace_id: params.trace_id,
      headers: { Authorization: this.authHeader, Accept: "application/json" },
    });
    return Array.isArray(result) ? result : [];
  }
}
