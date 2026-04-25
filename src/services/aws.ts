import {
  CloudWatchLogsClient,
  StartQueryCommand,
  GetQueryResultsCommand,
  StopQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { withRetry } from "../lib/retry.js";

type LogRow = Record<string, string>;

export type ImpactSummary = {
  window: { startTimeIso: string; endTimeIso: string; logGroupNames: string[] };
  totalRows: number;
  errorsByKind: Record<string, number>;
  topMessages: Array<{ message: string; count: number }>;
  samples: Array<{ timestamp?: string; logGroup?: string; message?: string }>;
};

export class AwsTriageService {
  constructor(private readonly logs: CloudWatchLogsClient) {}

  async runInsightsQuery(params: {
    trace_id: string;
    logGroupNames: string[];
    startTimeMs: number;
    endTimeMs: number;
    queryString: string;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<LogRow[]> {
    const startSeconds = Math.floor(params.startTimeMs / 1000);
    const endSeconds = Math.floor(params.endTimeMs / 1000);

    const queryId = await withRetry(
      async () => {
        const resp = await this.logs.send(
          new StartQueryCommand({
            logGroupNames: params.logGroupNames,
            startTime: startSeconds,
            endTime: endSeconds,
            queryString: params.queryString,
            limit: 1000,
          }),
        );
        if (!resp.queryId) throw new Error("CloudWatch StartQuery returned no queryId.");
        return resp.queryId;
      },
      { operation: "aws.logs.StartQuery" },
    );

    const pollIntervalMs = params.pollIntervalMs ?? 750;
    const timeoutMs = params.timeoutMs ?? 25_000;
    const deadline = Date.now() + timeoutMs;

    try {
      while (Date.now() < deadline) {
        const resp = await withRetry(
          async () => this.logs.send(new GetQueryResultsCommand({ queryId })),
          { operation: "aws.logs.GetQueryResults" },
        );
        const status = resp.status ?? "Unknown";
        if (status === "Complete") {
          const rows: LogRow[] = [];
          for (const row of resp.results ?? []) {
            const obj: LogRow = {};
            for (const cell of row) {
              if (cell.field && cell.value != null) obj[cell.field] = cell.value;
            }
            rows.push(obj);
          }
          return rows;
        }
        if (status === "Failed" || status === "Cancelled" || status === "Timeout") {
          throw new Error(`CloudWatch Logs Insights query ${status}.`);
        }
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      throw new Error("CloudWatch Logs Insights query timed out while polling.");
    } finally {
      // Best-effort stop; ignore errors.
      void this.logs.send(new StopQueryCommand({ queryId })).catch(() => undefined);
    }
  }

  summarize(params: {
    logGroupNames: string[];
    startTimeMs: number;
    endTimeMs: number;
    rows: LogRow[];
  }): ImpactSummary {
    const errorsByKind: Record<string, number> = {};
    const messageCounts = new Map<string, number>();

    const samples: ImpactSummary["samples"] = [];
    for (const r of params.rows) {
      const message = r["@message"] ?? r.message ?? "";
      const kind = classifyErrorKind(message);
      errorsByKind[kind] = (errorsByKind[kind] ?? 0) + 1;

      if (message) messageCounts.set(message, (messageCounts.get(message) ?? 0) + 1);
      if (samples.length < 8) {
        samples.push({
          timestamp: r["@timestamp"] ?? r.timestamp,
          logGroup: r["@log"] ?? r.logGroup,
          message: message ? message.slice(0, 500) : undefined,
        });
      }
    }

    const topMessages = [...messageCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message: message.slice(0, 400), count }));

    return {
      window: {
        startTimeIso: new Date(params.startTimeMs).toISOString(),
        endTimeIso: new Date(params.endTimeMs).toISOString(),
        logGroupNames: params.logGroupNames,
      },
      totalRows: params.rows.length,
      errorsByKind,
      topMessages,
      samples,
    };
  }
}

function classifyErrorKind(message: string): string {
  const m = message.toLowerCase();
  if (!m) return "unknown";
  if (m.includes("task stopped") || m.includes("essential container") || m.includes("exit code")) return "ecs_task";
  if (m.includes("timed out") || m.includes("timeout") || m.includes("task timed out")) return "timeout";
  if (m.includes("throttle") || m.includes("rate exceeded") || m.includes("too many requests")) return "throttling";
  if (m.includes("accessdenied") || m.includes("unauthorized") || m.includes("permission")) return "authz";
  if (m.includes("outofmemory") || m.includes("oom") || m.includes("killed")) return "memory";
  if (m.includes("exception") || m.includes("stack trace") || m.includes("traceback")) return "exception";
  if (m.includes("5xx") || m.includes(" 500 ") || m.includes("internal server error")) return "http_5xx";
  if (m.includes("4xx") || m.includes(" 429 ") || m.includes("bad request")) return "http_4xx";
  if (m.includes("error")) return "error";
  return "other";
}

