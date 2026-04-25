import { withRetry, abortRetry } from "../lib/retry.js";

export type HttpJson = Record<string, unknown> | unknown[] | string | number | boolean | null;

export async function fetchJson(
  url: string,
  init: RequestInit & { operation: string; trace_id: string },
): Promise<HttpJson> {
  return withRetry(
    async () => {
      const headers = new Headers(init.headers ?? {});
      headers.set("x-nexus-trace-id", init.trace_id);
      if (!headers.has("user-agent")) headers.set("user-agent", "nexus-mcp/0.1.0");

      const res = await fetch(url, { ...init, headers });
      const text = await res.text();

      if (!res.ok) {
        const hint =
          res.status === 401 || res.status === 403
            ? "Check credentials and permissions."
            : res.status === 404
              ? "Check the resource id (issue key, repo name, log group name)."
              : res.status === 429
                ? "Upstream rate limit. Nexus will retry with backoff."
                : "Check upstream service health and request parameters.";

        const message = `HTTP ${res.status} from ${new URL(url).host}. ${hint} Response: ${text.slice(0, 500)}`;

        // Retry transient errors (5xx, 429, 408). Abort on most 4xx.
        if (res.status >= 500 || res.status === 429 || res.status === 408) {
          throw new Error(message);
        }
        throw abortRetry(message);
      }

      if (!text) return null;
      try {
        return JSON.parse(text) as HttpJson;
      } catch {
        return text;
      }
    },
    { operation: init.operation },
  );
}
