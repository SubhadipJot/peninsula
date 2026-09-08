import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const storeDir = path.join(here, "tmp-store");
const fixture = path.join(here, "..", "fixtures", "fake-upstream.mjs");
const gatewayEntry = path.join(root, "dist", "cli", "main.js");
const TEST_TOKEN = "sekrit-42";

const text = (r: CallToolResult) =>
  (r.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");

let client: Client;

beforeAll(async () => {
  fs.rmSync(storeDir, { recursive: true, force: true });
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(
    path.join(storeDir, "fake.json"),
    JSON.stringify(
      {
        name: "fake",
        transport: "stdio",
        command: process.execPath,
        args: [fixture],
        env: { TEST_TOKEN: "{env:TEST_TOKEN}" },
      },
      null,
      2
    )
  );
  client = new Client({ name: "mcp-store-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [gatewayEntry, "--store", storeDir, "--log", "warn"],
      cwd: root,
      env: { ...getDefaultEnvironment(), TEST_TOKEN },
    })
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
  fs.rmSync(storeDir, { recursive: true, force: true });
});

describe("mcp-store gateway (e2e over stdio)", () => {
  it("lists namespaced tools plus meta tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("fake__echo");
    expect(names).toContain("fake__add");
    expect(names).toContain("fake__which_token");
    expect(names).toContain("store__list_servers");
    expect(names).toContain("store__server_status");
    expect(names).toContain("store__reload");
    const echo = tools.find((t) => t.name === "fake__echo");
    expect(echo?.description).toMatch(/^\[fake\]/);
    expect(echo?.inputSchema).toBeTruthy();
  });

  it("proxies tool calls", async () => {
    const echo = await client.callTool({ name: "fake__echo", arguments: { text: "hello" } });
    expect(text(echo as CallToolResult)).toBe("hello");
    const add = await client.callTool({ name: "fake__add", arguments: { a: 2, b: 3 } });
    expect(text(add as CallToolResult)).toBe("5");
  });

  it("interpolates {env:VAR} into upstream env", async () => {
    const r = (await client.callTool({ name: "fake__which_token", arguments: {} })) as CallToolResult;
    expect(text(r)).toBe(TEST_TOKEN);
  });

  it("returns isError for unknown tool (forwarded to upstream)", async () => {
    const r = (await client.callTool({ name: "fake__nope", arguments: {} })) as CallToolResult;
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/unknown tool/);
  });

  it("returns isError for unknown server namespace", async () => {
    const r = (await client.callTool({ name: "ghost__nope", arguments: {} })) as CallToolResult;
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/no such tool/i);
  });

  it("proxies resources with namespaced URIs", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain("fake+data://greeting");
    const read = await client.readResource({ uri: "fake+data://greeting" });
    expect(read.contents[0].uri).toBe("fake+data://greeting");
    expect((read.contents[0] as { text?: string }).text).toBe("hello from fake");
  });

  it("proxies prompts", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("fake__greet");
    const got = await client.getPrompt({ name: "fake__greet", arguments: {} });
    expect(got.messages).toHaveLength(1);
  });

  it("reports server status via meta tool (with redaction)", async () => {
    const r = (await client.callTool({
      name: "store__server_status",
      arguments: { server: "fake" },
    })) as CallToolResult;
    expect(r.isError).toBeFalsy();
    const status = JSON.parse(text(r));
    expect(status.status).toBe("connected");
    expect(status.tools).toEqual(["echo", "add", "which_token"]);
    expect(status.config.env.TEST_TOKEN).toBe("***");
  });

  it("handles store__reload", async () => {
    const r = (await client.callTool({ name: "store__reload", arguments: {} })) as CallToolResult;
    const result = JSON.parse(text(r));
    expect(result.reloaded).toContain("fake");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("fake__echo");
  });
});
