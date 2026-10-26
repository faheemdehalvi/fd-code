import { OrchestratorMcpFailure } from "@fdcode/contracts";
import * as Effect from "effect/Effect";
import * as BetaArtsie from "../../../beta/Artsie.ts";
import * as ArtsieCli from "../../../beta/ArtsieCli.ts";
import type { ArtsieAgentAction } from "../../../beta/ArtsieClient.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { assertFullAccess, loadCaller } from "../../threadAccess.ts";
import { ArtsieToolkit } from "./tools.ts";

// Same gate as the Brain toolkit: a provider session FD CODE started for a thread.
const artsieCaller = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.requireMcpCapability("orchestration").pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "ARTsie tools require the orchestration capability.",
        }),
    ),
  );
  return yield* McpInvocationContext.requireThreadScope(scope, "ARTsie");
});

const hub = (action: ArtsieAgentAction, args: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    yield* artsieCaller;
    const artsie = yield* BetaArtsie.BetaArtsie;
    const response = yield* artsie.request(action, args);
    if (!response.ok) {
      return yield* new OrchestratorMcpFailure({
        code: "orchestration_error",
        message: `ARTsie ${action}: ${response.error.message}`,
      });
    }
    return response;
  });

const fullAccessRequired =
  "This ARTsie action starts or controls apps on the host, so it needs a live full-access/default calling thread.";

// writesWithCapability refuses read-only clients and callers without a live run;
// the full-access check keeps supervised threads from driving host apps.
const hostAction = <P extends Readonly<Record<string, unknown>>>(action: ArtsieAgentAction) =>
  McpToolAccess.writesWithCapability((input: P) =>
    Effect.gen(function* () {
      yield* artsieCaller;
      yield* assertFullAccess(yield* loadCaller(), fullAccessRequired);
      return yield* hub(action, input);
    }),
  );

// Mirrors the panel's HTTP scopes: reading the workspace is a read, changing it a
// write, and starting editors, windows or native tool calls is an owner-level action.
const handlers = {
  t3_artsie_apps: McpToolAccess.readsAsCaller(() => hub("apps", {})),
  t3_artsie_files: McpToolAccess.readsAsCaller((input) => hub("files", input)),
  t3_artsie_mkdir: McpToolAccess.actsAsCaller((input) => hub("mkdir", input)),
  t3_artsie_copy: McpToolAccess.actsAsCaller((input) => hub("copy", input)),
  t3_artsie_rename: McpToolAccess.actsAsCaller((input) => hub("rename", input)),
  t3_artsie_launch: hostAction("launch"),
  t3_artsie_start_live: hostAction("start_live"),
  t3_artsie_tools: hostAction("tools"),
  t3_artsie_call: hostAction("call"),
  t3_artsie_cli: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      yield* artsieCaller;
      yield* assertFullAccess(yield* loadCaller(), fullAccessRequired);
      const cli = yield* ArtsieCli.ArtsieCli;
      const value = yield* cli
        .run(input.argv)
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message }),
          ),
        );
      return { ok: true as const, value };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof ArtsieToolkit.tools>;

export const layer = McpToolAccess.toLayer(ArtsieToolkit, handlers);
