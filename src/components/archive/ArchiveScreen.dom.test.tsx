import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dom = new Window({ url: "http://localhost/" });
const matchMedia = (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
});
Object.assign(globalThis, {
  window: dom, document: dom.document, navigator: dom.navigator, location: dom.location, history: dom.history,
  localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
  Node: dom.Node, HTMLElement: dom.HTMLElement, Element: dom.Element, Event: dom.Event, CustomEvent: dom.CustomEvent,
  KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  matchMedia,
});
Object.assign(dom, { matchMedia });

let root: Root | null = null;
let container: HTMLElement | null = null;
function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
});

import type { FileEntry } from "@/lib/types";
import { setLocale } from "@/lib/i18n";

/*
 * The archive screen (task 9): sessionmem's cards grouped machine → project.
 * Only the local transcript can be opened here — a card pulled from another
 * machine says so instead of offering a button that would resolve to nothing.
 */

function entry(over: Partial<FileEntry>): FileEntry {
  return { path: "/w/.claude/projects/-w-fleet/s1.jsonl", root: "claude-projects", name: "s1.jsonl", project: "fleet", title: "A", engine: "claude", kind: "session", fmt: "jsonl", parent: null, mtime: 100, size: 1, activity: "idle", proc: null, pid: null, model: null, pendingQuestion: null, ...over } as FileEntry;
}

const actualUseFiles = await import("@/hooks/useFiles");
let mountedFiles: FileEntry[] = [];
mock.module("@/hooks/useFiles", () => ({ ...actualUseFiles, useFiles: () => ({ files: mountedFiles }) }));

const { ArchiveScreen } = await import("./ArchiveScreen");

const CARDS = [
  {
    sessionId: "s1", title: "Індексатор", project: "fleet", cwd: "/w/fleet", host: "ryzen", engine: "claude",
    endedAt: Math.round(Date.now() / 1000) - 3600, msgCount: 42, resumable: true,
    transcriptPath: "/w/.claude/projects/-w-fleet/s1.jsonl",
    summary: "Полагодили лічильник.", did: ["переписали SQL"], broke: [], decided: ["беремо sqlite"], left: [],
  },
  {
    sessionId: "s2", title: "Бот", project: "bot", cwd: "/w/bot", host: "walter", engine: "codex",
    endedAt: Math.round(Date.now() / 1000) - 7200, msgCount: 7, resumable: false,
    transcriptPath: "/w/state/pulled/walter/p/s2.jsonl",
    summary: "", did: [], broke: [], decided: [], left: [],
  },
];

const realFetch = globalThis.fetch;
let asked: string[] = [];
function serve(body: unknown, status = 200) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    if (!url.startsWith("/api/archive")) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
afterEach(() => { globalThis.fetch = realFetch; asked = []; mountedFiles = []; });

const flush = () => new Promise((r) => setTimeout(r, 0));

test("groups by machine and project, badges what can be resumed, opens the local transcript only", async () => {
  setLocale("uk");
  mountedFiles = [entry({})];
  serve({ cards: CARDS });
  const el = mount(<ArchiveScreen host={null} />);
  await act(flush); await act(flush);

  expect(asked.filter((url) => url.startsWith("/api/archive"))).toEqual(["/api/archive"]);
  expect(el.querySelector('[data-mobile2-screen="archive"]')).not.toBeNull();

  const hosts = [...el.querySelectorAll("[data-archive-host]")].map((node) => node.getAttribute("data-archive-host"));
  expect(hosts).toEqual(["ryzen", "walter"]);
  expect(el.querySelector('[data-archive-host="ryzen"] [data-archive-project="fleet"]')).not.toBeNull();
  expect(el.querySelector('[data-archive-host="walter"] [data-archive-project="bot"]')).not.toBeNull();

  const first = el.querySelector('[data-archive-card="s1"]') as HTMLDetailsElement;
  expect(first.textContent).toContain("Індексатор");
  expect(first.querySelector("[data-archive-resumable]")).not.toBeNull();
  expect((el.querySelector('[data-archive-card="s2"]') as HTMLElement).querySelector("[data-archive-resumable]")).toBeNull();

  expect(first.textContent).toContain("Полагодили лічильник.");
  expect(first.textContent).toContain("Зробили");
  expect(first.textContent).toContain("переписали SQL");
  expect(first.textContent).toContain("Вирішили");
  /* Empty lists are absent rather than drawn as empty headings. */
  expect(first.textContent).not.toContain("Зламалось");

  /* The card sessionmem never summarised says so, honestly. */
  expect((el.querySelector('[data-archive-card="s2"]') as HTMLElement).textContent).toContain("самарі ще не зроблено");

  const local = el.querySelector('[data-archive-transcript="s1"]') as HTMLButtonElement;
  expect(local.disabled).toBe(false);
  const elsewhere = el.querySelector('[data-archive-transcript="s2"]') as HTMLButtonElement;
  expect(elsewhere.disabled).toBe(true);
  expect(elsewhere.getAttribute("title")).toContain("транскрипт на іншій машині");

  act(() => { local.click(); });
  expect(dom.location.hash).toBe("#f=" + encodeURIComponent("/w/.claude/projects/-w-fleet/s1.jsonl"));
});

test("an empty archive says so, and a project filter is asked for by name", async () => {
  setLocale("uk");
  serve({ cards: [] });
  const el = mount(<ArchiveScreen host={null} project="bot" />);
  await act(flush); await act(flush);
  expect(asked.filter((url) => url.startsWith("/api/archive"))).toEqual(["/api/archive?project=bot"]);
  expect(el.textContent).toContain("Архів порожній.");
});

test("a reader that failed does not pretend the archive is empty", async () => {
  setLocale("uk");
  serve({ error: "NOT_INSTALLED" }, 503);
  const el = mount(<ArchiveScreen host={null} />);
  await act(flush); await act(flush);
  expect(el.textContent).toContain("Архів ще не підключено.");
  expect(el.textContent).not.toContain("Архів порожній.");
});
