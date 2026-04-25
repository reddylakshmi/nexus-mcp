import "dotenv/config";
import { createNexusServer } from "./server.js";
import { Config } from "./config.js";
import { createLogger } from "./logger.js";

type TransportKind = "stdio" | "sse";

function parseArgs(argv: string[]): { transport: TransportKind; host: string; port: number } {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : "true";
    args.set(key, value);
  }

  const transport = (args.get("transport") ?? process.env.NEXUS_TRANSPORT ?? "stdio") as TransportKind;
  const host = args.get("host") ?? process.env.NEXUS_HOST ?? "0.0.0.0";
  const portRaw = args.get("port") ?? process.env.NEXUS_PORT ?? "8787";
  const port = Number(portRaw);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`Invalid port: ${portRaw}`);
  if (transport !== "stdio" && transport !== "sse") throw new Error(`Invalid transport: ${transport}`);

  return { transport, host, port };
}

async function main() {
  const { transport, host, port } = parseArgs(process.argv.slice(2));
  const config = Config.fromEnv(process.env);
  const logger = createLogger({ service: "nexus" });

  if (transport === "stdio") {
    const server = createNexusServer({ config, logger });
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    await server.connect(new StdioServerTransport());
    logger.info({ transport: "stdio" }, "Nexus MCP server started");
    return;
  }

  const { startSseTransport } = await import("./transports/sse.js");
  await startSseTransport({
    serverFactory: () => createNexusServer({ config, logger }),
    host,
    port,
    logger,
    publicBaseUrl: config.nexusPublicBaseUrl,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
