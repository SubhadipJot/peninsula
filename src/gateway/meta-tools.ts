import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { META_PREFIX } from "./namespacing.js";

export const LIST_SERVERS = `${META_PREFIX}list_servers`;
export const SERVER_STATUS = `${META_PREFIX}server_status`;
export const RELOAD = `${META_PREFIX}reload`;

export const META_TOOLS: Tool[] = [
  {
    name: LIST_SERVERS,
    description: "List all MCP servers in the store with connection status and tool counts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: SERVER_STATUS,
    description: "Show status, config (secrets redacted) and tools of one store server.",
    inputSchema: {
      type: "object",
      properties: { server: { type: "string", description: "Server name" } },
      required: ["server"],
      additionalProperties: false,
    },
  },
  {
    name: RELOAD,
    description: "Reload the store directory, restart upstream connections, and refresh tool lists.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const SECRET_KEY = /token|key|secret|password|auth|credential/i;

export function isMetaTool(name: string): boolean {
  return name.startsWith(META_PREFIX);
}

/** Deep-copies a config with values of secret-looking keys replaced by "***". */
export function redactConfig<T extends { transport: string }>(cfg: T): T {
  const c = structuredClone(cfg);
  const redactMap = (m: Record<string, string>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, SECRET_KEY.test(k) ? "***" : v]));
  if (c.transport === "stdio") {
    const s = c as unknown as { env: Record<string, string> };
    s.env = redactMap(s.env);
  } else {
    const r = c as unknown as { headers: Record<string, string> };
    r.headers = redactMap(r.headers);
  }
  return c;
}
