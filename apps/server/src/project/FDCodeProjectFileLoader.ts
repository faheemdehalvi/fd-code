import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  FDCODE_PROJECT_FILE_NAME,
  LEGACY_PROJECT_FILE_NAME,
  type FDCodeProjectFile,
} from "@fdcode/contracts";
import { FDCodeProjectFileFromJson } from "@fdcode/shared/fdCodeProjectFile";

const decodeFDCodeProjectFileJson = Schema.decodeEffect(FDCodeProjectFileFromJson);

export class FDCodeProjectFileLoadError extends Schema.TaggedError<FDCodeProjectFileLoadError>()(
  "FDCodeProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${FDCODE_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

export class FDCodeProjectFileLoader extends Context.Service<
  FDCodeProjectFileLoader,
  {
    /**
     * Never fails: missing, unreadable, or invalid files resolve to `Option.none` (invalid files
     * are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<FDCodeProjectFile>>;
  }
>()("fd-code/project/FDCodeProjectFileLoader") {}

const logFDCodeProjectFileLoadError = (error: FDCodeProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: FDCodeProjectFileLoader["Service"]["load"] = Effect.fn(
    "FDCodeProjectFileLoader.load",
  )(function* (workspaceRoot) {
    const currentPath = path.join(workspaceRoot, FDCODE_PROJECT_FILE_NAME);
    const filePath = (yield* fileSystem.exists(currentPath).pipe(Effect.orElseSucceed(() => true)))
      ? currentPath
      : path.join(workspaceRoot, LEGACY_PROJECT_FILE_NAME);
    const raw = yield* fileSystem.readFileString(filePath).pipe(
      Effect.asSome,
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : logFDCodeProjectFileLoadError(
                new FDCodeProjectFileLoadError({
                  operation: "read",
                  workspaceRoot,
                  filePath,
                  cause: error,
                }),
              ).pipe(Effect.as(Option.none<string>())),
      }),
    );
    if (Option.isNone(raw)) {
      return Option.none<FDCodeProjectFile>();
    }
    return yield* decodeFDCodeProjectFileJson(raw.value).pipe(
      Effect.asSome,
      Effect.catchTags({
        SchemaError: (error) =>
          logFDCodeProjectFileLoadError(
            new FDCodeProjectFileLoadError({
              operation: "decode",
              workspaceRoot,
              filePath,
              cause: error,
            }),
          ).pipe(Effect.as(Option.none<FDCodeProjectFile>())),
      }),
    );
  });

  return FDCodeProjectFileLoader.of({ load });
});

export const layer = Layer.effect(FDCodeProjectFileLoader, make);
