// Manual smoke test: spawns the gateway with the real ./store and lists tools.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli/main.js", "--store", "store", "--profile", process.argv[2] ?? "default"],
  })
);
const { tools } = await client.listTools();
console.log(`total tools: ${tools.length}`);
for (const t of tools.slice(0, 12)) console.log(" -", t.name);
const status = await client.callTool({ name: "store__list_servers", arguments: {} });
console.log(JSON.stringify(JSON.parse(status.content[0].text).map((s) => `${s.name}:${s.status}(${s.tools})`)));
await client.close();
process.exit(0);
