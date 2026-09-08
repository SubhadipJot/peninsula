type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = ORDER[(process.env.MCP_STORE_LOG as Level) ?? "info"] ?? ORDER.info;

export function setLogLevel(level: Level): void {
  threshold = ORDER[level];
}

// Logs go to stderr ONLY: stdout is reserved for the MCP stdio transport.
function log(level: Level, scope: string, msg: string, extra?: unknown): void {
  if (ORDER[level] < threshold) return;
  const line = `[mcp-store] ${level.toUpperCase()} ${scope}: ${msg}`;
  if (extra !== undefined) {
    console.error(line, extra instanceof Error ? extra.message : extra);
  } else {
    console.error(line);
  }
}

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  const make = (level: Level) => (msg: string, extra?: unknown) => log(level, scope, msg, extra);
  return {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    child: (sub: string) => createLogger(`${scope}/${sub}`),
  };
}
