#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { UsageError } from "../core/errors.js";
import { createLogger } from "../core/logger.js";
import { Gateway } from "../gateway/index.js";
import { HELP, parseArgs } from "./args.js";

const log = createLogger("cli");

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    process.stdout.write(HELP);
    return;
  }
  const storeDir = path.resolve(cli.storeDir);
  // .env resolution order (first match wins, real env always beats .env):
  // package root (works when launched by path, not cwd), then store-local.
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  loadDotenv({ path: path.join(packageRoot, ".env") });
  loadDotenv({ path: path.join(storeDir, ".env") });

  const gateway = new Gateway({
    storeDir,
    profiles: cli.profiles,
    only: cli.only,
    except: cli.except,
    timeoutMs: cli.timeoutMs,
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    void gateway.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await gateway.start();
  log.info(`serving ${gateway.summaries().length} server(s) from ${storeDir} over stdio`);
  await gateway.server.connect(new StdioServerTransport());

  await new Promise<void>((resolve) => {
    gateway.server.onclose = () => resolve();
    process.stdin.on("end", resolve);
    process.stdin.on("close", resolve);
  });
  await gateway.stop();
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  if (err instanceof UsageError) console.error(`[mcp-store] ${err.message}\n\n${HELP}`);
  else console.error(`[mcp-store] FATAL: ${msg}`);
  process.exit(1);
});
