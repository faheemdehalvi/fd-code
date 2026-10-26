// @effect-diagnostics nodeBuiltinImport:off -- Resolves the Brain path synchronously at layer construction, as BrainMemory and GraphContext do.
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HostProcess from "@fdcode/shared/HostProcess";

/**
 * Where the shared, cross-app Brain lives. Only the running server opts into
 * Faheem's real `~/.faheems-brain` (see `layerShared`, provided by server.ts). Any
 * other composition, such as a test building the orchestration runtime, keeps its
 * Brain beside its own database so it never writes into the live Brain.
 */
export const BrainDirectory = Context.Reference<string | undefined>(
  "fd-code/brain/BrainDirectory",
  {
    defaultValue: () => undefined,
  },
);

/** `FDCODE_BRAIN_DIR` points a scratch or staging server at its own Brain. */
export const layerShared = Layer.effect(
  BrainDirectory,
  Effect.gen(function* () {
    const override = (yield* HostProcess.Environment).FDCODE_BRAIN_DIR?.trim();
    return override
      ? NodePath.resolve(override)
      : NodePath.join(yield* HostProcess.HomeDirectory, ".faheems-brain");
  }),
);

/** The Brain directory for a server whose database is at `dbPath`. */
export const resolve = (dbPath: string) =>
  Effect.gen(function* () {
    return (yield* BrainDirectory) ?? NodePath.join(NodePath.dirname(dbPath), "brain");
  });
