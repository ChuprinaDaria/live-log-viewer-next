import { afterEach, expect, test } from "bun:test";
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

import { setLocale } from "@/lib/i18n";
import { ArchiveScreen } from "./ArchiveScreen";

/*
 * The archive screen (task 9): sessionmem's cards grouped machine → project.
 * Every card's transcript button is live — `/api/files` is a recency-capped
 * board budget, so gating it on that feed disabled it for nearly every
 * archived session that is right here on disk.
 */

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
afterEach(() => { globalThis.fetch = realFetch; asked = []; });

const flush = () => new Promise((r) => setTimeout(r, 0));

test("groups by machine and project, badges what can be resumed, and opens any transcript", async () => {
  setLocale("uk");
  serve({ cards: CARDS, total: CARDS.length });
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

  /* Nothing in the catalog was mocked, and both buttons are still live: the
     archive does not ask the board feed for permission to open a transcript. */
  const local = el.querySelector('[data-archive-transcript="s1"]') as HTMLButtonElement;
  const pulled = el.querySelector('[data-archive-transcript="s2"]') as HTMLButtonElement;
  expect(local.disabled).toBe(false);
  expect(pulled.disabled).toBe(false);

  act(() => { local.click(); });
  expect(dom.location.hash).toBe("#f=" + encodeURIComponent("/w/.claude/projects/-w-fleet/s1.jsonl"));
  act(() => { pulled.click(); });
  expect(dom.location.hash).toBe("#f=" + encodeURIComponent("/w/state/pulled/walter/p/s2.jsonl"));

  /* The whole archive fits, so nothing is claimed about what is not shown. */
  expect(el.querySelector("[data-archive-showing]")).toBeNull();
});

test("a capped page says how much of the archive it is showing", async () => {
  setLocale("uk");
  serve({ cards: CARDS, total: 317 });
  const el = mount(<ArchiveScreen host={null} />);
  await act(flush); await act(flush);
  const showing = el.querySelector("[data-archive-showing]");
  expect(showing).not.toBeNull();
  expect(showing!.textContent).toBe("показано 2 з 317");
});

test("a machine sessionmem could not name gets no heading instead of an empty one", async () => {
  setLocale("uk");
  serve({ cards: [{ ...CARDS[0]!, host: "" }], total: 1 });
  const el = mount(<ArchiveScreen host={null} />);
  await act(flush); await act(flush);
  const section = el.querySelector('[data-archive-host=""]');
  expect(section).not.toBeNull();
  expect(section!.querySelector("h2")).toBeNull();
  expect(el.querySelector('[data-archive-card="s1"]')).not.toBeNull();
});

test("an empty archive says so, and a project filter is asked for by name", async () => {
  setLocale("uk");
  serve({ cards: [], total: 0 });
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
