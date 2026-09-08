import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { emptyStore } from "@/components/runtime/runtimeModel";
import type { FileEntry } from "@/lib/types";

/*
 * The HQ room's SIGNATURE, on the real room component: the operator sets the
 * name and the picture from the panel behind the title, and the title itself
 * reads back what the server holds. Both writes go to the identity route as
 * JSON; the picture rides as base64 in the same body.
 */

const actualRuntimeHooks = await import("@/hooks/useRuntime");
const actualLogTail = await import("@/hooks/useLogTail");
const liveRuntime = { enabled: false, connection: "live" as const, resyncedAt: null, store: emptyStore() };
mock.module("@/hooks/useRuntime", () => ({
  ...actualRuntimeHooks,
  useRuntimeBusState: () => ({ ...liveRuntime, lastEventAt: null }),
  useRuntime: () => liveRuntime,
  useRuntimeSession: () => null,
  useRuntimeSessionByArtifact: () => null,
  useRuntimeReceiptsForArtifact: () => [],
  useRuntimeFlow: () => null,
}));
mock.module("@/hooks/useLogTail", () => ({
  useLogTail: () => ({
    lines: [], linesStart: 0, size: 0, loading: false, error: null, tickTime: null,
    paused: false, setPaused: () => undefined, clear: () => undefined,
    hasMore: false, loadingOlder: false, loadOlder: async () => 0, prependGen: 0,
  }),
}));

const dom = new Window({ url: "http://localhost/" });
const G = globalThis as Record<string, unknown>;

/** Every POST the room made, in order. */
const posts: { url: string; body: Record<string, unknown> }[] = [];
let identityAnswer: { name: string; avatarUrl: string | null } = { name: "Дітріх", avatarUrl: null };
/** Set by a test that wants the next identity POST refused. */
let refuseNextPost: { status: number; body: unknown } | null = null;

const OVERRIDES: Record<string, unknown> = {
  window: dom, document: dom.document, navigator: dom.navigator,
  Node: dom.Node, HTMLElement: dom.HTMLElement, HTMLButtonElement: dom.HTMLButtonElement,
  HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
  Event: dom.Event, CustomEvent: dom.CustomEvent, MouseEvent: dom.MouseEvent,
  KeyboardEvent: dom.KeyboardEvent,
  File: dom.File, FileReader: dom.FileReader, Blob: dom.Blob,
  sessionStorage: dom.sessionStorage, localStorage: dom.localStorage,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } },
  matchMedia: (q: string) => ({ matches: true, media: String(q), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }),
  requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      posts.push({ url, body });
      if (url.startsWith("/api/orchestrator/hq/identity")) {
        if (refuseNextPost) {
          const refusal = refuseNextPost;
          refuseNextPost = null;
          return { ok: false, status: refusal.status, json: async () => refusal.body, text: async () => JSON.stringify(refusal.body) };
        }
        if (typeof body.name === "string") identityAnswer = { ...identityAnswer, name: body.name };
        if (body.clearAvatar === true) identityAnswer = { ...identityAnswer, avatarUrl: null };
        if (body.avatar) identityAnswer = { ...identityAnswer, avatarUrl: "/api/orchestrator/hq/avatar?v=2" };
        return answer(identityAnswer);
      }
      return answer({});
    }
    if (url.startsWith("/api/orchestrator/hq/identity")) return answer(identityAnswer);
    if (url.startsWith("/api/orchestrator/hq")) return answer(hqAnswer);
    return answer({});
  }) as unknown as typeof fetch,
};
function answer(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
/** The seated HQ, as `GET /api/orchestrator/hq` reports it. A test that wants
    an empty fleet swaps this for a vacant seat. */
const SEATED = { seat: { conversationId: "conv-hq", path: "/w/hq.jsonl" }, pending: null, exists: true };
const VACANT = { seat: null, pending: null, exists: false };
let hqAnswer: unknown = SEATED;

const HAS: Record<string, boolean> = {};
const SAVED: Record<string, unknown> = {};
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0)); };

beforeAll(() => {
  for (const key of Object.keys(OVERRIDES)) { HAS[key] = key in G; SAVED[key] = G[key]; G[key] = OVERRIDES[key]; }
  (dom.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});
afterAll(async () => {
  await settle();
  for (const key of Object.keys(OVERRIDES)) { if (HAS[key]) G[key] = SAVED[key]; else delete G[key]; }
  mock.module("@/hooks/useRuntime", () => actualRuntimeHooks);
  mock.module("@/hooks/useLogTail", () => actualLogTail);
});

const { MobileHqRoom } = await import("./MobileHqRoom");
const { setLocale } = await import("@/lib/i18n");

let roots: Root[] = [];
beforeEach(() => {
  setLocale("uk");
  dom.document.body.replaceChildren();
  roots = [];
  posts.length = 0;
  hqAnswer = SEATED;
  refuseNextPost = null;
  identityAnswer = { name: "Дітріх", avatarUrl: null };
});
afterEach(async () => {
  for (const r of roots) flushSync(() => r.unmount());
  roots = [];
  await settle();
  dom.sessionStorage.clear();
});

const hqFile: FileEntry = {
  root: "claude-projects", name: "hq.jsonl", path: "/w/hq.jsonl", project: "fleet-hq", engine: "claude",
  kind: "session", fmt: "claude", parent: null, mtime: 1_000, size: 1, activity: "idle", proc: null,
  pid: null, conversationId: "conv-hq", title: "HQ", model: "Opus", effort: "medium",
  pendingQuestion: null, waitingInput: null,
} as unknown as FileEntry;

async function mount(): Promise<void> {
  const host = dom.document.createElement("div");
  dom.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  flushSync(() => root.render(<MobileHqRoom files={[hqFile]} host={null} />));
  await settle();
}

const q = (selector: string) => dom.document.querySelector(selector) as unknown as HTMLElement | null;
const identityPosts = () => posts.filter((post) => post.url.startsWith("/api/orchestrator/hq/identity"));

/* A controlled input is driven through its own React props, the way
   DirectoryPicker.dom.test.tsx does it: React tracks the element's last value,
   so a synthesised `input` event on a happy-dom node is swallowed as "no
   change" and never reaches the handler under test. */
type Handlers = { onChange: (event: unknown) => void; onKeyDown: (event: unknown) => void };
function handlers(el: Element): Handlers {
  const key = Object.keys(el).find((name) => name.startsWith("__reactProps$"))!;
  return (el as unknown as Record<string, Handlers>)[key]!;
}

async function openPanel(): Promise<void> {
  const title = q("[data-mobile2-hq-title]");
  expect(title).not.toBeNull();
  flushSync(() => { title!.dispatchEvent(new dom.MouseEvent("click", { bubbles: true }) as unknown as Event); });
  await settle();
}

test("the title reads the name the server holds", async () => {
  await mount();
  expect(q("[data-mobile2-hq-title]")!.textContent).toContain("Дітріх");
});

test("the title opens the signature panel", async () => {
  await mount();
  expect(q("[data-hq-identity]")).toBeNull();
  await openPanel();
  expect(q("[data-hq-identity]")).not.toBeNull();
});

test("a name typed and confirmed with Enter is POSTed on its own", async () => {
  await mount();
  await openPanel();
  const input = q("[data-hq-identity-name]") as unknown as HTMLInputElement;
  expect(input).not.toBeNull();
  flushSync(() => handlers(input as unknown as Element).onChange({ target: { value: "Гвардія" } }));
  /* Handlers are re-read: the re-render replaced the props object, and the
     stale one still closes over the empty draft. */
  flushSync(() => handlers(input as unknown as Element).onKeyDown({ key: "Enter", preventDefault: () => {} }));

  await settle();
  expect(identityPosts()).toEqual([{ url: "/api/orchestrator/hq/identity", body: { name: "Гвардія" } }]);
  expect(q("[data-mobile2-hq-title]")!.textContent).toContain("Гвардія");
});

/** One transparent pixel: a real GIF87a header, so nothing here is a lie about
    what the operator picked. */
const GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

test("a picked GIF is POSTed as base64 under its own mime", async () => {
  await mount();
  await openPanel();
  const picker = q("[data-hq-avatar-input]") as unknown as HTMLInputElement;
  expect(picker).not.toBeNull();
  expect(picker.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp,image/gif");
  const bytes = Uint8Array.from(atob(GIF_BASE64), (c) => c.charCodeAt(0));
  const file = new dom.File([bytes], "ava.gif", { type: "image/gif" });
  Object.defineProperty(picker, "files", { configurable: true, value: [file] });
  flushSync(() => { picker.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event); });
  await settle();
  expect(identityPosts()).toEqual([
    { url: "/api/orchestrator/hq/identity", body: { avatar: { mime: "image/gif", base64: GIF_BASE64 } } },
  ]);
  /* And the room now signs with it: the title shows the picture, not a letter. */
  expect(q("[data-mobile2-hq-title] img[data-hq-avatar]")?.getAttribute("src")).toBe("/api/orchestrator/hq/avatar?v=2");
});

test("the panel is reachable before any seat exists, so a name can be set first", async () => {
  /* The mandate takes the name when the seat is created. If the panel only
     opened over a live transcript, the first orchestrator would always be
     briefed with the default and there would be no way to change that. */
  hqAnswer = VACANT;
  await mount();
  expect(q("[data-mobile2-hq='vacant']")).not.toBeNull();
  await openPanel();
  const panel = q("[data-hq-identity]");
  expect(panel).not.toBeNull();
  /* No transcript, so no runtime facts to describe — only the signature. */
  expect(q("[data-mobile2-hq-runtime] dl")).toBeNull();

  const input = q("[data-hq-identity-name]") as unknown as HTMLInputElement;
  flushSync(() => handlers(input as unknown as Element).onChange({ target: { value: "Гвардія" } }));
  flushSync(() => handlers(input as unknown as Element).onKeyDown({ key: "Enter", preventDefault: () => {} }));
  await settle();
  expect(identityPosts()).toEqual([{ url: "/api/orchestrator/hq/identity", body: { name: "Гвардія" } }]);
});

test("a refused name stays in the field with the reason beside it", async () => {
  await mount();
  await openPanel();
  const input = q("[data-hq-identity-name]") as unknown as HTMLInputElement;
  refuseNextPost = { status: 400, body: { error: "name must be 1–40 characters", code: "name_invalid" } };
  flushSync(() => handlers(input as unknown as Element).onChange({ target: { value: "x".repeat(41) } }));
  flushSync(() => handlers(input as unknown as Element).onKeyDown({ key: "Enter", preventDefault: () => {} }));
  await settle();
  expect((q("[data-hq-identity-name]") as unknown as HTMLInputElement).value).toBe("x".repeat(41));
  expect(q("[data-hq-identity] [role='status']")?.textContent).toContain("Імʼя");
});
