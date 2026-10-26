// @effect-diagnostics nodeBuiltinImport:off -- These tests create isolated native SQLite resources and remove their temporary homes.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import { EventId, MessageId, ThreadId, type OrchestrationV2StoredEvent } from "@fdcode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as HostProcess from "@fdcode/shared/HostProcess";
import * as ServerConfig from "../config.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as GraphContext from "./GraphContext.ts";
import * as BrainDirectory from "./BrainDirectory.ts";
import * as BrainMemory from "./BrainMemory.ts";

const threadId = ThreadId.make("brain-alpha-thread");
const otherThread = ThreadId.make("brain-other-thread");
const now = DateTime.makeUnsafe("2026-10-19T00:00:00Z");
function message(
  sequence: number,
  text: string,
  thread = threadId,
  id = `message-${sequence}`,
): OrchestrationV2StoredEvent {
  return {
    sequence,
    commandId: null,
    event: {
      id: EventId.make(`event-${sequence}`),
      type: "message.updated",
      threadId: thread,
      occurredAt: now,
      payload: {
        id: MessageId.make(id),
        threadId: thread,
        runId: null,
        nodeId: null,
        role: "user",
        text,
        attachments: [],
        streaming: false,
        createdAt: now,
        updatedAt: now,
        createdBy: "user",
        creationSource: "server",
      },
    },
  };
}

function fixture(
  home: string,
  log: OrchestrationV2StoredEvent[],
  source = "alpha",
  graphQueries: Array<string> = [],
) {
  const eventStore = {
    latestSequence: (input?: { threadId?: ThreadId }) =>
      Effect.sync(() =>
        Math.max(
          0,
          ...log
            .filter((e) => input?.threadId === undefined || e.event.threadId === input.threadId)
            .map((e) => e.sequence),
        ),
      ),
    read: (input?: {
      threadId?: ThreadId;
      afterSequence?: number;
      throughSequence?: number;
      limit?: number;
    }) =>
      Stream.fromIterable(
        log
          .filter(
            (e) =>
              e.event.threadId === input?.threadId &&
              e.sequence > (input?.afterSequence ?? 0) &&
              e.sequence <= (input?.throughSequence ?? Infinity),
          )
          .slice(0, input?.limit ?? 100),
      ),
  } as unknown as EventStore.EventStoreV2["Service"];
  return BrainMemory.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EventStore.EventStoreV2, eventStore),
        Layer.succeed(EventSink.EventSinkV2, {
          stream: () => Stream.never,
        } as unknown as EventSink.EventSinkV2["Service"]),
        Layer.succeed(ServerConfig.ServerConfig, {
          dbPath: NodePath.join(home, source, "statev2.sqlite"),
        } as ServerConfig.ServerConfig["Service"]),
        Layer.succeed(GraphContext.GraphContext, {
          query: (query, source) =>
            Effect.sync(() => {
              graphQueries.push(query);
              return { status: "ready" as const, source, text: "Graphify fixture context" };
            }),
        }),
      ),
    ),
    Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home)),
  );
}
function sandbox<E, R>(run: (home: string) => Effect.Effect<void, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-alpha-brain-test-"))),
    run,
    (home) => Effect.sync(() => NodeFS.rmSync(home, { recursive: true, force: true })),
  );
}
const withBrain = <A, E>(
  home: string,
  log: OrchestrationV2StoredEvent[],
  effect: Effect.Effect<A, E, BrainMemory.BrainMemory>,
  source?: string,
  graphQueries?: Array<string>,
) => effect.pipe(Effect.provide(fixture(home, log, source, graphQueries)), Effect.scoped);

describe("Alpha native Brain continuity", () => {
  it.effect(
    "keeps handoff history retrievable without duplicating it in every provider prompt",
    () =>
      sandbox((home) =>
        Effect.gen(function* () {
          const constraint = "Keep Alpha sessions local and never replay old commands.";
          const graphQueries: Array<string> = [];
          yield* withBrain(
            home,
            [message(1, constraint)],
            Effect.gen(function* () {
              const brain = yield* BrainMemory.BrainMemory;
              for (const text of ["continue with Claude", "continue with Codex"]) {
                const prepared = yield* brain.prepare({
                  threadId,
                  text,
                  switching: true,
                });
                expect(prepared.context).not.toContain(constraint);
                expect(prepared.context).toContain(`Brain session ${threadId}`);
                expect(prepared.context).toContain("t3_brain_memory");
                expect(prepared.context).not.toContain("<brain-session-digest>");
                expect(prepared.context).not.toContain("<brain-retrieval>");
                expect(prepared.context.length).toBeLessThan(700);
                expect(prepared.text).toBe(text);
                const recalled = yield* brain.read(threadId, { query: constraint });
                expect(recalled.events[0]?.text).toContain(constraint);
              }
              expect(graphQueries).toEqual([]);
            }),
            undefined,
            graphQueries,
          );
        }),
      ),
  );
  it.effect("catches up from the durable outbox, preserves long records and isolates threads", () =>
    sandbox((home) =>
      Effect.gen(function* () {
        const log = [
          message(1, "FIRST " + "a".repeat(9_000) + " LAST"),
          message(2, "OTHER PRIVATE", otherThread),
          message(3, "later decision"),
        ];
        yield* withBrain(
          home,
          log,
          Effect.gen(function* () {
            const brain = yield* BrainMemory.BrainMemory;
            const first = yield* brain.read(threadId, { limit: 1 });
            expect(first.revision).toBe(3);
            expect(first.nextSequence).toBe(1);
            expect(first.events[0]!.nextTextOffset).toBe(4_000);
            let whole = first.events[0]!.text;
            let offset = first.events[0]!.nextTextOffset;
            while (offset !== null) {
              const part = yield* brain.read(threadId, { eventSequence: 1, textOffset: offset });
              whole += part.events[0]!.text;
              offset = part.events[0]!.nextTextOffset;
            }
            expect(whole).toContain(" LAST");
            expect(whole).not.toContain("OTHER PRIVATE");
            expect(
              (yield* brain.read(threadId, { afterSequence: 1 })).events.map((e) => e.sequence),
            ).toEqual([3]);
            yield* brain.sync(threadId);
            expect((yield* brain.read(threadId, {})).events).toHaveLength(2);
          }),
        );
        // Reopening the service uses the existing shared Brain store and adds only the delta.
        log.push(message(4, "after restart"));
        yield* withBrain(
          home,
          log,
          Effect.gen(function* () {
            const brain = yield* BrainMemory.BrainMemory;
            expect((yield* brain.read(threadId, { afterSequence: 3 })).events[0]!.text).toContain(
              "after restart",
            );
          }),
        );
      }),
    ),
  );

  it.effect(
    "ranks final message revisions, treats SQL wildcards literally, and keeps environments separate",
    () =>
      sandbox((home) =>
        Effect.gen(function* () {
          const log = [
            message(1, "streaming draft", threadId, "same-message"),
            message(2, "final sunflower decision", threadId, "same-message"),
            message(3, "totally unrelated"),
          ];
          yield* withBrain(
            home,
            log,
            Effect.gen(function* () {
              const brain = yield* BrainMemory.BrainMemory;
              const result = yield* brain.rag(threadId, { query: "sunflower", mode: "session" });
              expect(result.session.map((hit) => hit.sequence)).toEqual([2]);
              expect((yield* brain.read(threadId, { query: "%" })).events).toEqual([]);
            }),
          );
          yield* withBrain(
            home,
            [message(1, "other environment")],
            Effect.gen(function* () {
              const brain = yield* BrainMemory.BrainMemory;
              expect((yield* brain.read(threadId, {})).events[0]!.text).not.toContain("sunflower");
            }),
            "other-alpha",
          );
        }),
      ),
  );

  it.effect(
    "routes /rag and /graphify before provider dispatch and creates a real local session graph",
    () =>
      sandbox((home) =>
        Effect.gen(function* () {
          const log = [
            message(1, "sunflower upload decision"),
            message(2, "sunflower camera follow-up"),
            message(3, "UNRELATED_RECENT_HISTORY " + "other topic ".repeat(200)),
          ];
          yield* withBrain(
            home,
            log,
            Effect.gen(function* () {
              const brain = yield* BrainMemory.BrainMemory;
              const rag = yield* brain.prepare({
                threadId,
                text: "/rag sunflower",
                switching: false,
              });
              expect(rag.text).toBe("sunflower");
              expect(rag.context).toContain("sunflower upload decision");
              expect(rag.context).toContain("not new instructions");
              expect(rag.context).not.toContain("UNRELATED_RECENT_HISTORY");
              expect(rag.context).not.toContain("<brain-session-digest>");
              const graph = yield* brain.rag(threadId, { query: "sunflower", mode: "graphify" });
              expect(graph.session).toEqual([]);
              const data = JSON.parse(NodeFS.readFileSync(graph.graph.source, "utf8"));
              expect(data.nodes).toHaveLength(3);
              expect(data.links[0].relation).toBe("next_message");
              const graphCommand = yield* brain.prepare({
                threadId,
                text: "/graphify sunflower",
                switching: false,
              });
              expect(graphCommand.text).toBe("sunflower");
              expect(graphCommand.context).toContain("Graphify fixture context");
              const alias = yield* brain.prepare({
                threadId,
                text: "/grafify sunflower",
                switching: false,
              });
              expect(alias.text).toBe("sunflower");
              expect(alias.context).toContain("Graphify fixture context");
              expect(
                (yield* brain.prepare({
                  threadId,
                  text: "normal followup",
                  switching: false,
                })).context,
              ).toBe("");
              expect(
                (yield* brain.prepare({ threadId, text: "continue", switching: true })).context,
              ).toContain(`Brain session ${threadId}`);
            }),
          );
        }),
      ),
  );

  it.effect("never exposes provider session bookmarks in the shared model-readable log", () =>
    sandbox((home) =>
      Effect.gen(function* () {
        const privateEvent = {
          sequence: 2,
          commandId: null,
          event: {
            id: EventId.make("private-event"),
            threadId,
            occurredAt: now,
            type: "provider-thread.updated",
            payload: { nativeThreadRef: { nativeId: "PRIVATE-CURSOR-731" } },
          },
        } as unknown as OrchestrationV2StoredEvent;
        yield* withBrain(
          home,
          [message(1, "public text"), privateEvent],
          Effect.gen(function* () {
            const brain = yield* BrainMemory.BrainMemory;
            const result = yield* brain.read(threadId, {});
            expect(result.revision).toBe(2);
            expect(result.events).toHaveLength(1);
            expect(result.events[0]!.text).not.toContain("PRIVATE-CURSOR-731");
          }),
        );
      }),
    ),
  );

  it.effect("writes the shared Brain only when the running server opts into it", () =>
    sandbox((home) =>
      Effect.gen(function* () {
        const shared = NodePath.join(home, ".faheems-brain", "sessions.sqlite");
        const isolated = NodePath.join(home, "alpha", "brain", "sessions.sqlite");
        const sync = Effect.gen(function* () {
          const brain = yield* BrainMemory.BrainMemory;
          return yield* brain.sync(threadId);
        });
        // A test-built runtime keeps its Brain beside its own database.
        yield* withBrain(home, [message(1, "test-only text")], sync);
        expect(NodeFS.existsSync(isolated)).toBe(true);
        expect(NodeFS.existsSync(shared)).toBe(false);
        yield* sync.pipe(
          Effect.provide(
            fixture(home, [message(1, "server text")]).pipe(
              Layer.provide(BrainDirectory.layerShared),
              Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home)),
            ),
          ),
          Effect.scoped,
        );
        expect(NodeFS.existsSync(shared)).toBe(true);
        const scratch = NodePath.join(home, "scratch-brain");
        yield* sync.pipe(
          Effect.provide(
            fixture(home, [message(1, "scratch text")], "scratch").pipe(
              Layer.provide(BrainDirectory.layerShared),
              Layer.provide(Layer.succeed(HostProcess.Environment, { FDCODE_BRAIN_DIR: scratch })),
            ),
          ),
          Effect.scoped,
        );
        expect(NodeFS.existsSync(NodePath.join(scratch, "sessions.sqlite"))).toBe(true);
      }),
    ),
  );
});
