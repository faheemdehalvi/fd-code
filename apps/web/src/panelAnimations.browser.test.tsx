import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { usePanelNavigationSuppression, usePanelPresence } from "./panelAnimations";

let root: Root;
let pendingFrames: FrameRequestCallback[] = [];
let observed: boolean[] = [];

function SuppressionProbe({ navigationKey }: { navigationKey: string }) {
  const suppressed = usePanelNavigationSuppression(navigationKey);
  useLayoutEffect(() => {
    observed.push(suppressed);
  }, [suppressed]);
  return null;
}

beforeEach(() => {
  pendingFrames = [];
  observed = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Frames are stepped by hand so each assertion lands between two paints.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    pendingFrames.push(callback);
    return pendingFrames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function paintPendingFrame() {
  const callback = pendingFrames.shift();
  await act(() => callback?.(0));
}

describe("usePanelNavigationSuppression", () => {
  it("suppresses initial and navigated panel state until each route has painted", async () => {
    await act(() => root.render(<SuppressionProbe navigationKey="/thread/one" />));
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);

    await act(() => root.render(<SuppressionProbe navigationKey="/thread/two" />));
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);
  });
});

describe("usePanelPresence", () => {
  it("settles when an open panel's value is rebuilt on every render", async () => {
    const surfaces = ["terminal"];
    const presented: (typeof surfaces | null)[] = [];
    function PresenceProbe({ open, scopeKey }: { open: boolean; scopeKey: string }) {
      // oxlint-disable-next-line fd-code/no-manual-memo -- The probe must rebuild its inputs on every render like an uncompiled caller; compiled, the cache hides the loop this test guards.
      "use no memo";
      // ChatView builds this wrapper fresh each render around stable store values.
      const presence = usePanelPresence(open, { surfaces }, true, scopeKey, 150);
      presented.push(presence.value?.surfaces ?? null);
      return null;
    }

    await act(() => root.render(<PresenceProbe open scopeKey="thread-a" />));
    const rendersBefore = presented.length;
    await act(() => root.render(<PresenceProbe open scopeKey="thread-a" />));
    expect(presented.length - rendersBefore).toBe(1);

    // Closing keeps the last open value for the exit animation.
    await act(() => root.render(<PresenceProbe open={false} scopeKey="thread-a" />));
    expect(presented.at(-1)).toBe(surfaces);
  });
});
