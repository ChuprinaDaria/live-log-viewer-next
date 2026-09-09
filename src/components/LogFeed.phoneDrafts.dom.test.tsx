import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window as HappyWindow } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { MOBILE_LAYOUT_QUERY } from "@/lib/attention/eligibility";
import { setLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";
import { emptyStore } from "@/components/runtime/runtimeModel";

/*
 * UI round 2, lane A (docs/ui-round2-spec.md A1, A2): on the phone the reply
 * drafts are ONE band in the flow of the column, under the transcript scroller
 * and above the composer, whatever the magnet says — never a row floating over
 * the transcript, never a copy inside the scroller. And the way back to the
 * tail is a round control with its own opaque surface and a count badge, not a
 * text pill in the middle of a paragraph. The desktop keeps #1202's contract;
 * `LogFeed.suggestedReplies.dom.test.tsx` holds that one.
 */

let mobile = true;
const dom = new HappyWindow({ width: 390, height: 844 });
(dom as unknown as { matchMedia: (query: string) => unknown }).matchMedia = (query: string) => ({
  matches: mobile && String(query).replace(/\s+/g, "") === MOBILE_LAYOUT_QUERY.replace(/\s+/g, ""),
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.assign(globalThis, {
  ResizeObserver: TestResizeObserver,
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  Node: dom.Node,
  HTMLElement: dom.HTMLElement,
  HTMLButtonElement: dom.HTMLButtonElement,
  Event: dom.Event,
  CustomEvent: dom.CustomEvent,
  MouseEvent: dom.MouseEvent,
  PointerEvent: dom.PointerEvent,
  KeyboardEvent: dom.KeyboardEvent,
  WheelEvent: dom.WheelEvent,
  sessionStorage: dom.sessionStorage,
  localStorage: dom.localStorage,
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  IntersectionObserver: undefined,
});

/* One conversation per test: the feed remembers a released magnet per
   conversation across mounts, so a test that scrolled up would hand the next
   one a feed that starts scrolled up. */
const CONVERSATION_ID = "conversation_lane_a_phone";
const AT = (second: number) => `2026-09-09T07:26:${String(second).padStart(2, "0")}.000Z`;
const TRANSCRIPT = [
  { type: "user", uuid: "uuid-ask", timestamp: AT(0), message: { role: "user", content: [{ type: "text", text: "Що з дошкою на телефоні?" }] } },
  { type: "assistant", uuid: "uuid-answer", timestamp: AT(1), message: { role: "assistant", content: [{ type: "text", text: "Чіпи лежать поверх тексту. Запускати раунд 2?" }] } },
].map((line) => JSON.stringify(line));

const drafts = [
  { label: "Запускай раунд 2", text: "Запускай раунд 2." },
  { label: "Спершу покажи аудит", text: "Спершу покажи аудит." },
  { label: "Закоммить і запуш", text: "Закоммить і запуш." },
];

const previousFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(input);
  if (url.startsWith("/api/log/suggestions")) {
    const conversationId = decodeURIComponent(url.split("conversationId=")[1] ?? CONVERSATION_ID);
    /* A conversation with nothing offered: the band must still carry the way back. */
    if (conversationId.endsWith("_nodrafts")) return { ok: true, status: 200, json: async () => ({ set: null }) } as Response;
    return { ok: true, status: 200, json: async () => ({ set: { conversationId, setId: `rsg_${conversationId}`, at: AT(2), origin: { kind: "manager", conversationId, role: "orchestrator" }, replies: drafts } }) } as Response;
  }
  return { ok: false, status: 404, json: async () => ({}) } as Response;
}) as typeof fetch;

const tailState = { lines: TRANSCRIPT };
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
    lines: tailState.lines,
    linesStart: 0,
    size: tailState.lines.length,
    loading: false,
    error: null,
    tickTime: null,
    paused: false,
    setPaused: () => undefined,
    clear: () => undefined,
    hasMore: false,
    loadingOlder: false,
    loadOlder: async () => 0,
    prependGen: 0,
  }),
}));
mock.module("@/hooks/useToolActivityCues", () => ({ ...actualToolCues, useToolActivityCues: () => undefined }));

const { LogFeed } = await import("./LogFeed");

const roots = new Set<Root>();
beforeEach(() => {
  setLocale("en");
  mobile = true;
  dom.sessionStorage.clear();
});
afterEach(() => {
  for (const root of roots) flushSync(() => root.unmount());
  roots.clear();
  dom.document.body.replaceChildren();
  tailState.lines = TRANSCRIPT;
});
afterAll(() => {
  globalThis.fetch = previousFetch;
  mock.module("@/hooks/useRuntime", () => actualRuntimeHooks);
  mock.module("@/hooks/useLogTail", () => actualLogTail);
  mock.module("@/hooks/useToolActivityCues", () => actualToolCues);
});

const file = {
  path: "/fixtures/claude/projects/-repo/lane-a.jsonl",
  root: "claude-projects",
  name: "lane-a.jsonl",
  project: "repo",
  title: "HQ",
  engine: "claude",
  kind: "session",
  fmt: "claude",
  parent: null,
  mtime: Date.parse(AT(2)) / 1000,
  size: 1,
  activity: "live",
  proc: "running",
  pid: 7,
  model: null,
  pendingQuestion: null,
  waitingInput: null,
  conversationId: CONVERSATION_ID,
} as FileEntry;

/** The phone reads a conversation `bare` (BranchPane passes `bare={isMobile}`,
    the HQ room always); the desktop pane is the same feed without it. */
function conversationFile(suffix: string): FileEntry {
  return {
    ...file,
    path: `/fixtures/claude/projects/-repo/lane-a-${suffix}.jsonl`,
    name: `lane-a-${suffix}.jsonl`,
    conversationId: `${CONVERSATION_ID}_${suffix.replaceAll("-", "_")}`,
  };
}

function feedElement(feedFile: FileEntry, follow: boolean, bare: boolean) {
  return <LogFeed file={feedFile} showSvc={false} lineFilter="" onStatus={() => undefined} paused follow={follow} setFollow={() => undefined} compact bare={bare} />;
}

function render(feedFile: FileEntry, follow: boolean, bare = true): HTMLElement {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.add(root);
  flushSync(() => root.render(feedElement(feedFile, follow, bare)));
  return host as unknown as HTMLElement;
}

async function settle(host: HTMLElement, selector: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !host.querySelector(selector)) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function setScrollerGeometry(element: HTMLElement, height: number, viewport: number, initialTop: number) {
  let top = initialTop;
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, get: () => height },
    clientHeight: { configurable: true, get: () => viewport },
    scrollTop: {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = Math.max(0, Math.min(Number(value), height - viewport)); },
    },
  });
  return { setTop: (value: number) => { element.scrollTop = value; } };
}

/** The band is a sibling of the scroller in the column, after it. */
function expectBandUnderScroller(host: HTMLElement): void {
  const band = host.querySelector("[data-feed-drafts-band]")!;
  const scroller = host.querySelector("[data-log-feed-scroller]")!;
  expect(band).toBeTruthy();
  expect(scroller.contains(band)).toBe(false);
  expect(band.contains(scroller)).toBe(false);
  expect(scroller.compareDocumentPosition(band) & 4 /* DOCUMENT_POSITION_FOLLOWING */).toBeTruthy();
  expect(band.parentElement).toBe(scroller.parentElement!.parentElement);
  expect([...band.querySelectorAll("[data-reply-suggestion]")].map((chip) => chip.textContent)).toEqual(drafts.map((draft) => draft.label));
}

test("phone, magnet held: the drafts are one band under the scroller, not a row inside it", async () => {
  const host = render(conversationFile("held"), true);
  await settle(host, "[data-feed-drafts-band] [data-reply-suggestion]");
  expectBandUnderScroller(host);
  /* One offer, one place: nothing inside the scroller, nothing floating. */
  expect(host.querySelector("[data-log-feed-scroller] [data-reply-suggestions]")).toBeNull();
  expect(host.querySelectorAll('[data-reply-suggestions="floating"]')).toHaveLength(0);
  expect(host.querySelector("[data-feed-drafts-band] [data-mobile-chips]")).toBeTruthy();
});

test("phone, magnet released: the band stays where it was and nothing floats over the transcript", async () => {
  const host = render(conversationFile("released"), true);
  await settle(host, "[data-feed-drafts-band] [data-reply-suggestion]");
  const scroller = host.querySelector("[data-log-feed-scroller]") as HTMLElement;
  const geometry = setScrollerGeometry(scroller, 1_200, 200, 1_000);
  flushSync(() => {
    scroller.dispatchEvent(new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -200 }) as unknown as Event);
    geometry.setTop(600);
    scroller.dispatchEvent(new dom.Event("scroll", { bubbles: true }) as unknown as Event);
  });
  await settle(host, "[data-feed-jump-tail]");
  expect(host.querySelector("[data-feed-jump-tail]")).toBeTruthy();
  expectBandUnderScroller(host);
  expect(host.querySelectorAll('[data-reply-suggestions="floating"]')).toHaveLength(0);
  expect(host.querySelector("[data-log-feed-scroller] [data-reply-suggestions]")).toBeNull();
});

/** Release the magnet the way a thumb does, and wait for the way back. */
async function releaseMagnet(host: HTMLElement): Promise<HTMLButtonElement> {
  const scroller = host.querySelector("[data-log-feed-scroller]") as HTMLElement;
  const geometry = setScrollerGeometry(scroller, 1_200, 200, 1_000);
  flushSync(() => {
    scroller.dispatchEvent(new dom.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -200 }) as unknown as Event);
    geometry.setTop(600);
    scroller.dispatchEvent(new dom.Event("scroll", { bubbles: true }) as unknown as Event);
  });
  await settle(host, "[data-feed-jump-tail]");
  return host.querySelector("[data-feed-jump-tail]") as HTMLButtonElement;
}

/** The review's finding (round 2 lane A): a control positioned over the
    transcript hides text, opaque or not. The way back lives in the band —
    a flow sibling AFTER the scroller — and nothing about it is absolute. */
function expectJumpBesideTheDrafts(host: HTMLElement, jump: HTMLButtonElement): void {
  const band = host.querySelector("[data-feed-drafts-band]")!;
  const scroller = host.querySelector("[data-log-feed-scroller]")!;
  expect(band.contains(jump)).toBe(true);
  expect(scroller.contains(jump)).toBe(false);
  expect(scroller.compareDocumentPosition(jump) & 4 /* DOCUMENT_POSITION_FOLLOWING */).toBeTruthy();
  for (let el: Element | null = jump; el && el !== band.parentElement; el = el.parentElement) {
    expect(el.getAttribute("class") ?? "").not.toMatch(/(^|\s)(absolute|fixed)(\s|$)/);
  }
  /* Beside the drafts: the chips row, when there is one, comes first. */
  const row = band.querySelector("[data-mobile-chips]");
  if (row) expect(row.compareDocumentPosition(jump) & 4).toBeTruthy();
}

test("phone: the way back is a round 44px control in the band beside the drafts, with the count as a badge", async () => {
  const badgeFile = conversationFile("badge");
  const host = render(badgeFile, true);
  await settle(host, "[data-feed-drafts-band] [data-reply-suggestion]");
  const jump = await releaseMagnet(host);
  const classes = jump.getAttribute("class") ?? "";
  for (const token of ["h-11", "w-11", "rounded-full", "bg-raised", "shrink-0"]) expect(classes).toContain(token);
  expect(jump.getAttribute("aria-label")).toBe("Back to the live tail");
  /* No count yet: nothing arrived since the release. */
  expect(jump.querySelector("[data-feed-new-count]")).toBeNull();
  expectJumpBesideTheDrafts(host, jump);
  /* The drafts are still there, in the same band, before the control. */
  expect(host.querySelectorAll("[data-feed-drafts-band] [data-reply-suggestion]")).toHaveLength(drafts.length);

  /* Two answers arrive behind the operator: the badge carries the count. */
  const root = [...roots].at(-1)!;
  tailState.lines = [
    ...TRANSCRIPT,
    JSON.stringify({ type: "assistant", uuid: "uuid-more-1", timestamp: AT(3), message: { role: "assistant", content: [{ type: "text", text: "Ще одне." }] } }),
    JSON.stringify({ type: "assistant", uuid: "uuid-more-2", timestamp: AT(4), message: { role: "assistant", content: [{ type: "text", text: "І ще одне." }] } }),
  ];
  flushSync(() => root.render(feedElement(badgeFile, true, true)));
  const badge = host.querySelector("[data-feed-new-count]");
  expect(badge).toBeTruthy();
  expect(badge!.textContent).toBe("2");
  expect(jump.getAttribute("aria-label")).toBe("Back to the live tail · 2 new");
});

test("phone: with nothing offered, the band still carries the way back and nothing floats", async () => {
  const host = render(conversationFile("nodrafts"), true);
  await settle(host, "[data-log-feed-scroller] [data-feed-key]");
  /* Held: no drafts, so the band holds nothing. */
  expect(host.querySelectorAll("[data-feed-drafts-band] [data-reply-suggestion]")).toHaveLength(0);
  expect(host.querySelector("[data-feed-jump-tail]")).toBeNull();
  const jump = await releaseMagnet(host);
  expect(jump).toBeTruthy();
  expectJumpBesideTheDrafts(host, jump);
  expect(host.querySelectorAll('[data-reply-suggestions="floating"]')).toHaveLength(0);
});

test("desktop is untouched: the drafts sit under the latest turn inside the scroller, no band", async () => {
  mobile = false;
  const host = render(conversationFile("desktop"), true, false);
  await settle(host, '[data-reply-suggestions="inline"]');
  expect(host.querySelector("[data-feed-drafts-band]")).toBeNull();
  const inline = host.querySelector('[data-reply-suggestions="inline"]');
  expect({ scroller: Boolean(host.querySelector("[data-log-feed-scroller]")), rows: host.querySelectorAll("[data-feed-key]").length, inline: Boolean(inline) })
    .toEqual({ scroller: true, rows: 2, inline: true });
  expect(host.querySelector("[data-log-feed-scroller]")!.contains(inline!)).toBe(true);
  expect(host.querySelector("[data-feed-jump-tail]")).toBeNull();
});
