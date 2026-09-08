/**
 * mcp-store public API.
 *
 * The CLI entry point lives in src/cli/main.ts; this module exposes the
 * building blocks (Gateway, registry loading, Upstream, schemas) for
 * embedding the store in other tools (e.g. a future `mcp-store sync`).
 */
export * from "./core/index.js";
export * from "./upstream/index.js";
export * from "./gateway/index.js";
