import { describe, expect, it } from "vitest";

import { descendantPids, makeIsolatedEnvironment, parseSmokeArguments } from "./smoke-test-lib.mjs";

describe("desktop lifecycle smoke helpers", () => {
  it("replaces ambient state and credential paths with test-owned paths", () => {
    const result = makeIsolatedEnvironment({
      inherited: {
        HOME: "/Users/example",
        T3CODE_HOME: "/Users/example/.fd-code",
        VITE_DEV_SERVER_URL: "http://localhost:5173",
        OPENAI_API_KEY: "secret",
        CLAUDE_CODE_OAUTH_TOKEN: "secret",
        AWS_PROFILE: "production",
        SSH_AUTH_SOCK: "/private/tmp/agent.sock",
        ELECTRON_RUN_AS_NODE: "1",
      },
      root: "/tmp/fd-code-smoke-owned",
      backendPort: 43123,
    });

    expect(result.environment.HOME).toBe("/tmp/fd-code-smoke-owned/home");
    expect(result.environment.T3CODE_HOME).toBe("/tmp/fd-code-smoke-owned/fd-code-home");
    expect(result.environment.T3CODE_PORT).toBe("43123");
    expect(result.environment.PATH).not.toContain("homebrew");
    expect(result.environment.VITE_DEV_SERVER_URL).toBeUndefined();
    expect(result.environment.OPENAI_API_KEY).toBeUndefined();
    expect(result.environment.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(result.environment.AWS_PROFILE).toBeUndefined();
    expect(result.environment.SSH_AUTH_SOCK).toBeUndefined();
    expect(result.environment.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("tracks only descendants of the launched Electron process", () => {
    expect([
      ...descendantPids(10, [
        { pid: 11, parentPid: 10, command: "renderer" },
        { pid: 12, parentPid: 11, command: "utility" },
        { pid: 20, parentPid: 1, command: "unrelated" },
      ]),
    ]).toEqual([11, 12]);
  });

  it("rejects unknown command-line arguments", () => {
    expect(() => parseSmokeArguments(["--unknown"])).toThrow("Unknown desktop smoke argument");
    expect(parseSmokeArguments(["--app-executable", "/app", "--expect-arch", "arm64"])).toEqual({
      appExecutable: "/app",
      expectedArchitecture: "arm64",
    });
  });
});
