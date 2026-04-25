import { z } from "zod";
import { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { createCloudWatchLogsClient } from "../auth/aws.js";
import { AwsTriageService } from "../services/aws.js";
import { wrapTool } from "./common.js";

const paramsSchema = {
  log_group_names: z.array(z.string().min(1)).min(1).describe("CloudWatch Log Group names to query."),
  minutes_ago: z.number().int().min(1).max(24 * 60).default(60),
  query_string: z
    .string()
    .min(1)
    .optional()
    .describe("Optional CloudWatch Logs Insights query. If omitted, Nexus uses a safe default error-centric query."),
} as const;

const inputSchema = z.object(paramsSchema);
type Input = z.infer<typeof inputSchema>;

const defaultQuery =
  "fields @timestamp, @message, @log | filter @message like /ERROR|Error|Exception|Task|timed out|timeout|5xx| 500 / | sort @timestamp desc | limit 200";

export function nexusAwsTriageTool(params: { config: Config; logger: Logger }) {
  return wrapTool({
    name: "nexus_aws_triage",
    description:
      "Query CloudWatch Log Insights and parse Lambda/ECS errors into a structured Impact Summary.",
    paramsSchema,
    logger: params.logger,
    fn: async (args: Input, ctx) => {
      const logsClient = await createCloudWatchLogsClient(params.config);
      const triage = new AwsTriageService(logsClient);

      const endTimeMs = Date.now();
      const startTimeMs = endTimeMs - args.minutes_ago * 60_000;

      const rows = await triage.runInsightsQuery({
        trace_id: ctx.trace_id,
        logGroupNames: args.log_group_names,
        startTimeMs,
        endTimeMs,
        queryString: args.query_string ?? defaultQuery,
      });

      const impact = triage.summarize({
        logGroupNames: args.log_group_names,
        startTimeMs,
        endTimeMs,
        rows,
      });

      return { impact_summary: impact };
    },
  });
}
