import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Prompt, Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ServerConfig } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { PKG_NAME, VERSION } from "../core/version.js";
import { loadStore, type LoadResult } from "../core/registry.js";
import { DEFAULT_TIMEOUT_MS, Upstream } from "../upstream/index.js";
import { dequalify, dequalifyUri, qualify, qualifyUri } from "./namespacing.js";
import { isMetaTool, LIST_SERVERS, META_TOOLS, RELOAD, redactConfig, SERVER_STATUS } from "./meta-tools.js";

const log = createLogger("gateway");

export interface GatewayOptions {
  storeDir: string;
  profiles?: string[];
  only?: string[];
  except?: string[];
  timeoutMs?: number;
}

export type ServerStatusName = "idle" | "connected" | "error";

export interface ServerState {
  config: ServerConfig;
  upstream: Upstream;
  status: ServerStatusName;
  error?: string;
  toolCount: number;
}

export interface ServerSummary {
  name: string;
  transport: ServerConfig["transport"];
  tags: string[];
  description?: string;
  status: ServerStatusName;
  error?: string;
  tools: number;
}

export class Gateway {
  readonly server: Server;
  private states = new Map<string, ServerState>();
  private toolCache: Tool[] = [];
  private resourceCache: Resource[] = [];
  private promptCache: Prompt[] = [];
  private cachesDirty = true;
  private refreshing: Promise<void> | null = null;
  private opts: GatewayOptions & { timeoutMs: number };

  constructor(opts: GatewayOptions) {
    this.opts = { timeoutMs: DEFAULT_TIMEOUT_MS, ...opts };
    this.server = new Server(
      { name: PKG_NAME, version: VERSION },
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
        },
      }
    );
    this.registerHandlers();
  }

  /** Initial load: build upstream objects, connect, and warm tool/resource/prompt caches. */
  async start(): Promise<void> {
    this.loadRegistry();
    await this.refreshCaches();
  }

  async stop(): Promise<void> {
    await Promise.all([...this.states.values()].map((s) => s.upstream.close()));
    await this.server.close().catch(() => {});
  }

  summaries(): ServerSummary[] {
    return [...this.states.values()].map((s) => ({
      name: s.config.name,
      transport: s.config.transport,
      tags: s.config.tags,
      description: s.config.description,
      status: s.status,
      error: s.error,
      tools: s.toolCount,
    }));
  }

  private loadRegistry(): LoadResult {
    const result = loadStore({
      storeDir: path.resolve(this.opts.storeDir),
      profiles: this.opts.profiles,
      only: this.opts.only,
      except: this.opts.except,
    });
    const next = new Map<string, ServerState>();
    for (const cfg of result.servers) {
      const existing = this.states.get(cfg.name);
      if (existing && sameConfig(existing.config, cfg)) {
        next.set(cfg.name, existing);
        continue;
      }
      next.set(cfg.name, {
        config: cfg,
        upstream: this.makeUpstream(cfg),
        status: "idle",
        toolCount: 0,
      });
    }
    // close upstreams removed from the store
    for (const [name, state] of this.states) {
      if (!next.has(name)) void state.upstream.close();
    }
    this.states = next;
    this.cachesDirty = true;
    return result;
  }

  private makeUpstream(cfg: ServerConfig): Upstream {
    return new Upstream(
      cfg,
      {
        onToolsChanged: () => this.markDirtyAndNotify("notifications/tools/list_changed"),
        onResourcesChanged: () => this.markDirtyAndNotify("notifications/resources/list_changed"),
        onPromptsChanged: () => this.markDirtyAndNotify("notifications/prompts/list_changed"),
        onClosed: (reason) => {
          const state = this.states.get(cfg.name);
          if (state && state.status === "connected") {
            state.status = "idle";
            state.error = reason;
            this.markDirtyAndNotify("notifications/tools/list_changed");
          }
        },
      },
      this.opts.timeoutMs
    );
  }

  private markDirtyAndNotify(method: string): void {
    this.cachesDirty = true;
    void this.server
      .notification({ method })
      .catch(() => {}); // no connected downstream client yet / client lacks capability
  }

  private async refreshCaches(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const tools: Tool[] = [];
      const resources: Resource[] = [];
      const prompts: Prompt[] = [];

      await Promise.all(
        [...this.states.entries()].map(async ([name, state]) => {
          try {
            await state.upstream.connect();
            state.status = "connected";
            state.error = undefined;
          } catch (err) {
            state.status = "error";
            state.error = (err as Error).message;
            log.warn(`server "${name}" unavailable: ${state.error}`);
            return;
          }
          const serverTools = await state.upstream.listTools().catch((err) => {
            state.status = "error";
            state.error = (err as Error).message;
            return [];
          });
          state.toolCount = serverTools.length;
          for (const t of serverTools) {
            tools.push({
              ...t,
              name: qualify(name, t.name),
              description: `[${name}] ${t.description ?? t.name}`.slice(0, 4096),
            });
          }
          const serverResources = await state.upstream.listResources().catch(() => []);
          for (const r of serverResources) {
            resources.push({ ...r, uri: qualifyUri(name, r.uri) });
          }
          const serverPrompts = await state.upstream.listPrompts().catch(() => []);
          for (const p of serverPrompts) {
            prompts.push({ name: qualify(name, p.name), description: p.description });
          }
        })
      );

      tools.sort((a, b) => a.name.localeCompare(b.name));
      resources.sort((a, b) => a.uri.localeCompare(b.uri));
      this.toolCache = [...META_TOOLS, ...tools];
      this.resourceCache = resources;
      this.promptCache = prompts;
      this.cachesDirty = false;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async ensureCaches(): Promise<void> {
    if (this.cachesDirty) await this.refreshCaches();
  }

  private static errText(msg: string): CallToolResult {
    return { content: [{ type: "text", text: msg }], isError: true };
  }

  private static json(value: unknown): CallToolResult {
    return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
  }

  private async metaCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    switch (name) {
      case LIST_SERVERS:
        return Gateway.json(this.summaries());
      case SERVER_STATUS: {
        const server = String(args.server ?? "");
        const state = this.states.get(server);
        if (!state)
          return Gateway.errText(
            `unknown server "${server}" (known: ${[...this.states.keys()].join(", ")})`
          );
        const tools =
          state.status === "connected"
            ? (await state.upstream.listTools().catch(() => [])).map((t) => t.name)
            : [];
        return Gateway.json({
          config: redactConfig(state.config),
          status: state.status,
          error: state.error,
          tools,
        });
      }
      case RELOAD: {
        const result = this.loadRegistry();
        await this.refreshCaches();
        return Gateway.json({ reloaded: [...this.states.keys()], skipped: result.skipped });
      }
      default:
        return Gateway.errText(`unknown meta tool "${name}"`);
    }
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      await this.ensureCaches();
      return { tools: this.toolCache };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name, arguments: args } = req.params;
      if (isMetaTool(name))
        return this.metaCall(name, (args ?? {}) as Record<string, unknown>);
      await this.ensureCaches();
      const parsed = dequalify(this.states.keys(), name);
      if (!parsed) return Gateway.errText(`no such tool: "${name}"`);
      const [server, toolName] = parsed;
      const state = this.states.get(server)!;
      try {
        return await state.upstream.callTool(toolName, args);
      } catch (err) {
        return Gateway.errText(`call ${server}.${toolName} failed: ${(err as Error).message}`);
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      await this.ensureCaches();
      return { resources: this.resourceCache };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      await this.ensureCaches();
      const parsed = dequalifyUri(this.states.keys(), req.params.uri);
      if (!parsed) throw new Error(`no such resource: "${req.params.uri}"`);
      const [server, uri] = parsed;
      const result = await this.states.get(server)!.upstream.readResource(uri);
      return {
        contents: result.contents.map((c) => ({ ...c, uri: qualifyUri(server, c.uri) })),
      };
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      await this.ensureCaches();
      return { prompts: this.promptCache };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (req) => {
      await this.ensureCaches();
      const parsed = dequalify(this.states.keys(), req.params.name);
      if (!parsed) throw new Error(`no such prompt: "${req.params.name}"`);
      const [server, promptName] = parsed;
      return this.states.get(server)!.upstream.getPrompt(promptName, req.params.arguments);
    });
  }
}

function sameConfig(a: ServerConfig, b: ServerConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
