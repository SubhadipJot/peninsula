import { describe, expect, it } from "vitest";
import {
  dequalify,
  dequalifyUri,
  qualify,
  qualifyUri,
  SEP,
} from "../../src/gateway/namespacing.js";

describe("namespacing", () => {
  it("qualifies and dequalifies tool names", () => {
    expect(qualify("github", "create_issue")).toBe(`github${SEP}create_issue`);
    expect(dequalify(["github", "linear"], "github__create_issue")).toEqual([
      "github",
      "create_issue",
    ]);
  });

  it("handles server names that share a prefix", () => {
    const servers = ["git", "gitlab"];
    expect(dequalify(servers, "gitlab__issue")).toEqual(["gitlab", "issue"]);
    expect(dequalify(servers, "git__commit")).toEqual(["git", "commit"]);
  });

  it("returns null for unknown prefixes", () => {
    expect(dequalify(["github"], "nope__x")).toBeNull();
  });

  it("qualifies and dequalifies resource URIs by scheme prefix", () => {
    expect(qualifyUri("gh", "file:///a.txt")).toBe("gh+file:///a.txt");
    expect(dequalifyUri(["gh"], "gh+file:///a.txt")).toEqual(["gh", "file:///a.txt"]);
    expect(dequalifyUri(["gh"], "other+file:///a.txt")).toBeNull();
  });
});
