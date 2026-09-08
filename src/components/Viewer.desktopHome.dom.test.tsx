import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { applyBoardMutations, type BoardMutationV1 } from "@/lib/board/mutations";
import type { FileEntry } from "@/lib/types";
import type { BoardProjectStateV1 } from "@/lib/view/types";

/*
 * The desktop's DEFAULT (spec 2026-09-08) and the one thing that default broke.
 *
 * 1. With no stored preference, a wide window opens on the HQ home — console
 *    column plus HQ room — not on the board.
 * 2. A conversation deep link still opens the conversation. The hash intent is
 *    only ever resolved inside `shell`, and the HQ home returns before `shell`
 *    renders, so `#f=` on a home tab used to land on the console and stay
 *    there: the link was dead for as long as the home was the home.
 *
 * The bootstrap is `Viewer.orchestratorDock.dom.test.tsx`'s, deliberately
 * WITHOUT its `llvDesktopHome=board` line — the default is the subject here.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dom = new Window({ url: "http://localhost/" });
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  location: dom.location,
  history: dom.history,
  localStorage: dom.localStorage,
  sessionStorage: dom.sessionStorage,
  Node: dom.Node,
  HTMLElement: dom.HTMLElement,
  Element: dom.Element,
  Event: dom.Event,
  CustomEvent: dom.CustomEvent,
  KeyboardEvent: dom.KeyboardEvent,
  MouseEvent: dom.MouseEvent,
  MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } },
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
});

/* Desktop: `useIsMobile` reads this, and the home is a desktop surface. */
const matchMedia = (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
});
Object.assign(globalThis, { matchMedia });
Object.assign(dom, { matchMedia });

/* happy-dom has no Web Animations API; useFlip animates board children. */
(dom.HTMLElement.prototype as unknown as { animate: () => unknown }).animate = () => ({
  finished: Promise.resolve(),
  cancel() {},
  finish() {},
  addEventListener() {},
  removeEventListener() {},
});

mock.module("@/hooks/runtimeBus", () => ({
  SNAPSHOT_URL: "/api/runtime/snapshot",
  STREAM_URL: "/api/runtime/stream",
  STREAM_RECONNECTED_EVENT: "llv:stream-reconnected",
  isRuntimeUiEnabled: () => false,
  getRuntimeBus: () => ({
    getState: () => ({ connection: "offline" }),
    subscribe: () => () => {},
    subscribeFilesRevision: () => () => {},
  }),
}));

const { Viewer } = await import("./Viewer");
const { resetFilesClientCacheForTests } = await import("@/hooks/useFiles");

const TARGET_PATH = "/sessions/deep-link-target.jsonl";
const TARGET_PROJECT = "deep-link-project";

function fileEntry(overrides: Partial<FileEntry>): FileEntry {
  return {
    path: "/sessions/a.jsonl",
    root: "claude-projects",
    name: "a.jsonl",
    project: "other-project",
    title: "Session",
    engine: "claude",
    kind: "session",
    fmt: "claude",
    parent: null,
    mtime: 1_000,
    size: 1,
    activity: "idle",
    proc: null,
    pid: null,
    model: null,
    pendingQuestion: null,
    waitingInput: null,
    ...overrides,
  } as FileEntry;
}

const otherRow = fileEntry({ path: "/sessions/other.jsonl", title: "Other" });
const targetRow = fileEntry({
  path: TARGET_PATH,
  name: "deep-link-target.jsonl",
  project: TARGET_PROJECT,
  title: "The deep-linked conversation",
});

const originalFetch = globalThis.fetch;
let boards: Record<string, BoardProjectStateV1> = {};

const emptyBoard = (): BoardProjectStateV1 => ({
  schemaVersion: 1,
  revision: 0,
  updatedAt: new Date(0).toISOString(),
  pathAliases: {},
  prefs: { manual: [], hidden: [], expanded: [], favorites: [], foldedEngineChildIds: [], expandedEngineTrayParentIds: [], viewMode: null, taskPanelOpen: false },
});

/** `/api/files` serves the transcript in every scope, pinned or not, so the
    deep link resolves the same way it does off a real capped feed. */
function stubFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/files")) {
      return Response.json({
        files: [otherRow, targetRow],
        projectCatalog: [{ project: TARGET_PROJECT, conversations: 1 }],
      });
    }
    /* A REAL in-memory board, as in `Viewer.deepLink.dom.test.tsx`: one that
       answers every write with the same revision never converges, and the
       focus request retries until the test times out. */
    if (url.startsWith("/api/board")) {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        const project = new URL(url, "http://localhost").searchParams.get("project") ?? "";
        return Response.json({ ok: true, board: boards[project] ?? emptyBoard() });
      }
      const body = JSON.parse(String(init?.body)) as { project: string; mutations?: BoardMutationV1[] };
      const current = boards[body.project] ?? emptyBoard();
      const reduced = applyBoardMutations(current, body.mutations ?? []);
      const next = { ...reduced, schemaVersion: 1 as const, revision: current.revision + 1, updatedAt: new Date(0).toISOString(), pathAliases: reduced.pathAliases ?? {} };
      boards[body.project] = next;
      return Response.json({ ok: true, applied: true, board: next });
    }
    if (url.startsWith("/api/orchestrator")) return Response.json({ seat: null, pending: null, exists: false });
    if (url.startsWith("/api/firms")) return Response.json({ firms: [] });
    if (url.startsWith("/api/projects")) return Response.json({ projects: [] });
    if (url.startsWith("/api/archive")) return Response.json({ cards: [], total: 0 });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

let mounted: { unmount: () => void } | null = null;

beforeEach(() => {
  resetFilesClientCacheForTests();
  dom.localStorage.clear();
  dom.sessionStorage.clear();
  dom.location.hash = "";
  dom.document.body.replaceChildren();
  boards = {};
  stubFetch();
});

afterEach(() => {
  if (mounted) {
    const root = mounted;
    mounted = null;
    act(() => root.unmount());
  }
  globalThis.fetch = originalFetch;
  dom.document.body.replaceChildren();
  dom.location.hash = "";
});

async function mountViewer(): Promise<HTMLElement> {
  const host = dom.document.createElement("div");
  dom.document.body.append(host);
  const root = createRoot(host as unknown as HTMLElement);
  mounted = root;
  await act(async () => { root.render(<Viewer />); });
  await act(async () => { await Bun.sleep(60); });
  return host as unknown as HTMLElement;
}

/** Level-triggered settling, as in `Viewer.deepLink.dom.test.tsx`. */
async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await act(async () => { await Bun.sleep(40); });
  }
  return check();
}

test("with nothing stored, a wide window opens on the HQ home, not on the board", async () => {
  const host = await mountViewer();
  expect(host.querySelector("[data-desktop-console]")).not.toBeNull();
  expect(host.querySelector("[data-desktop-hq]")).not.toBeNull();
});

test("a conversation deep link still opens the conversation — the home hands the board back", async () => {
  const host = await mountViewer();
  expect(host.querySelector("[data-desktop-console]")).not.toBeNull();

  await act(async () => {
    dom.location.hash = `#f=${encodeURIComponent(TARGET_PATH)}`;
    dom.dispatchEvent(new dom.Event("hashchange"));
  });

  /* The board shell renders and the focused card materialises. */
  expect(await waitFor(() => host.querySelector(`[data-scheme-node="${TARGET_PATH}"]`) !== null)).toBe(true);
  expect(host.querySelector("[data-desktop-console]")).toBeNull();
  expect(host.querySelector("[data-desktop-hq]")).toBeNull();
  expect(dom.localStorage.getItem("llvProject")).toBe(TARGET_PROJECT);
  expect(host.querySelector("[data-stale-focus-notice]")).toBeNull();
  /* Session-only: following a link is not the operator choosing the board. */
  expect(dom.localStorage.getItem("llvDesktopHome")).toBeNull();
}, 20_000);
