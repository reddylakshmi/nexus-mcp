import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Config } from "./config.js";
import type { Logger } from "./logger.js";
import { nexusJiraContextTool } from "./tools/nexus_jira_context.js";
import { nexusGithubInspectorTool } from "./tools/nexus_github_inspector.js";
import { nexusAwsTriageTool } from "./tools/nexus_aws_triage.js";
import { nexusCrossReferenceTool } from "./tools/nexus_cross_reference.js";

export function createNexusServer(params: { config: Config; logger: Logger }) {
  const server = new McpServer(
    { name: "nexus", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  for (const tool of [
    nexusJiraContextTool(params),
    nexusGithubInspectorTool(params),
    nexusAwsTriageTool(params),
    nexusCrossReferenceTool(params),
  ]) {
    server.tool(tool.name, tool.description, tool.paramsSchema, tool.handler);
  }

  return server;
}
