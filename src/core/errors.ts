/** Base class for all mcp-store errors. */
export class StoreError extends Error {}

/** Thrown when a store file is structurally invalid or fails schema validation. */
export class StoreConfigError extends StoreError {}

/** Thrown when `{env:VAR}` placeholders reference variables that are not set. */
export class InterpolationError extends StoreConfigError {
  constructor(public missing: string[]) {
    super(`missing environment variables: ${missing.join(", ")}`);
    this.name = "InterpolationError";
  }
}

/** Thrown when an upstream MCP server cannot be connected to. */
export class UpstreamConnectionError extends StoreError {}

/** Thrown for bad CLI usage (unknown flag, missing value). */
export class UsageError extends StoreError {}
