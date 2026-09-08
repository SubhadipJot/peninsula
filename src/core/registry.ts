import fs from "node:fs";
import path from "node:path";
import { ServerConfig, profilesSchema, serverConfigSchema } from "./config.js";
import { InterpolationError } from "./errors.js";
import { createLogger } from "./logger.js";

const log = createLogger("registry");

const ENV_REF = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

export interface LoadOptions {
  storeDir: string;
  profiles?: string[];
  only?: string[];
  except?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface LoadResult {
  servers: ServerConfig[];
  skipped: { file: string; name?: string; reason: string }[];
}

function interpolateString(value: string, env: NodeJS.ProcessEnv): string {
  const missing = new Set<string>();
  const out = value.replace(ENV_REF, (_m, name: string) => {
    const v = env[name];
    if (v === undefined || v === "") {
      missing.add(name);
      return "";
    }
    return v;
  });
  if (missing.size > 0) throw new InterpolationError([...missing]);
  return out;
}

function interpolateConfig(cfg: ServerConfig, env: NodeJS.ProcessEnv): ServerConfig {
  const next = structuredClone(cfg);
  if (next.transport === "stdio") {
    next.command = interpolateString(next.command, env);
    next.args = next.args.map((a) => interpolateString(a, env));
    next.env = Object.fromEntries(
      Object.entries(next.env).map(([k, v]) => [k, interpolateString(v, env)])
    );
  } else {
    next.url = interpolateString(next.url, env);
    next.headers = Object.fromEntries(
      Object.entries(next.headers).map(([k, v]) => [k, interpolateString(v, env)])
    );
  }
  return next;
}

function resolveSelection(storeDir: string, opts: LoadOptions, names: Set<string>): Set<string> | null {
  const allow = new Set<string>();
  let hasSelection = false;

  if (opts.profiles?.length) {
    const profilesPath = path.join(storeDir, "profiles.json");
    if (!fs.existsSync(profilesPath)) {
      throw new Error(`profiles requested (${opts.profiles.join(",")}) but ${profilesPath} not found`);
    }
    const profiles = profilesSchema.parse(JSON.parse(fs.readFileSync(profilesPath, "utf8")));
    for (const p of opts.profiles) {
      const list = profiles[p];
      if (!list) throw new Error(`unknown profile "${p}" (available: ${Object.keys(profiles).join(", ")})`);
      for (const n of list) allow.add(n);
    }
    hasSelection = true;
  }
  if (opts.only?.length) {
    for (const n of opts.only) allow.add(n);
    hasSelection = true;
  }
  if (!hasSelection) return null; // all enabled
  for (const n of allow) {
    if (!names.has(n)) throw new Error(`selected server "${n}" not found in store`);
  }
  return allow;
}

export function loadStore(opts: LoadOptions): LoadResult {
  const env = opts.env ?? process.env;
  const storeDir = path.resolve(opts.storeDir);
  if (!fs.existsSync(storeDir)) throw new Error(`store dir not found: ${storeDir}`);

  const files = fs
    .readdirSync(storeDir)
    .filter((f) => f.endsWith(".json") && f !== "profiles.json" && !f.startsWith("."))
    .sort();

  const parsed: { file: string; cfg: ServerConfig }[] = [];
  const skipped: LoadResult["skipped"] = [];

  for (const file of files) {
    const full = path.join(storeDir, file);
    let cfg: ServerConfig;
    try {
      const raw = JSON.parse(fs.readFileSync(full, "utf8"));
      cfg = serverConfigSchema.parse(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ file, reason });
      log.warn(`${file} skipped: ${reason}`);
      continue;
    }
    if (!cfg.enabled) {
      log.debug(`${file} disabled`);
      continue;
    }
    parsed.push({ file, cfg });
  }

  const names = new Set(parsed.map((p) => p.cfg.name));
  const dupCheck = new Set<string>();
  for (const p of parsed) {
    if (dupCheck.has(p.cfg.name)) {
      throw new Error(`duplicate server name "${p.cfg.name}" (${p.file})`);
    }
    dupCheck.add(p.cfg.name);
  }

  const selection = resolveSelection(storeDir, opts, names);
  const except = new Set(opts.except ?? []);

  const servers: ServerConfig[] = [];
  for (const { file, cfg } of parsed) {
    if (selection && !selection.has(cfg.name)) continue;
    if (except.has(cfg.name)) continue;
    try {
      servers.push(interpolateConfig(cfg, env));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ file, name: cfg.name, reason });
      log.warn(`${cfg.name} skipped: ${reason}`);
    }
  }
  return { servers, skipped };
}
