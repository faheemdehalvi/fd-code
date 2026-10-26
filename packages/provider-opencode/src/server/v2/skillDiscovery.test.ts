import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeURL from "node:url";
import { FDCODE_ORCHESTRATION_INSTRUCTIONS } from "@fdcode/provider-core/server/orchestrationInstructions";
import { describe } from "vite-plus/test";

import { prepareSkillDiscovery, skillDiscoveryPlugin } from "./skillDiscovery.ts";

type Request = { sessionID: string; system: Array<{ text: string }>; messages: unknown[] };
type SearchTool = {
  execute: (
    input: { query: string },
    context: { sessionID: string },
  ) => Promise<{ content: string }>;
};

const harness = async () => {
  let contextHook: ((input: Request) => Promise<void>) | undefined;
  let searchTool: SearchTool | undefined;
  const skills = Array.from({ length: 113 }, (_, i) => ({
    id: `skill-${i}`,
    name: `Skill ${i}`,
    description: `Retrieval and graph research ${i}. ${"Long skill description. ".repeat(30)}`,
    content: `Original instructions ${i}`,
  }));
  const plugin: { default: { setup: (context: unknown) => Promise<void> } } = await import(
    `data:text/javascript;base64,${Buffer.from(skillDiscoveryPlugin).toString("base64")}`
  );
  await plugin.default.setup({
    location: { directory: "/qa" },
    skill: { list: async () => ({ data: skills }) },
    tool: {
      transform: async (edit: (editor: { add: (tool: SearchTool) => void }) => void) =>
        edit({
          add: (tool) => {
            searchTool = tool;
          },
        }),
    },
    session: {
      hook: async (_name: string, hook: typeof contextHook) => {
        contextHook = hook;
      },
    },
  });
  assert.isDefined(contextHook);
  assert.isDefined(searchTool);
  return { skills, contextHook: contextHook!, searchTool: searchTool! };
};

describe("OpenCode on-demand skills", () => {
  it("removes the large native catalog while preserving instructions, user history, and original skills", async () => {
    const h = await harness();
    const catalog = h.skills
      .map(
        (s) =>
          `<skill><id>${s.id}</id><name>${s.name}</name><description>${s.description}</description></skill>`,
      )
      .join("\n");
    const history = { role: "user", content: `<available_skills>${catalog}</available_skills>` };
    const owned = `Native wrapper\n<runtime_info>OpenCode</runtime_info>\n${FDCODE_ORCHESTRATION_INSTRUCTIONS.trim()}\nKeep this suffix.`;
    const systemUpdate = { role: "system", content: [{ type: "text", text: owned }] };
    const request = {
      sessionID: "qa",
      system: [
        {
          text: `Keep this guardrail.\n<available_skills>${catalog}</available_skills>\nKeep permissions.`,
        },
      ],
      messages: [history, systemUpdate],
    };
    assert.isAbove(request.system[0]!.text.length, 60_000);
    request.system.push({ text: owned });
    await h.contextHook(request);
    assert.isBelow(request.system[1]!.text.length, 3_500);
    assert.include(request.system[1]!.text, "request_secret");
    assert.include(request.system[1]!.text, "Respect human control");
    assert.isBelow(request.system[0]!.text.length, 500);
    assert.include(request.system[0]!.text, "Keep this guardrail.");
    assert.include(request.system[0]!.text, "Keep permissions.");
    assert.equal(request.messages[0], history);
    assert.isBelow(systemUpdate.content[0]!.text.length, 3_500);
    assert.equal(h.skills[0]!.content, "Original instructions 0");
    assert.isAbove(h.skills[0]!.description.length, 500);
    const result = JSON.parse(
      (await h.searchTool.execute({ query: "retrieval graph" }, { sessionID: "qa" })).content,
    );
    assert.lengthOf(result.matches, 5);
    assert.isAtMost(result.matches[0].description.length, 220);
  });

  it("keeps search restricted to the native permission-filtered catalog for each session", async () => {
    const h = await harness();
    await h.contextHook({
      sessionID: "allowed",
      system: [{ text: "<available_skills><skill><id>skill-2</id></skill></available_skills>" }],
      messages: [],
    });
    await h.contextHook({
      sessionID: "denied",
      system: [{ text: "No skills are currently available." }],
      messages: [],
    });
    const search = async (id: string) =>
      JSON.parse((await h.searchTool.execute({ query: "retrieval" }, { sessionID: id })).content)
        .matches;
    assert.deepEqual(
      (await search("allowed")).map((m: { id: string }) => m.id),
      ["skill-2"],
    );
    assert.deepEqual(await search("denied"), []);
    assert.deepEqual(await search("unknown"), []);
  });

  it.effect("adds the managed plugin without losing provider options or user plugins", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const env = yield* prepareSkillDiscovery({
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          plugins: ["existing-plugin"],
          providers: { custom: { name: "Custom" } },
        }),
        CUSTOM_SETTING: "preserved",
      });
      const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
      assert.equal(env.CUSTOM_SETTING, "preserved");
      assert.equal(config.plugins[0], "existing-plugin");
      assert.deepEqual(config.providers, { custom: { name: "Custom" } });
      const directory = NodeURL.fileURLToPath(config.plugins[1]);
      assert.include(yield* fs.readFileString(`${directory}/index.mjs`), "fd-code.skill-discovery");
      assert.equal(
        JSON.parse(yield* fs.readFileString(`${directory}/package.json`)).main,
        "./index.mjs",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
