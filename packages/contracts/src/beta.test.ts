import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { BetaArtsieInput } from "./beta.ts";

const decode = Schema.decodeUnknownSync(BetaArtsieInput);

describe("BetaArtsieInput", () => {
  it("accepts workspace-relative paths and catalogue app ids", () => {
    expect(decode({ action: "files", args: { path: "Projects/poster" } })).toEqual({
      action: "files",
      args: { path: "Projects/poster" },
    });
    expect(
      decode({ action: "launch", args: { app: "photocraft", path: "Inbox/a.png" } }).action,
    ).toBe("launch");
  });

  it("rejects absolute paths, traversal, backslashes and NUL bytes", () => {
    for (const path of ["/etc/passwd", "../outside", "Inbox/../../x", "Inbox\\x", "a\u0000b"]) {
      expect(() => decode({ action: "files", args: { path } })).toThrow();
    }
  });

  it("rejects app ids outside the catalogue shape", () => {
    expect(() => decode({ action: "launch", args: { app: "../../bin/sh" } })).toThrow();
    expect(() => decode({ action: "tools", args: { app: "PhotoCraft App" } })).toThrow();
  });

  it("never forwards keys an action does not define", () => {
    expect(() =>
      decode({ action: "apps", args: { tool: "rm", arguments: { path: "/" } } }),
    ).toThrow();
    expect(decode({ action: "files", args: { path: "Inbox", tool: "x" }, extra: true })).toEqual({
      action: "files",
      args: { path: "Inbox" },
    });
  });

  it("rejects actions the hub exposes but FD CODE does not forward", () => {
    expect(() => decode({ action: "call", args: { app: "photocraft", tool: "x" } })).toThrow();
  });
});
