import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as FDCodeProjectFileLoader from "./FDCodeProjectFileLoader.ts";

const layerTest = Layer.empty.pipe(
  Layer.provideMerge(FDCodeProjectFileLoader.layer),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3code-project-file-",
  });
});

const writeProjectFile = Effect.fn("writeProjectFile")(function* (cwd: string, contents: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.writeFileString(path.join(cwd, "fd-code.json"), contents).pipe(Effect.orDie);
});

it.layer(layerTest)("FDCodeProjectFileLoader", (it) => {
  describe("load", () => {
    it.effect("loads and decodes a valid fd-code.json", () =>
      Effect.gen(function* () {
        const loader = yield* FDCodeProjectFileLoader.FDCodeProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(
          cwd,
          `{
            // JSONC is tolerated
            "iconPath": "assets/logo.svg",
            "scripts": [{ "name": "Dev", "command": "pnpm dev" }],
          }`,
        );

        const loaded = yield* loader.load(cwd);

        expect(Option.isSome(loaded)).toBe(true);
        if (Option.isSome(loaded)) {
          expect(loaded.value.iconPath).toBe("assets/logo.svg");
          expect(loaded.value.scripts).toEqual([{ name: "Dev", command: "pnpm dev" }]);
        }
      }),
    );

    it.effect("loads a legacy project file and gives fd-code.json precedence", () =>
      Effect.gen(function* () {
        const loader = yield* FDCodeProjectFileLoader.FDCodeProjectFileLoader;
        const cwd = yield* makeTempDir;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(
          path.join(cwd, "t3.json"),
          '{"scripts":[{"name":"Legacy","command":"echo legacy"}]}',
        );
        expect(Option.getOrThrow(yield* loader.load(cwd)).scripts?.[0]?.name).toBe("Legacy");
        yield* writeProjectFile(cwd, '{"scripts":[{"name":"Current","command":"echo current"}]}');
        expect(Option.getOrThrow(yield* loader.load(cwd)).scripts?.[0]?.name).toBe("Current");
        yield* writeProjectFile(cwd, "{invalid");
        expect(Option.isNone(yield* loader.load(cwd))).toBe(true);
      }),
    );

    it.effect("returns none when fd-code.json is missing", () =>
      Effect.gen(function* () {
        const loader = yield* FDCodeProjectFileLoader.FDCodeProjectFileLoader;
        const cwd = yield* makeTempDir;

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );

    it.effect("returns none for malformed JSON without failing", () =>
      Effect.gen(function* () {
        const loader = yield* FDCodeProjectFileLoader.FDCodeProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, "{ not json");

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );

    it.effect("returns none for schema-invalid files without failing", () =>
      Effect.gen(function* () {
        const loader = yield* FDCodeProjectFileLoader.FDCodeProjectFileLoader;
        const cwd = yield* makeTempDir;
        yield* writeProjectFile(cwd, '{ "scripts": [{ "name": "Dev" }] }');

        const loaded = yield* loader.load(cwd);

        expect(Option.isNone(loaded)).toBe(true);
      }),
    );
  });
});
