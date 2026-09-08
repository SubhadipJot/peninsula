import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const TOOLS = [
  {
    name: "echo",
    description: "Echo text back",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "add",
    description: "Add two numbers",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "which_token",
    description: "Report the TEST_TOKEN env var",
    inputSchema: { type: "object", properties: {} },
  },
];

const server = new Server(
  { name: "fake-upstream", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name } = req.params;
  const args = req.params.arguments ?? {};
  if (name === "echo") return { content: [{ type: "text", text: String(args.text ?? "") }] };
  if (name === "add") return { content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }] };
  if (name === "which_token")
    return { content: [{ type: "text", text: process.env.TEST_TOKEN ?? "" }] };
  throw new Error(`unknown tool: ${name}`);
});

server.setRequestHandler(ListResourcesRequestSchema, () => ({
  resources: [{ uri: "data://greeting", name: "greeting", mimeType: "text/plain" }],
}));
server.setRequestHandler(ReadResourceRequestSchema, (req) => {
  if (req.params.uri === "data://greeting")
    return { contents: [{ uri: req.params.uri, mimeType: "text/plain", text: "hello from fake" }] };
  throw new Error(`unknown resource: ${req.params.uri}`);
});

server.setRequestHandler(ListPromptsRequestSchema, () => ({
  prompts: [{ name: "greet", description: "A greeting prompt", arguments: [] }],
}));
server.setRequestHandler(GetPromptRequestSchema, () => ({
  messages: [{ role: "user", content: { type: "text", text: "greet!" } }],
}));

await server.connect(new StdioServerTransport());
