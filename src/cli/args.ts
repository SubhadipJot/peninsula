import { UsageError } from "../core/errors.js";
import { setLogLevel } from "../core/logger.js";

export interface CliOptions {
  storeDir: string;
  profiles: string[];
  only?: string[];
  except?: string[];
  timeoutMs?: number;
  help: boolean;
}

export const HELP = `mcp-store — a gateway that serves every MCP server in your store through one connection

Usage:
  mcp-store [options]

Options:
  --store <dir>       Store directory with *.json server configs (default: ./store)
  --profile <name>    Only serve servers from this profile; repeatable (default: all enabled)
  --only <a,b>        Only serve these servers
  --except <a,b>      Serve all enabled servers except these
  --timeout <ms>      Per-request timeout for upstream calls (default: 30000)
  --log <level>       debug | info | warn | error (default: info)
  -h, --help          Show this help

Environment (.env loaded from repo root and <store>/.env, without overriding real env):
  MCP_STORE_LOG       Same as --log
`;

const csv = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

export function parseArgs(argv: string[]): CliOptions {
  const cli: CliOptions = { storeDir: "store", profiles: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--store":
        cli.storeDir = next();
        break;
      case "--profile":
        cli.profiles.push(next());
        break;
      case "--only":
        cli.only = csv(next());
        break;
      case "--except":
        cli.except = csv(next());
        break;
      case "--timeout": {
        const ms = Number(next());
        if (!Number.isFinite(ms) || ms <= 0) throw new UsageError(`--timeout must be a positive number`);
        cli.timeoutMs = ms;
        break;
      }
      case "--log":
        setLogLevel(next() as never);
        break;
      case "-h":
      case "--help":
        cli.help = true;
        return cli;
      default:
        throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return cli;
}
