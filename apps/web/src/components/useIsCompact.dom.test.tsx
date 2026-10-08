import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { COMPACT_BREAKPOINT_PX, COMPACT_QUERY, MOBILE_BREAKPOINT_PX, useIsCompact } from "./useIsMobile.js";

/**
 * The compact tier (#1969, docs/design-system.md §2.10) is 761–1099px inclusive. The hook is the one
 * definition components share, so its edges are tested through a real media-query evaluation (happy-dom
 * resolves `min-width`/`max-width` against the window size) rather than against a stub that answers
 * whatever it is told.
 */
const domWindow = new Window({ width: 1440, height: 900 });
const priorWindow = globalThis.window;
const priorDocument = globalThis.document;
const priorActEnvironment = (globalThis as unknown as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"];

before(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: domWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: domWindow.document });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
});

after(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: priorWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: priorDocument });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: priorActEnvironment });
});

function Probe() {
  return <output>{useIsCompact() ? "compact" : "not compact"}</output>;
}

test("useIsCompact() is true from 761px through 1099px and false at 760px and 1100px", async () => {
  assert.equal(COMPACT_QUERY, "(min-width: 761px) and (max-width: 1099px)");
  assert.equal(MOBILE_BREAKPOINT_PX, 760);
  assert.equal(COMPACT_BREAKPOINT_PX, 1100);

  const container = domWindow.document.createElement("div") as unknown as HTMLDivElement;
  domWindow.document.body.append(container as never);
  const root = createRoot(container);
  const readAt = async (width: number) => {
    // The hook re-reads on `resize` as well as on the query's change event.
    await act(async () => domWindow.happyDOM.setWindowSize({ width, height: 900 }));
    return container.textContent;
  };
  try {
    await act(async () => root.render(<Probe />));
    assert.equal(container.textContent, "not compact", "1440px is the wide tier");
    assert.equal(await readAt(760), "not compact", "760px is a phone");
    assert.equal(await readAt(761), "compact");
    assert.equal(await readAt(940), "compact", "the desktop app's minimum window");
    assert.equal(await readAt(1099), "compact");
    assert.equal(await readAt(1100), "not compact", "1100px is the desktop tier");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});


test("unrelated renders reuse a single media query and change listener", async () => {
  const originalMatchMedia = domWindow.matchMedia.bind(domWindow);
  let matches = 0;
  let added = 0;
  let removed = 0;
  const windowWithMatchMedia = domWindow as unknown as { matchMedia: typeof window.matchMedia };
  windowWithMatchMedia.matchMedia = (query: string) => {
    if (query !== COMPACT_QUERY) return originalMatchMedia(query);
    matches += 1;
    const mq = originalMatchMedia(query);
    const add = mq.addEventListener.bind(mq);
    const remove = mq.removeEventListener.bind(mq);
    mq.addEventListener = ((...args: Parameters<typeof mq.addEventListener>) => {
      if (args[0] === "change") added += 1;
      return add(...args);
    }) as typeof mq.addEventListener;
    mq.removeEventListener = ((...args: Parameters<typeof mq.removeEventListener>) => {
      if (args[0] === "change") removed += 1;
      return remove(...args);
    }) as typeof mq.removeEventListener;
    return mq;
  };

  const container = domWindow.document.createElement("div") as unknown as HTMLDivElement;
  domWindow.document.body.append(container as never);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Probe />));
    assert.equal(matches, 1, "matchMedia is called once per mounted query");
    assert.equal(added, 1);
    for (let i = 0; i < 5; i++) await act(async () => root.render(<Probe />));
    assert.equal(matches, 1, "unrelated renders do not recreate the MediaQueryList");
    assert.equal(added, 1, "unrelated renders do not re-subscribe");
    assert.equal(removed, 0);
    await act(async () => domWindow.happyDOM.setWindowSize({ width: 950, height: 900 }));
    assert.equal(container.textContent, "compact", "resize notifications still update the hook");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    windowWithMatchMedia.matchMedia = originalMatchMedia;
    await act(async () => domWindow.happyDOM.setWindowSize({ width: 1440, height: 900 }));
  }
  assert.equal(removed, 1, "the listener is removed on unmount");
});
