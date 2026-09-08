import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadStore } from "../../src/core/registry.js";

let dir: string;

function write(file: string, content: unknown): void {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(content, null, 2));
}

function reset(): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-store-reg-"));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => reset());

describe("loadStore", () => {
  it("loads valid stdio servers and applies defaults", () => {
    write("a.json", { name: "alpha", transport: "stdio", command: "node", args: ["x.js"] });
    const { servers, skipped } = loadStore({ storeDir: dir });
    expect(skipped).toEqual([]);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      name: "alpha",
      enabled: true,
      tags: [],
      env: {},
    });
  });

  it("skips disabled servers silently", () => {
    write("a.json", { name: "alpha", transport: "stdio", command: "node", enabled: false });
    write("b.json", { name: "beta", transport: "stdio", command: "node" });
    const { servers } = loadStore({ storeDir: dir });
    expect(servers.map((s) => s.name)).toEqual(["beta"]);
  });

  it("records invalid files as skipped with reason", () => {
    write("bad.json", { name: "not there", transport: "stdio", command: "node" });
    const { skipped } = loadStore({ storeDir: dir });
    expect(skipped.some((s) => s.file === "bad.json")).toBe(true);
    fs.rmSync(path.join(dir, "bad.json"));
  });

  it("interpolates {env:VAR} from provided env", () => {
    write(
      "a.json",
      {
        name: "alpha",
        transport: "stdio",
        command: "node",
        args: ["--token", "{env:MY_TOKEN}"],
        env: { SECRET: "{env:MY_SECRET}" },
      }
    );
    const { servers, skipped } = loadStore({
      storeDir: dir,
      env: { MY_TOKEN: "t0", MY_SECRET: "s0" } as NodeJS.ProcessEnv,
    });
    expect(skipped).toEqual([]);
    const cfg = servers[0];
    expect(cfg.transport === "stdio" && cfg.args).toEqual(["--token", "t0"]);
    expect(cfg.transport === "stdio" && cfg.env).toEqual({ SECRET: "s0" });
  });

  it("skips a server when referenced env vars are missing", () => {
    write("a.json", {
      name: "alpha",
      transport: "stdio",
      command: "node",
      env: { SECRET: "{env:NOT_SET_VAR}" },
    });
    const { servers, skipped } = loadStore({ storeDir: dir, env: {} as NodeJS.ProcessEnv });
    expect(servers).toHaveLength(0);
    expect(skipped[0]?.reason).toMatch(/NOT_SET_VAR/);
  });

  it("filters by profile", () => {
    write("a.json", { name: "alpha", transport: "stdio", command: "node" });
    write("b.json", { name: "beta", transport: "stdio", command: "node" });
    write("profiles.json", { web: ["beta"] });
    const { servers } = loadStore({ storeDir: dir, profiles: ["web"] });
    expect(servers.map((s) => s.name)).toEqual(["beta"]);
    expect(() => loadStore({ storeDir: dir, profiles: ["nope"] })).toThrow(/unknown profile/);
    fs.rmSync(path.join(dir, "profiles.json"));
  });

  it("honors only/except", () => {
    write("a.json", { name: "alpha", transport: "stdio", command: "node" });
    write("b.json", { name: "beta", transport: "stdio", command: "node" });
    const all = () => loadStore({ storeDir: dir }).servers.map((s) => s.name);
    expect(all().sort()).toEqual(["alpha", "beta"]);
    expect(loadStore({ storeDir: dir, only: ["beta"] }).servers.map((s) => s.name)).toEqual(["beta"]);
    expect(loadStore({ storeDir: dir, except: ["beta"] }).servers.map((s) => s.name)).toEqual(["alpha"]);
    expect(() => loadStore({ storeDir: dir, only: ["gamma"] })).toThrow(/not found in store/);
  });

  it("rejects duplicate server names", () => {
    write("a.json", { name: "alpha", transport: "stdio", command: "node" });
    write("c.json", { name: "alpha", transport: "stdio", command: "node" });
    expect(() => loadStore({ storeDir: dir })).toThrow(/duplicate server name/);
  });

  it("validates remote server configs", () => {
    write(
      "r.json",
      { name: "remote", transport: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } }
    );
    const { servers, skipped } = loadStore({ storeDir: dir });
    expect(skipped.filter((s) => s.file === "r.json")).toEqual([]);
    expect(servers.some((s) => s.name === "remote" && s.transport === "http")).toBe(true);
    fs.rmSync(path.join(dir, "r.json"));
  });
});
