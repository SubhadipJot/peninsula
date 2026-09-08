import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";
import { UsageError } from "../../src/core/errors.js";

describe("parseArgs", () => {
  it("applies defaults", () => {
    expect(parseArgs([])).toEqual({ storeDir: "store", profiles: [], help: false });
  });

  it("parses every option", () => {
    const cli = parseArgs([
      "--store", "my-store",
      "--profile", "web",
      "--profile", "vcs",
      "--only", "a, b",
      "--except", "c",
      "--timeout", "5000",
    ]);
    expect(cli.storeDir).toBe("my-store");
    expect(cli.profiles).toEqual(["web", "vcs"]);
    expect(cli.only).toEqual(["a", "b"]);
    expect(cli.except).toEqual(["c"]);
    expect(cli.timeoutMs).toBe(5000);
  });

  it("rejects unknown flags and bad timeouts", () => {
    expect(() => parseArgs(["--nope"])).toThrow(UsageError);
    expect(() => parseArgs(["--timeout"])).toThrow(/missing value/);
    expect(() => parseArgs(["--timeout", "-1"])).toThrow(/positive/);
  });
});
