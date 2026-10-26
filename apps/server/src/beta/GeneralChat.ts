import {
  CommandId,
  DEFAULT_MODEL,
  EventId,
  GENERAL_CHAT_THREAD_PREFIX,
  GeneralChatError,
  type GeneralChatSendInput,
  type GeneralChatSendResult,
  MessageId,
  type Project,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@fdcode/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Positions from "../orchestration-v2/TurnItemPositionStore.ts";
import * as Laya from "./Laya.ts";
import { namedDestination } from "./generalChatRouting.ts";

export class GeneralChat extends Context.Service<
  GeneralChat,
  {
    readonly open: Effect.Effect<{ readonly threadId: ThreadId }, GeneralChatError>;
    readonly send: (
      input: GeneralChatSendInput,
    ) => Effect.Effect<GeneralChatSendResult, GeneralChatError>;
  }
>()("fd-code/beta/GeneralChat") {}

export const make = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* Threads.ThreadManagementService;
  const events = yield* EventSink.EventSinkV2;
  const positions = yield* Positions.TurnItemPositionStoreV2;
  const settings = yield* ServerSettingsService;
  const laya = yield* Laya.Laya;
  const lock = yield* Semaphore.make(1);
  const workspaceRoot = path.join(config.baseDir, "general-chat");
  const projectId = ProjectId.make("general-chat-project");
  const legacyWorkspaceRoot =
    path.basename(config.baseDir) === ".fd-code"
      ? path.join(path.dirname(config.baseDir), ".t3", "general-chat")
      : null;
  const operationFailed = (cause: unknown) =>
    new GeneralChatError({ reason: "operation_failed", cause });
  // Moving the home directory does not rewrite the event-sourced project path.
  const repairWorkspace = (project: Project) =>
    project.id === projectId && project.workspaceRoot === legacyWorkspaceRoot
      ? projects.update({
          commandId: CommandId.make(`general-workspace:${workspaceRoot}`),
          projectId,
          workspaceRoot,
        })
      : Effect.succeed(project);
  const open = Effect.gen(function* () {
    yield* laya.warm;
    const previousProject = yield* projects.getById(projectId);
    if (Option.isSome(previousProject)) yield* repairWorkspace(previousProject.value);
    const project = yield* projects.bootstrap({
      commandId: CommandId.make("general-chat:project"),
      projectId,
      title: "General",
      workspaceRoot,
      createWorkspaceRootIfMissing: true,
    });
    const snapshot = yield* threads.getShellSnapshot();
    const archived = yield* threads.getShellSnapshot({ location: "archive" });
    const existing = [...snapshot.threads, ...archived.threads].find(
      (t) => t.projectId === project.project.id && t.id.startsWith(GENERAL_CHAT_THREAD_PREFIX),
    );
    const threadId =
      existing?.id ?? ThreadId.make(`${GENERAL_CHAT_THREAD_PREFIX}${yield* crypto.randomUUIDv4()}`);
    if (!existing) {
      const current = yield* settings.getSettings;
      yield* threads.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`general-create:${threadId}`),
        threadId,
        projectId: project.project.id,
        title: "General chat",
        modelSelection: current.defaultModelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
    } else if (existing.archivedAt !== null) {
      yield* threads.dispatch({
        type: "thread.unarchive",
        commandId: CommandId.make(`general-restore:${yield* crypto.randomUUIDv4()}`),
        threadId,
      });
    }
    if (!existing?.pinnedAt)
      yield* threads.dispatch({
        type: "thread.pin",
        commandId: CommandId.make(`general-pin:${yield* crypto.randomUUIDv4()}`),
        threadId,
      });
    return { threadId };
  }).pipe(lock.withPermits(1), Effect.mapError(operationFailed));

  const send = Effect.fn("GeneralChat.send")(function* (
    input: GeneralChatSendInput,
  ): Effect.fn.Return<GeneralChatSendResult, GeneralChatError> {
    const source = yield* threads
      .getThreadRecords(input.threadId, ["messages"], { messageIds: [input.messageId] })
      .pipe(Effect.mapError(operationFailed));
    const project = yield* projects
      .getById(source.thread.projectId)
      .pipe(Effect.mapError(operationFailed));
    if (
      !input.threadId.startsWith(GENERAL_CHAT_THREAD_PREFIX) ||
      Option.isNone(project) ||
      source.thread.archivedAt !== null ||
      source.thread.deletedAt !== null
    )
      return yield* new GeneralChatError({ reason: "unavailable" });
    const sourceProject = yield* repairWorkspace(project.value).pipe(
      Effect.mapError(operationFailed),
    );
    if (sourceProject.workspaceRoot !== workspaceRoot)
      return yield* new GeneralChatError({ reason: "unavailable" });
    const prior = source.messages.find((m) => m.id === input.messageId);
    if (prior && prior.text !== input.text)
      return yield* new GeneralChatError({ reason: "changed_request" });
    if (prior && !prior.generalChatRoute)
      return { threadId: input.threadId, routed: false, detail: "Sent in General chat." };
    let targetId = prior?.generalChatRoute?.targetThreadId ?? input.threadId;
    let targetTitle = prior?.generalChatRoute?.targetTitle ?? "General chat";
    let detail = "Answer in General chat.";
    const snapshot = yield* threads.getShellSnapshot().pipe(Effect.mapError(operationFailed));
    if (!prior && !input.text.startsWith("/")) {
      const candidates = snapshot.threads.filter(
        (t) =>
          t.id !== input.threadId &&
          !t.id.startsWith(GENERAL_CHAT_THREAD_PREFIX) &&
          t.archivedAt === null &&
          t.lineage.relationshipToParent !== "subagent",
      );
      const projectShells = yield* projects.listShells().pipe(Effect.mapError(operationFailed));
      const criteria: Record<string, string> = {
        general:
          "Ordinary conversation or a contextual follow-up without a clearly named project or subject",
        web: "Search the web or retrieve current public information without a specific project",
        none: "No clear matching project; stay in General chat",
      };
      for (const p of projectShells)
        if (candidates.some((t) => t.projectId === p.id)) criteria[p.id] = `Project ${p.title}`;
      const eligibleProjects = projectShells.filter((p) =>
        candidates.some((t) => t.projectId === p.id),
      );
      const namedProject = namedDestination(input.text, eligibleProjects);
      const first = namedProject
        ? { ok: true as const, choice: namedProject.id, probability: 1 }
        : yield* Laya.chooseLayaDestination(laya, input.text, criteria);
      if (!first.ok) detail = first.detail;
      else if (first.choice === "web") detail = "Use the available web tools and cite the results.";
      else if (first.probability >= 0.75 && !["none", "general"].includes(first.choice)) {
        const chats = candidates.filter((t) => t.projectId === first.choice);
        const choices: Record<string, string> = {
          none: "No clearly matching existing conversation; stay in General chat",
        };
        for (const chat of chats)
          choices[chat.id] = [
            chat.title.slice(0, 256),
            chat.latestVisibleMessage?.text.slice(0, 384),
          ]
            .filter(Boolean)
            .join(" · ");
        const namedChat = namedDestination(input.text, chats);
        const second = namedChat
          ? { ok: true as const, choice: namedChat.id, probability: 1 }
          : yield* Laya.chooseLayaDestination(laya, input.text, choices);
        if (second.ok && second.probability >= 0.75) {
          const chosen = chats.find((t) => t.id === second.choice);
          if (chosen) {
            targetId = chosen.id;
            targetTitle = chosen.title;
          }
        }
      }
    }
    const commandId = CommandId.make(`general-send:${input.messageId}`);
    const target = yield* threads.getThreadShell(targetId).pipe(Effect.mapError(operationFailed));
    if (!target || target.archivedAt !== null)
      return yield* new GeneralChatError({ reason: "unavailable" });
    const retry = yield* threads.hasReceipt(commandId);
    if (!retry && (target.activeRunId !== null || target.pendingRuntimeRequest !== null)) {
      if (prior) return yield* new GeneralChatError({ reason: "busy" });
      targetId = input.threadId;
      targetTitle = "General chat";
      detail = "The matching conversation is busy. Continue in General chat.";
    }
    const willRoute = targetId !== input.threadId;
    if (willRoute && !prior) {
      const at = yield* DateTime.now;
      const turnItemId = TurnItemId.make(`general-question:${input.messageId}`);
      const ordinal = yield* positions
        .allocate({ threadId: input.threadId, turnItemId, runId: null })
        .pipe(Effect.mapError(operationFailed));
      yield* events
        .write({
          events: [
            {
              type: "message.updated",
              id: EventId.make(`general-question:${input.messageId}`),
              threadId: input.threadId,
              occurredAt: at,
              payload: {
                id: input.messageId,
                threadId: input.threadId,
                runId: null,
                nodeId: null,
                role: "user",
                text: input.text,
                attachments: [],
                streaming: false,
                createdBy: "user",
                creationSource: "web",
                createdAt: at,
                updatedAt: at,
                generalChatRoute: { targetThreadId: targetId, targetTitle },
              },
            },
            {
              type: "turn-item.updated",
              id: EventId.make(`general-question-item:${input.messageId}`),
              threadId: input.threadId,
              occurredAt: at,
              payload: {
                type: "user_message",
                id: turnItemId,
                threadId: input.threadId,
                runId: null,
                nodeId: null,
                providerThreadId: null,
                providerTurnId: null,
                nativeItemRef: null,
                parentItemId: null,
                ordinal,
                status: "completed",
                title: `Matched ${targetTitle}`,
                startedAt: at,
                completedAt: at,
                updatedAt: at,
                messageId: input.messageId,
                inputIntent: "turn_start",
                text: input.text,
                attachments: [],
                createdBy: "user",
                creationSource: "web",
              },
            },
          ],
        })
        .pipe(Effect.mapError(operationFailed));
    }
    const destination = willRoute
      ? target
      : yield* threads.getThreadShell(input.threadId).pipe(Effect.mapError(operationFailed));
    if (!destination) return yield* new GeneralChatError({ reason: "unavailable" });
    if (
      !willRoute &&
      input.runtimeMode !== undefined &&
      input.runtimeMode !== source.thread.runtimeMode
    ) {
      yield* threads
        .dispatch({
          type: "thread.runtime-mode.set",
          commandId: CommandId.make(`general-runtime:${input.messageId}:${input.runtimeMode}`),
          threadId: input.threadId,
          runtimeMode: input.runtimeMode,
        })
        .pipe(Effect.mapError(operationFailed));
    }
    if (
      !willRoute &&
      input.interactionMode !== undefined &&
      input.interactionMode !== source.thread.interactionMode
    ) {
      yield* threads
        .dispatch({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make(
            `general-interaction:${input.messageId}:${input.interactionMode}`,
          ),
          threadId: input.threadId,
          interactionMode: input.interactionMode,
        })
        .pipe(Effect.mapError(operationFailed));
    }
    yield* threads
      .sendToThread({
        projectId: destination.projectId,
        commandId,
        threadId: targetId,
        messageId: willRoute
          ? MessageId.make(`general-forward:${input.messageId}`)
          : input.messageId,
        text: input.text,
        attachments: [],
        mode: "queue",
        createdBy: "user",
        creationSource: "web",
        ...(!willRoute && input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      })
      .pipe(Effect.mapError(operationFailed));
    return {
      threadId: targetId,
      routed: willRoute,
      detail: willRoute ? `Sent to ${targetTitle}` : detail,
    };
  }, lock.withPermits(1));
  return GeneralChat.of({ open, send });
});

export const layer = Layer.effect(GeneralChat, make).pipe(Layer.provide(Laya.Laya.layer));
