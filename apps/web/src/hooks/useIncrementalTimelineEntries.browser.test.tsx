import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { TimelineEntriesProjection } from "../session-logic";
import { useIncrementalTimelineEntries } from "./useIncrementalTimelineEntries";

it("settles fresh equivalent containers and resets projection identity when switching threads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const observed: TimelineEntriesProjection["entries"][] = [];
  function Probe({ threadKey }: { threadKey: string }) {
    // oxlint-disable-next-line fd-code/no-manual-memo -- The probe must rebuild its inputs on every render like an uncompiled caller; compiled, the cache hides the loop this test guards.
    "use no memo";
    // Chat projections can allocate new empty containers on every render.
    const entries = useIncrementalTimelineEntries(threadKey, {
      visibleTurnItems: [],
      optimisticMessages: [],
      anchoredMessages: [],
      attachmentUrlById: new Map(),
      attempts: [],
      nodes: [],
      plans: [],
    });
    observed.push(entries);
    return <span>{entries.length}</span>;
  }
  try {
    await act(() => root.render(<Probe threadKey="general" />));
    const first = observed.at(-1);
    await act(() => root.render(<Probe threadKey="general" />));
    expect(observed.at(-1)).toBe(first);
    expect(observed.length).toBeLessThan(5);
    await act(() => root.render(<Probe threadKey="destination" />));
    expect(observed.at(-1)).not.toBe(first);
    expect(observed.at(-1)).toEqual([]);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
