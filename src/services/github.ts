import { Octokit } from "@octokit/rest";
import { withRetry, abortRetry } from "../lib/retry.js";

export class GithubService {
  constructor(private readonly octokit: Octokit) {}

  async searchCode(params: {
    trace_id: string;
    query: string;
    perPage?: number;
  }): Promise<Record<string, unknown>> {
    // GitHub search syntax is part of the query (e.g. "error repo:org/repo").
    return withRetry(
      async () => {
        const resp = await this.octokit.search.code({
          q: params.query,
          per_page: params.perPage ?? 10,
        });
        return resp.data as unknown as Record<string, unknown>;
      },
      { operation: "github.search.code" },
    );
  }

  async compareCommits(params: {
    trace_id: string;
    owner: string;
    repo: string;
    base: string;
    head: string;
  }): Promise<Record<string, unknown>> {
    return withRetry(
      async () => {
        const resp = await this.octokit.repos.compareCommits({
          owner: params.owner,
          repo: params.repo,
          base: params.base,
          head: params.head,
        });
        return resp.data as unknown as Record<string, unknown>;
      },
      { operation: "github.repos.compareCommits" },
    );
  }

  async getCommit(params: {
    trace_id: string;
    owner: string;
    repo: string;
    ref: string;
  }): Promise<Record<string, unknown>> {
    return withRetry(
      async () => {
        const resp = await this.octokit.repos.getCommit({
          owner: params.owner,
          repo: params.repo,
          ref: params.ref,
        });
        return resp.data as unknown as Record<string, unknown>;
      },
      { operation: "github.repos.getCommit" },
    );
  }

  async getUser(params: { trace_id: string; username: string }): Promise<Record<string, unknown>> {
    return withRetry(
      async () => {
        const resp = await this.octokit.users.getByUsername({ username: params.username });
        return resp.data as unknown as Record<string, unknown>;
      },
      { operation: "github.users.getByUsername" },
    );
  }

  static parseOwnerRepo(full: string): { owner: string; repo: string } {
    const m = full.trim().match(/^([^/]+)\/([^/]+)$/);
    if (!m) throw abortRetry(`Invalid repo: "${full}". Expected "owner/repo".`);
    return { owner: m[1]!, repo: m[2]! };
  }
}

