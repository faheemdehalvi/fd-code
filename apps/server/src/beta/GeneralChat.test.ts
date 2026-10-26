import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  MessageId,
  OrchestrationV2AppThread,
  OrchestrationV2DomainEvent,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type Project,
} from "@fdcode/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as GeneralChat from "./GeneralChat.ts";
import { Laya } from "./Laya.ts";
import * as Config from "../config.ts";
import * as Settings from "../serverSettings.ts";
import * as Projects from "../project/ProjectService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Events from "../orchestration-v2/EventSink.ts";
import * as Positions from "../orchestration-v2/TurnItemPositionStore.ts";
import {
  emptyProjection,
  applyToProjection,
  threadShellFromProjection,
} from "../orchestration-v2/ProjectionStore.ts";

const decodeThread = Schema.decodeUnknownSync(OrchestrationV2AppThread);
const decodeEvent = Schema.decodeUnknownSync(OrchestrationV2DomainEvent);
const sourceId = ThreadId.make("general-chat-test");
const targetId = ThreadId.make("target-chat");
const generalProject = ProjectId.make("general-chat-project");
const targetProject = ProjectId.make("target-project");
const request = {
  threadId: sourceId,
  messageId: MessageId.make("question-1"),
  text: "Fix the analysis cache",
};

const fixture = (
  mode: "match" | "uncertain" | "unavailable" | "busy" = "match",
  workspace: "current" | "legacy" | "foreign" = "current",
) =>
  Effect.gen(function* () {
    const originalConfig = yield* Config.ServerConfig;
    const path = yield* Path.Path;
    const config = { ...originalConfig, baseDir: path.join(originalConfig.baseDir, ".fd-code") };
    const at = DateTime.makeUnsafe("2026-10-21T00:00:00.000Z");
    const projection = (id: ThreadId, projectId: ProjectId, title: string) =>
      emptyProjection({
        type: "thread.created",
        id: EventId.make(`create:${id}`),
        threadId: id,
        occurredAt: at,
        payload: decodeThread({
          id,
          projectId,
          title,
          providerInstanceId: ProviderInstanceId.make("codex"),
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "destination-model",
          },
          runtimeMode: "approval-required",
          interactionMode: "plan",
          branch: null,
          worktreePath: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
          forkedFrom: null,
          activeProviderThreadId: null,
          createdBy: "user",
          creationSource: "web",
          createdAt: at,
          updatedAt: at,
          archivedAt: null,
          deletedAt: null,
        }),
      });
    const state = new Map<ThreadId, OrchestrationV2ThreadProjection>([
      [sourceId, projection(sourceId, generalProject, "General chat")],
      [targetId, projection(targetId, targetProject, "REA cache optimisation")],
    ]);
    let project: Project = {
      id: generalProject,
      title: "General",
      workspaceRoot: path.join(
        originalConfig.baseDir,
        workspace === "legacy" ? ".t3" : workspace === "foreign" ? "other" : ".fd-code",
        "general-chat",
      ),
      defaultModelSelection: null,
      scripts: [],
      createdAt: DateTime.formatIso(at),
      updatedAt: DateTime.formatIso(at),
      deletedAt: null,
    };
    const sent: Threads.ThreadManagementSendInput[] = [];
    const recorded: OrchestrationV2DomainEvent[] = [];
    const commands: unknown[] = [];
    const movedRoots: string[] = [];
    let choices = 0;
    let failNext = false;
    let busy = mode === "busy";
    const shell = (id: ThreadId): OrchestrationV2ThreadShell => ({
      ...threadShellFromProjection(state.get(id)!),
      ...(busy && id === targetId ? { activeRunId: RunId.make("running") } : {}),
    });
    const layer = Layer.mergeAll(
      Layer.mock(Projects.ProjectService)({
        getById: () => Effect.succeed(Option.some(project)),
        update: (input) =>
          Effect.sync(() => {
            if (input.workspaceRoot !== undefined) {
              movedRoots.push(input.workspaceRoot);
              project = { ...project, workspaceRoot: input.workspaceRoot };
            }
            return project;
          }),
        bootstrap: () => Effect.succeed({ project, created: false }),
        listShells: () =>
          Effect.succeed([
            {
              ...project,
              repositoryIdentity: null,
              faviconPath: null,
              projectIcon: null,
              defaultThreadEnvMode: null,
              autoPull: false,
            },
            {
              ...project,
              id: targetProject,
              title: "REA",
              repositoryIdentity: null,
              faviconPath: null,
              projectIcon: null,
              defaultThreadEnvMode: null,
              autoPull: false,
            },
          ]),
      }),
      Layer.mock(Threads.ThreadManagementService)({
        getThreadRecords: (id) => Effect.succeed(state.get(id)!),
        getShellSnapshot: () =>
          Effect.succeed({
            schemaVersion: 1,
            threads: [...state.keys()].map(shell),
            archivedThreads: [],
            snapshotSequence: 0,
          }),
        getThreadShell: (id) => Effect.succeed(state.has(id) ? shell(id) : null),
        hasReceipt: (id) => Effect.succeed(sent.some((s) => s.commandId === id)),
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: 0, storedEvents: [] };
          }),
        sendToThread: (input) =>
          Effect.gen(function* () {
            if (failNext) {
              failNext = false;
              return yield* new Threads.ThreadManagementThreadNotFoundError({
                projectId: input.projectId,
                threadId: input.threadId,
              });
            }
            if (!sent.some((s) => s.commandId === input.commandId)) sent.push(input);
            // GeneralChat consumes only successful completion from this external port.
            return {} as Threads.ThreadManagementSendResult;
          }),
      }),
      Layer.mock(Events.EventSinkV2)({
        write: ({ events }) =>
          Effect.sync(() => {
            for (const event of events) {
              const parsed = decodeEvent(event);
              recorded.push(parsed);
              state.set(event.threadId, applyToProjection(state.get(event.threadId)!, parsed));
            }
            return [];
          }),
      }),
      Layer.mock(Positions.TurnItemPositionStoreV2)({ allocate: () => Effect.succeed(100) }),
      Layer.succeed(Laya, {
        warm: Effect.void,
        choose: (_text, criteria) =>
          Effect.sync(() => {
            choices++;
            if (mode === "unavailable") return { ok: false as const, detail: "Unavailable" };
            const choice = Object.hasOwn(criteria, targetProject) ? targetProject : targetId;
            return { ok: true as const, choice, probability: mode === "uncertain" ? 0.4 : 0.95 };
          }),
      }),
      Settings.layerTest(),
    );
    const service = yield* GeneralChat.make.pipe(
      Effect.provide(layer),
      Effect.provideService(Config.ServerConfig, config),
    );
    return {
      service,
      sent,
      recorded,
      commands,
      state,
      movedRoots,
      workspaceRoot: path.join(config.baseDir, "general-chat"),
      choices: () => choices,
      fail: () => {
        failNext = true;
      },
      idle: () => {
        busy = false;
      },
    };
  });

const test = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(Config.layerTest(process.cwd(), { prefix: "general-chat-test-" })),
    Effect.provide(NodeServices.layer),
  );

it.effect(
  "routes a question, retains its source timeline and forwards once with destination settings",
  () =>
    test(
      Effect.gen(function* () {
        const f = yield* fixture();
        const first = yield* f.service.send(request);
        const again = yield* f.service.send(request);
        expect(first.threadId).toBe(targetId);
        expect(again.threadId).toBe(targetId);
        expect(f.sent).toHaveLength(1);
        expect(f.sent[0]).toMatchObject({ threadId: targetId, text: request.text, mode: "queue" });
        expect(f.sent[0]).not.toHaveProperty("modelSelection");
        expect(f.commands).toHaveLength(0);
        expect(f.recorded.map((e) => e.type)).toEqual(["message.updated", "turn-item.updated"]);
        expect(f.state.get(sourceId)?.messages[0]?.generalChatRoute?.targetThreadId).toBe(targetId);
        expect(f.choices()).toBe(2);
      }),
    ),
);

it.effect.each(["uncertain", "unavailable", "busy"] as const)(
  "keeps %s requests in General",
  (mode) =>
    test(
      Effect.gen(function* () {
        const f = yield* fixture(mode);
        expect((yield* f.service.send(request)).threadId).toBe(sourceId);
        expect(f.sent[0]?.threadId).toBe(sourceId);
        expect(f.recorded).toHaveLength(0);
      }),
    ),
);

it.effect("reuses the retained destination after a failed send and rejects a changed retry", () =>
  test(
    Effect.gen(function* () {
      const f = yield* fixture();
      f.fail();
      yield* Effect.flip(f.service.send(request));
      const choices = f.choices();
      expect((yield* f.service.send(request)).threadId).toBe(targetId);
      expect(f.choices()).toBe(choices);
      expect(f.sent).toHaveLength(1);
      expect((yield* Effect.flip(f.service.send({ ...request, text: "different" }))).reason).toBe(
        "changed_request",
      );
    }),
  ),
);

it.effect("rejects non-General source threads before consulting Laya", () =>
  test(
    Effect.gen(function* () {
      const f = yield* fixture();
      expect((yield* Effect.flip(f.service.send({ ...request, threadId: targetId }))).reason).toBe(
        "unavailable",
      );
      expect(f.choices()).toBe(0);
      expect(f.sent).toHaveLength(0);
    }),
  ),
);

it.effect("reopens the same General thread and restores its pin", () =>
  test(
    Effect.gen(function* () {
      const f = yield* fixture();
      expect((yield* f.service.open).threadId).toBe(sourceId);
      expect((yield* f.service.open).threadId).toBe(sourceId);
      expect(f.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "thread.pin", threadId: sourceId }),
        ]),
      );
    }),
  ),
);

it.effect("opens an explicitly named project and chat even when the model is unavailable", () =>
  test(
    Effect.gen(function* () {
      const f = yield* fixture("unavailable");
      const result = yield* f.service.send({
        ...request,
        text: "Open REA cache optimisation in REA",
      });
      expect(result.threadId).toBe(targetId);
      expect(f.choices()).toBe(0);
    }),
  ),
);

it.effect("honours General composer choices while leaving routed destination choices intact", () =>
  test(
    Effect.gen(function* () {
      const selected = {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "selected-general-model",
      };
      const fallback = yield* fixture("unavailable");
      yield* fallback.service.send({
        ...request,
        modelSelection: selected,
        runtimeMode: "auto-accept-edits",
        interactionMode: "default",
      });
      expect(fallback.sent[0]?.modelSelection).toEqual(selected);
      expect(fallback.commands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "thread.runtime-mode.set",
            runtimeMode: "auto-accept-edits",
          }),
        ]),
      );
      const routed = yield* fixture();
      yield* routed.service.send({
        ...request,
        modelSelection: selected,
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      expect(routed.sent[0]).not.toHaveProperty("modelSelection");
      expect(routed.commands).toHaveLength(0);
    }),
  ),
);

it.effect("repairs the renamed home before sending follow-ups without replacing the thread", () =>
  test(
    Effect.gen(function* () {
      const f = yield* fixture("unavailable", "legacy");
      const first = yield* f.service.send({ ...request, text: "Is Laya working?" });
      const second = yield* f.service.send({
        ...request,
        messageId: MessageId.make("question-2"),
        text: "What about now?",
      });
      expect(first.threadId).toBe(sourceId);
      expect(second.threadId).toBe(sourceId);
      expect(f.movedRoots).toEqual([f.workspaceRoot]);
      expect(f.sent).toHaveLength(2);
      expect(f.commands).toHaveLength(0);
    }),
  ),
);

it.effect("repairs the renamed home before reopening the existing General thread", () =>
  test(
    Effect.gen(function* () {
      const f = yield* fixture("unavailable", "legacy");
      expect((yield* f.service.open).threadId).toBe(sourceId);
      expect(f.movedRoots).toEqual([f.workspaceRoot]);
      expect((yield* f.service.send(request)).threadId).toBe(sourceId);
      expect(f.movedRoots).toHaveLength(1);
    }),
  ),
);

it.effect("does not relocate an unrelated General-looking workspace", () =>
  test(
    Effect.gen(function* () {
      const f = yield* fixture("unavailable", "foreign");
      expect((yield* Effect.flip(f.service.send(request))).reason).toBe("unavailable");
      expect(f.movedRoots).toHaveLength(0);
      expect(f.sent).toHaveLength(0);
      expect(f.choices()).toBe(0);
    }),
  ),
);
