import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  CallToolResult,
  ListResourcesResult,
  ListToolsResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from "../core/config.js";
import { UpstreamConnectionError } from "../core/errors.js";
import { createLogger } from "../core/logger.js";
import { CLIENT_NAME, VERSION } from "../core/version.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export type UpstreamEvents = {
  onToolsChanged?: () => void;
  onResourcesChanged?: () => void;
  onPromptsChanged?: () => void;
  onClosed?: (reason?: string) => void;
};

/**
 * Manages one MCP client connection to a single upstream server,
 * with lazy connect and reconnect-on-demand.
 */
export class Upstream {
  readonly config: ServerConfig;
  lastError?: string;
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private log = createLogger(`upstream:${this.constructor.name}`);

  constructor(
    config: ServerConfig,
    private events: UpstreamEvents = {},
    private timeoutMs: number = DEFAULT_TIMEOUT_MS
  ) {
    this.config = config;
    this.log = createLogger(`upstream:${config.name}`);
  }

  get connected(): boolean {
    return this.client !== null;
  }

  get timeout(): number {
    return this.config.timeoutMs ?? this.timeoutMs;
  }

  private createTransport(): Transport {
    const cfg = this.config;
    if (cfg.transport === "stdio") {
      return new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        cwd: cfg.cwd,
        env: { ...getDefaultEnvironment(), ...cfg.env },
        stderr: "pipe",
      });
    }
    const url = new URL(cfg.url);
    const requestInit = Object.keys(cfg.headers).length > 0 ? { headers: cfg.headers } : undefined;
    if (cfg.transport === "sse") {
      return new SSEClientTransport(url, { requestInit });
    }
    return new StreamableHTTPClientTransport(url, { requestInit });
  }

  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const transport = this.createTransport();
      // Set handlers BEFORE connect(): the SDK wraps pre-existing onclose/onerror.
      transport.onclose = () => {
        this.log.warn("connection closed");
        this.client = null;
        this.events.onClosed?.("connection closed");
      };
      transport.onerror = (err) => {
        this.log.error(`transport error: ${(err as Error)?.message ?? err}`);
      };
      const client = new Client({ name: CLIENT_NAME, version: VERSION });
      if (transport instanceof StdioClientTransport && transport.stderr) {
        transport.stderr.on("data", (buf: Buffer) =>
          this.log.debug(`stderr: ${buf.toString().trimEnd()}`)
        );
      }
      try {
        await client.connect(transport, { timeout: this.timeout });
      } catch (err) {
        this.lastError = (err as Error)?.message ?? String(err);
        await transport.close().catch(() => {});
        throw new UpstreamConnectionError(
          `${this.config.name}: failed to connect: ${this.lastError}`
        );
      }
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        this.log.debug("tools changed");
        this.events.onToolsChanged?.();
      });
      client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
        this.events.onResourcesChanged?.();
      });
      client.setNotificationHandler(PromptListChangedNotificationSchema, () => {
        this.events.onPromptsChanged?.();
      });
      this.client = client;
      this.lastError = undefined;
      this.log.info(`connected (${this.config.transport})`);
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async ensure(): Promise<Client> {
    await this.connect();
    if (!this.client) throw new UpstreamConnectionError(`${this.config.name}: not connected`);
    return this.client;
  }

  async listTools(): Promise<ListToolsResult["tools"]> {
    const client = await this.ensure();
    const res = await client.listTools(undefined, { timeout: this.timeout });
    return res.tools;
  }

  async callTool(name: string, args: unknown): Promise<CallToolResult> {
    const client = await this.ensure();
    return client.callTool(
      { name, arguments: (args ?? {}) as Record<string, unknown> },
      undefined,
      { timeout: this.timeout, maxTotalTimeout: this.timeout * 2 }
    ) as Promise<CallToolResult>;
  }

  async listResources(): Promise<ListResourcesResult["resources"]> {
    const client = await this.ensure();
    if (!client.getServerCapabilities()?.resources) return [];
    const res = await client.listResources(undefined, { timeout: this.timeout });
    return res.resources;
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    const client = await this.ensure();
    return client.readResource({ uri }, { timeout: this.timeout });
  }

  async listPrompts() {
    const client = await this.ensure();
    if (!client.getServerCapabilities()?.prompts) return [];
    const res = await client.listPrompts(undefined, { timeout: this.timeout });
    return res.prompts;
  }

  async getPrompt(name: string, args?: Record<string, string>) {
    const client = await this.ensure();
    return client.getPrompt({ name, arguments: args ?? {} }, { timeout: this.timeout });
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      await client.close().catch(() => {});
      this.log.info("closed");
    }
  }
}
