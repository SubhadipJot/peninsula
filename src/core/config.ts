import { z } from "zod";

// Server names must NOT contain "__" so gateway tool names can be parsed back.
export const serverNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'name must match ^[a-z0-9][a-z0-9-]*$ (lowercase letters, digits, hyphens)',
  });

const baseShape = z.object({
  name: serverNameSchema,
  description: z.string().optional(),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().optional(),
});

export const stdioServerSchema = baseShape.extend({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  cwd: z.string().optional(),
});

export const remoteServerSchema = baseShape.extend({
  transport: z.enum(["http", "sse"]),
  url: z.string().url(),
  headers: z.record(z.string()).default({}),
});

export const serverConfigSchema = z.discriminatedUnion("transport", [
  stdioServerSchema,
  remoteServerSchema,
]);

export type StdioServerConfig = z.infer<typeof stdioServerSchema>;
export type RemoteServerConfig = z.infer<typeof remoteServerSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;

export const profilesSchema = z.record(z.array(serverNameSchema));
export type Profiles = z.infer<typeof profilesSchema>;
