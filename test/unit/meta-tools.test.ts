import { describe, expect, it } from "vitest";
import { stdioServerSchema } from "../../src/core/config.js";
import { redactConfig } from "../../src/gateway/meta-tools.js";

describe("redactConfig", () => {
  it("redacts secret-looking env values for stdio servers", () => {
    const cfg = stdioServerSchema.parse({
      name: "demo",
      transport: "stdio",
      command: "node",
      env: { GITHUB_TOKEN: "abc", LOG_LEVEL: "debug", AWS_SECRET_ACCESS_KEY: "s3cr3t" },
    });
    const out = redactConfig(cfg);
    expect(out.env).toEqual({ GITHUB_TOKEN: "***", LOG_LEVEL: "debug", AWS_SECRET_ACCESS_KEY: "***" });
  });

  it("does not mutate the original config", () => {
    const cfg = stdioServerSchema.parse({
      name: "demo",
      transport: "stdio",
      command: "node",
      env: { API_KEY: "keep-me" },
    });
    redactConfig(cfg);
    expect(cfg.env.API_KEY).toBe("keep-me");
  });
});
