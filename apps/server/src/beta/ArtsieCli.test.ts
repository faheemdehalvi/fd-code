import { expect, it } from "@effect/vitest";
import * as NodePath from "@effect/platform-node/NodePath";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ExitCode } from "effect/process/ChildProcessSpawner";
import * as ProcessRunner from "../processRunner.ts";
import * as ArtsieCli from "./ArtsieCli.ts";

const output = (stdout: string, code = 0): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});
const runWith = (run: ProcessRunner.ProcessRunner["Service"]["run"], argv: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    return yield* (yield* ArtsieCli.ArtsieCli).run(argv);
  }).pipe(
    Effect.provide(
      ArtsieCli.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ProcessRunner.ProcessRunner, { run }),
            NodePath.layer,
            ConfigProvider.layer(
              ConfigProvider.fromEnv({ env: { FD_CODE_ARTSIE_CLI: "/tmp/artsie-fixture" } }),
            ),
          ),
        ),
      ),
    ),
  );

it.effect("forwards argv as data and forces machine-readable output", () => {
  const calls: ProcessRunner.ProcessRunInput[] = [];
  const argv = ["photocraft", "doc_export", "--input", '{"path":"/Exports/a $(touch nope).png"}'];
  return runWith(
    (input) =>
      Effect.sync(() => {
        calls.push(input);
        return output('{"ok":true,"data":{"saved":true}}');
      }),
    argv,
  ).pipe(
    Effect.map((result) => {
      expect(result).toEqual({ exitCode: 0, result: { ok: true, data: { saved: true } } });
      expect(calls[0]).toMatchObject({
        command: "/tmp/artsie-fixture",
        args: [...argv, "--format", "json", "--full-output"],
        stdin: "",
      });
    }),
  );
});
it.effect("refuses CLI configuration and server modes before spawning", () =>
  Effect.gen(function* () {
    let calls = 0;
    const run = () =>
      Effect.sync(() => {
        calls++;
        return output("{}");
      });
    for (const argv of [
      ["mcp", "add"],
      ["skills", "add"],
      ["apps", "--mcp=true"],
      ["apps", "--update"],
      ["apps", "--format=yaml"],
      ["catalog", "remove"],
    ]) {
      const failure = yield* Effect.flip(runWith(run, argv));
      expect(failure).toMatchObject({ reason: "invalid-command" });
    }
    expect(calls).toBe(0);
  }),
);
it.effect("retains nonzero native exit codes and their structured error", () =>
  runWith(
    () => Effect.succeed(output('{"ok":false,"error":{"message":"Missing input"}}', 1)),
    ["call", "photocraft", "doc_open"],
  ).pipe(
    Effect.map((result) =>
      expect(result).toEqual({
        exitCode: 1,
        result: { ok: false, error: { message: "Missing input" } },
      }),
    ),
  ),
);
it.effect("refuses malformed output instead of reporting command success", () =>
  runWith(() => Effect.succeed(output("not JSON")), ["apps"]).pipe(
    Effect.flip,
    Effect.map((error) => expect(error).toMatchObject({ reason: "invalid-output" })),
  ),
);
