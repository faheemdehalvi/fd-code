import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as NetService from "@fdcode/shared/Net";

import {
  DesktopBackendPortUnavailableError,
  DesktopDevelopmentBackendPortRequiredError,
  resolveDesktopBackendPort,
} from "./DesktopApp.ts";

describe("DesktopApp errors", () => {
  it("preserves unavailable backend port context", () => {
    const error = new DesktopBackendPortUnavailableError({
      startPort: 3_773,
      maxPort: 65_535,
      hosts: ["127.0.0.1", "0.0.0.0", "::"],
    });

    assert.equal(error.startPort, 3_773);
    assert.equal(error.maxPort, 65_535);
    assert.deepEqual(error.hosts, ["127.0.0.1", "0.0.0.0", "::"]);
    assert.equal(
      error.message,
      "No desktop backend port is available on hosts 127.0.0.1, 0.0.0.0, :: between 3773 and 65535.",
    );
  });

  it("reports the required development port", () => {
    const error = new DesktopDevelopmentBackendPortRequiredError();

    assert.equal(error.message, "FDCODE_PORT is required in desktop development.");
  });

  it.effect("uses an explicitly configured desktop backend port without probing", () => {
    let probes = 0;
    return Effect.gen(function* () {
      const selected = yield* resolveDesktopBackendPort(Option.some(43_123));

      assert.deepEqual(selected, { port: 43_123, selectedByScan: false });
      assert.equal(probes, 0);
    }).pipe(
      Effect.provideService(NetService.NetService, {
        canListenOnHost: () =>
          Effect.sync(() => {
            probes += 1;
            return true;
          }),
        isPortAvailableOnLoopback: () => Effect.die("unexpected loopback probe"),
        hasListenerOnHost: () => Effect.die("unexpected listener probe"),
        reserveLoopbackPort: () => Effect.die("unexpected port reservation"),
        findAvailablePort: () => Effect.die("unexpected available-port lookup"),
      }),
    );
  });

  it.effect("skips a stale default port and selects the next fully available port", () => {
    const probes: Array<readonly [number, string]> = [];
    return Effect.gen(function* () {
      const selected = yield* resolveDesktopBackendPort(Option.none());

      assert.deepEqual(selected, { port: 3_774, selectedByScan: true });
      assert.deepEqual(probes, [
        [3_773, "127.0.0.1"],
        [3_774, "127.0.0.1"],
        [3_774, "0.0.0.0"],
        [3_774, "::"],
      ]);
    }).pipe(
      Effect.provideService(NetService.NetService, {
        canListenOnHost: (port, host) =>
          Effect.sync(() => {
            probes.push([port, host]);
            return port !== 3_773;
          }),
        isPortAvailableOnLoopback: () => Effect.die("unexpected loopback probe"),
        hasListenerOnHost: () => Effect.die("unexpected listener probe"),
        reserveLoopbackPort: () => Effect.die("unexpected port reservation"),
        findAvailablePort: () => Effect.die("unexpected available-port lookup"),
      }),
    );
  });
});
