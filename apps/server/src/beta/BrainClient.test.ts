import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createBrainClient } from "./BrainClient.ts";

const TOKEN = "test-brain-secret";
const loadToken = async () => TOKEN;

function responding(result: unknown) {
  const handler: typeof globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { id: number };
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  };
  return vi.fn(handler);
}

afterEach(() => vi.useRealTimers());

describe("BrainClient", () => {
  it("checks authenticated loopback transport health without returning credentials", async () => {
    const fetch = responding({});
    const client = createBrainClient({ fetch, loadToken });
    const result = await client.health();
    expect(result).toEqual({ ok: true, value: { connected: true } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:8766/mcp");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it("preserves search evidence and caller filters", async () => {
    const evidence = JSON.stringify({
      results: [{ id: 41, collection: "Personal", snippet: "source text" }],
    });
    const fetch = responding({ content: [{ type: "text", text: evidence }], isError: false });
    const client = createBrainClient({ fetch, loadToken });
    expect(
      await client.callTool("brain_search", { query: "FD CODE", collection: "Personal", limit: 2 }),
    ).toEqual({
      ok: true,
      value: { content: [{ type: "text", text: evidence }], isError: false },
    });
    const request = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(request.params).toEqual({
      name: "brain_search",
      arguments: { query: "FD CODE", collection: "Personal", limit: 2 },
    });
  });

  it("rejects mutations and inbox delivery updates through the model-facing read interface", async () => {
    const fetch = responding({});
    const tokenLoader = vi.fn(loadToken);
    const client = createBrainClient({ fetch, loadToken: tokenLoader });
    for (const name of [
      "brain_bus_send",
      "brain_bus_decide",
      "brain_bus_reply",
      "brain_bus_inbox",
      "brain_add_note",
      "brain_index",
      "unknown",
    ]) {
      expect(await client.callTool(name)).toMatchObject({
        ok: false,
        error: { code: "not-allowed" },
      });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(tokenLoader).not.toHaveBeenCalled();
  });

  it("makes human bus actions available separately without auto approving a send", async () => {
    const fetch = responding({ content: [{ type: "text", text: '{"id":7,"status":"pending"}' }] });
    const client = createBrainClient({ fetch, loadToken });
    expect((await client.sendHumanMessage({ to: "claude", body: "Please inspect this" })).ok).toBe(
      true,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    expect(request.params).toEqual({
      name: "brain_bus_send",
      arguments: { to: "claude", body: "Please inspect this", sender: "t3-beta" },
    });
    await client.decideHumanMessage({ id: 7, agent: "codex", decision: "reject" });
    await client.replyHumanMessage({ id: 7, agent: "codex", text: "Declined by Faheem" });
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).params.name)).toEqual([
      "brain_bus_send",
      "brain_bus_decide",
      "brain_bus_reply",
    ]);
    await client.humanInbox({ agent: "codex" });
    expect(JSON.parse(String(fetch.mock.calls[3]![1]?.body)).params).toEqual({
      name: "brain_bus_inbox",
      arguments: { agent: "codex" },
    });
  });

  it("reloads credentials between requests so rotation does not require an IDE restart", async () => {
    const fetch = responding({});
    const tokenLoader = vi
      .fn()
      .mockResolvedValueOnce("first-token")
      .mockResolvedValueOnce("second-token");
    const client = createBrainClient({ fetch, loadToken: tokenLoader });
    await client.health();
    await client.health();
    expect(
      fetch.mock.calls.map(([, init]) => (init?.headers as Record<string, string>).Authorization),
    ).toEqual(["Bearer first-token", "Bearer second-token"]);
  });

  it("handles missing credentials without contacting Brain or exposing exception contents", async () => {
    const fetch = responding({});
    const client = createBrainClient({
      fetch,
      loadToken: async () => {
        throw new Error(TOKEN);
      },
    });
    const result = await client.health();
    expect(result).toMatchObject({ ok: false, error: { code: "credentials-unavailable" } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports disconnected and unauthorized states without leaking transport errors", async () => {
    const brokenFetch: typeof globalThis.fetch = async () => {
      throw new Error(TOKEN);
    };
    const disconnected = await createBrainClient({ fetch: brokenFetch, loadToken }).health();
    expect(disconnected).toMatchObject({ ok: false, error: { code: "disconnected" } });
    expect(JSON.stringify(disconnected)).not.toContain(TOKEN);
    const deniedFetch: typeof globalThis.fetch = async () => new Response(TOKEN, { status: 401 });
    const denied = await createBrainClient({ fetch: deniedFetch, loadToken }).health();
    expect(denied).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(JSON.stringify(denied)).not.toContain(TOKEN);
  });

  it("rejects malformed JSON, mismatched request IDs and malformed tool content", async () => {
    const malformed: typeof globalThis.fetch = async () => new Response("not-json");
    const wrongId: typeof globalThis.fetch = async () =>
      Response.json({ jsonrpc: "2.0", id: -1, result: {} });
    for (const fetch of [malformed, wrongId]) {
      expect(await createBrainClient({ fetch, loadToken }).health()).toMatchObject({
        ok: false,
        error: { code: "invalid-response" },
      });
    }
    for (const result of [
      { content: [{ type: "text", text: 1 }] },
      { content: "invalid" },
      { content: [], isError: "false" },
    ]) {
      expect(
        await createBrainClient({ fetch: responding(result), loadToken }).callTool("brain_status"),
      ).toMatchObject({
        ok: false,
        error: { code: "invalid-response" },
      });
    }
  });

  it("does not expose potentially sensitive tool errors", async () => {
    const fetch = responding({ content: [{ type: "text", text: TOKEN }], isError: true });
    const result = await createBrainClient({ fetch, loadToken }).callTool("brain_status");
    expect(result).toMatchObject({ ok: false, error: { code: "tool-error" } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("bounds streamed responses even without a content-length header", async () => {
    const cancel = vi.fn();
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(101));
          },
          cancel,
        }),
      );
    const result = await createBrainClient({ fetch, loadToken, maxResponseBytes: 100 }).health();
    expect(result).toMatchObject({ ok: false, error: { code: "response-too-large" } });
    expect(cancel).toHaveBeenCalled();
  });

  it("bounds a stalled transport and aborts the request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Promise(() => {}));
    const pending = createBrainClient({ fetch, loadToken, timeoutMs: 100 }).health();
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, error: { code: "timeout" } });
    expect(fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it("includes credential loading in the deadline and prevents a late outbound request", async () => {
    vi.useFakeTimers();
    let release: (token: string) => void = () => {};
    const tokenPromise = new Promise<string>((resolve) => {
      release = resolve;
    });
    const fetch = responding({});
    const pending = createBrainClient({
      fetch,
      loadToken: () => tokenPromise,
      timeoutMs: 100,
    }).health();
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: false, error: { code: "timeout" } });
    release(TOKEN);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
});
