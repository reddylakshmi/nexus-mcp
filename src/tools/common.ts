import { z } from "zod";
import type { ZodRawShape } from "zod";
import { createTraceId } from "../lib/trace.js";
import { toActionableError } from "../lib/errors.js";
import type { Logger } from "../logger.js";

export type ToolHandler = (
  args: unknown,
  _extra?: unknown,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

export type NexusTool = {
  name: string;
  description: string;
  paramsSchema: ZodRawShape;
  handler: ToolHandler;
  mutates?: boolean;
};

export function wrapTool(params: {
  name: string;
  description: string;
  paramsSchema: ZodRawShape;
  logger: Logger;
  mutates?: boolean;
  fn: (args: any, ctx: { trace_id: string }) => Promise<unknown>;
}): NexusTool {
  const approvalShape = {
    approval: z
      .object({
        approved: z.boolean(),
        approver: z.string().min(1).optional(),
        reason: z.string().min(1).optional(),
      })
      .optional(),
  } satisfies ZodRawShape;

  const exposedParamsSchema = params.mutates ? { ...params.paramsSchema, ...approvalShape } : params.paramsSchema;
  const baseSchema = z.object(exposedParamsSchema);

  return {
    name: params.name,
    description: params.description,
    paramsSchema: exposedParamsSchema,
    mutates: params.mutates,
    handler: async (rawArgs: unknown) => {
      const trace_id = createTraceId();
      try {
        const parsed = baseSchema.safeParse(rawArgs);
        if (!parsed.success) {
          const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          return toolText({
            trace_id,
            error: `Invalid arguments — ${issues}`,
          });
        }

        if (params.mutates) {
          const approval = (parsed.data as any).approval;
          if (!approval?.approved) {
            return toolText({
              trace_id,
              requires_approval: {
                tool: params.name,
                summary: "This tool can mutate external state and requires human approval before execution.",
              },
            });
          }
        }

        params.logger.info({ trace_id, tool: params.name }, "tool.start");
        const result = await params.fn(parsed.data, { trace_id });
        params.logger.info({ trace_id, tool: params.name }, "tool.ok");
        return toolText({ trace_id, ok: true, result });
      } catch (err) {
        const message = toActionableError(err, {
          action: `${params.name} failed`,
          hint: "Check credentials, permissions, and input arguments.",
        });
        params.logger.error({ trace_id, tool: params.name, error: message }, "tool.error");
        return toolText({ trace_id, ok: false, error: message });
      }
    },
  };
}

export function toolText(payload: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
