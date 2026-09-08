import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { emptyStore } from "@/components/runtime/runtimeModel";
import { setLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

/*
 * Where the HQ room's signature lands in a transcript.
 *
 * One answer reaches the feed as several `prose` items, and a bare room shows
 * no per-turn header — so without a rule the name would be repeated over every
 * paragraph the engine happened to split. It belongs above the FIRST block of
 * each answer and nowhere else.
 */

const dom = new HappyWindow({ width: 390, height: 844 });
(dom as unknown as { matchMedia: (query: string) => unknown }).matchMedia = (query: string) => ({
  matches: true, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent: () => false,
});

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.assign(globalThis, {
  ResizeObserver: TestResizeObserver,
  window: dom, document: dom.document, navigator: dom.navigator,
  Node: dom.Node, HTMLElement: dom.HTMLElement, HTMLButtonElement: dom.HTMLButtonElement,
  Event: dom.Event, CustomEvent: dom.CustomEvent, MouseEvent: dom.MouseEvent,
  PointerEvent: dom.PointerEvent, KeyboardEvent: dom.KeyboardEvent, WheelEvent: dom.WheelEvent,
  sessionStorage: dom.sessionStorage, localStorage: dom.localStorage,
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IntersectionObserver: undefined,
});

const AT = (second: number) => `2026-09-02T10:00:${String(second).padStart(2, "0")}.000Z`;
/* Two assistant records with nothing operator-side between them: one answer as
   the feed sees it, two `prose` items. */
const TRANSCRIPT = [
  { type: "user", uuid: "u-ask", timestamp: AT(0), message: { role: "user", content: [{ type: "text", text: "Що по флоту?" }] } },
  { type: "assistant", uuid: "a-1", timestamp: AT(1), message: { role: "assistant", content: [{ type: "text", text: "Перший абзац відповіді." }] } },
  { type: "assistant", uuid: "a-2", timestamp: AT(2), message: { role: "assistant", content: [{ type: "text", text: "Другий абзац тієї самої відповіді." }] } },
].map((line) => JSON.stringify(line));

const previousFetch = globalThis.fetch;
globalThis.fetch = (async () => ({ ok: false, status: 404, json: async () => ({}) } as Response)) as unknown as typeof fetch;

const actualRuntimeHooks = await import("@/hooks/useRuntime");
const actualLogTail = await import("@/hooks/useLogTail");
const actualToolCues = await import("@/hooks/useToolActivityCues");
const inertRuntime = { enabled: true, connection: "live" as const, resyncedAt: null, store: emptyStore() };
mock.module("@/hooks/useRuntime", () => ({
  ...actualRuntimeHooks,
  useRuntimeBusState: () => ({ ...inertRuntime, lastEventAt: null }),
  useRuntime: () => inertRuntime,
  useRuntimeSession: () => null,
  useRuntimeSessionForConversation: () => null,
  useRuntimeReceiptsForArtifact: () => [],
  useRuntimeFlow: () => null,
}));
mock.module("@/hooks/useLogTail", () => ({
  ...actualLogTail,
  useLogTail: () => ({
    lines: TRANSCRIPT, linesStart: 0, size: TRANSCRIPT.length, loading: false, error: null,
    tickTime: null, paused: false, setPaused: () => undefined, clear: () => undefined,
    hasMore: false, loadingOlder: false, loadOlder: async () => 0, prependGen: 0,
  }),
}));
mock.module("@/hooks/useToolActivityCues", () => ({ ...actualToolCues, useToolActivityCues: () => undefined }));

const { LogFeed } = await import("./LogFeed");

const roots = new Set<Root>();
beforeEach(() => { setLocale("uk"); dom.sessionStorage.clear(); });
afterEach(() => {
  for (const root of roots) flushSync(() => root.unmount());
  roots.clear();
  dom.document.body.replaceChildren();
});
afterAll(() => {
  globalThis.fetch = previousFetch;
  setLocale("en");
  mock.module("@/hooks/useRuntime", () => actualRuntimeHooks);
  mock.module("@/hooks/useLogTail", () => actualLogTail);
  mock.module("@/hooks/useToolActivityCues", () => actualToolCues);
});

const file = {
  path: "/w/hq.jsonl", root: "claude-projects", name: "hq.jsonl", project: "fleet-hq",
  title: "HQ", engine: "claude", kind: "session", fmt: "claude", parent: null,
  mtime: Date.parse(AT(3)) / 1000, size: 1, activity: "idle", proc: null, pid: null,
  model: null, pendingQuestion: null, waitingInput: null, conversationId: "conv-hq",
} as unknown as FileEntry;

const signature = { name: "Дітріх", avatarUrl: null };

function render(props: { bare: boolean; signed: boolean }): HTMLElement {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.add(root);
  flushSync(() => root.render(
    <LogFeed
      file={file}
      showSvc={false}
      lineFilter=""
      onStatus={() => undefined}
      paused
      follow
      setFollow={() => undefined}
      compact
      bare={props.bare}
      signature={props.signed ? signature : undefined}
    />,
  ));
  return host as unknown as HTMLElement;
}

const rows = (host: HTMLElement) => [...host.querySelectorAll("[data-feed-signature]")];

test("one answer split into two blocks is signed exactly once", () => {
  const host = render({ bare: true, signed: true });
  expect(host.querySelectorAll('[data-feed-kind="prose"]').length).toBe(2);
  const signed = rows(host);
  expect(signed).toHaveLength(1);
  expect(signed[0]!.textContent).toContain("Дітріх");
});

test("a feed with no signature is never signed", () => {
  expect(rows(render({ bare: true, signed: false }))).toHaveLength(0);
});

test("a room that is not bare keeps its own turn headers and no signature", () => {
  expect(rows(render({ bare: false, signed: true }))).toHaveLength(0);
});
