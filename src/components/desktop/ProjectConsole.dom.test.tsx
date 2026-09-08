import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
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
import { ProjectConsole } from "./ProjectConsole";

function entry(over: Partial<FileEntry>): FileEntry {
  return { path: "/x/a.jsonl", root: "claude-projects", name: "a.jsonl", project: "dir-1", title: "A", engine: "claude", kind: "session", fmt: "jsonl", parent: null, mtime: 100, size: 1, activity: "idle", proc: null, pid: null, model: null, pendingQuestion: null, ...over } as FileEntry;
}

const ORG = { firm: "noologic", firmName: "Noologic", project: "bot", projectName: "bot", via: "path" } as const;
const now = Math.floor(Date.now() / 1000);

const HQ = entry({ path: "/hq/t.jsonl", name: "t.jsonl", conversationId: "hq1", title: "HQ", activity: "live" });
const LIVE = entry({ path: "/pulled/walter/bot-live.jsonl", name: "bot-live.jsonl", title: "Жива сесія", org: ORG, activity: "live", model: "opus", mtime: now - 30 });
const OLD = entry({ path: "/pulled/walter/bot-old.jsonl", name: "bot-old.jsonl", title: "Стара сесія", org: ORG, activity: "idle", mtime: now - 90_000 });
const FILES = [HQ, LIVE, OLD];

const DETAIL = {
  id: "bot", name: "bot", firm: "noologic", path: "/w/bot", parent: null,
  grants: { mcp: [], skills: [] }, secrets: [], rules: 0,
  effective: {
    mcp: [{ item: "viewer", from: "project:bot" }, { item: "obsidian", from: "firm:noologic" }, { item: "qdrant", from: "project:parent" }],
    skills: [], rules: [],
    secrets: [{ secret: "tg_bot", from: "firm:noologic" }],
  },
};
const CODE = { project: "bot", hosts: [{ host: "walter", path: "/w/bot", exists: true, branch: "main", head: "abc1234", dirty: false, detail: "" }] };
const REGISTRY = {
  servers: [{ name: "viewer", type: "stdio", granted_to: ["project:bot"], fleet_env: [] }, { name: "obsidian", type: "http", granted_to: ["firm:noologic"], fleet_env: [] }, { name: "qdrant", type: "http", granted_to: [], fleet_env: [] }],
  skills: [{ id: "rag", name: "rag", description: "", granted_to: [] }],
  registry: "/x/registry.json",
};
const SECRETS = { generatedAt: null, accounts: [], clis: [], secrets: [{ name: "tg_bot", provider: "telegram", state: "alive" }, { name: "cohere_key", provider: "cohere", state: "alive" }] };

const realFetch = globalThis.fetch;
const posts: { url: string; body: Record<string, unknown> }[] = [];
const gets: string[] = [];
/** What `/api/tmux` answers, so a refused delivery can be exercised. */
let tmuxAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true } };

/** The archive answer for the next mount. The default is the route that is
    not there yet — 503 NOT_INSTALLED — which is the branch the first test
    asserts; a test that wants cards or another failure sets it. */
let archiveAnswer: { status: number; body: unknown } = { status: 503, body: { error: "NOT_INSTALLED" } };

function get(url: string): unknown {
  if (url.startsWith("/api/projects") && url.includes("code=1")) return CODE;
  if (url.startsWith("/api/projects?project=")) return DETAIL;
  if (url.startsWith("/api/projects")) return { projects: [{ id: "bot", name: "bot", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
  if (url.startsWith("/api/firms")) return { firms: [{ id: "noologic", name: "Noologic", projects: ["bot"], people: [], grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
  if (url.startsWith("/api/machines") && url.includes("accounts=1")) return { profiles: ["account-a"] };
  if (url.startsWith("/api/machines") && url.includes("sessions=1")) return { sessions: [] };
  if (url.startsWith("/api/machines")) return { hosts: [{ id: "walter", ssh: null, engines: ["claude", "codex"], is_local: true, status: { reachable: true, detail: "" } }] };
  if (url.startsWith("/api/mcp-registry")) return REGISTRY;
  if (url.startsWith("/api/secrets")) return SECRETS;
  if (url.startsWith("/api/orchestrator/hq")) return { seat: { conversationId: "hq1", path: "/hq/t.jsonl" }, pending: null, exists: true };
  return {};
}

const JSON_HEADERS = { "content-type": "application/json" };
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "POST") {
    posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (url === "/api/tmux") return new Response(JSON.stringify(tmuxAnswer.body), { status: tmuxAnswer.status, headers: JSON_HEADERS });
    return new Response(JSON.stringify(url.startsWith("/api/mcp-registry") ? REGISTRY : { ok: true }), { status: 200, headers: JSON_HEADERS });
  }
  gets.push(url);
  if (url.startsWith("/api/archive")) {
    return new Response(JSON.stringify(archiveAnswer.body), { status: archiveAnswer.status, headers: JSON_HEADERS });
  }
  return new Response(JSON.stringify(get(url)), { status: 200, headers: JSON_HEADERS });
}) as typeof fetch;
/* Re-installed per test: restoring the real fetch once and never putting the
   fake back left every test after the first talking to the host. */
beforeEach(() => { globalThis.fetch = fakeFetch; });
afterEach(() => { posts.length = 0; gets.length = 0; tmuxAnswer = { status: 200, body: { ok: true } }; archiveAnswer = { status: 503, body: { error: "NOT_INSTALLED" } }; });
afterAll(() => { globalThis.fetch = realFetch; });

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(times = 4) {
  for (let i = 0; i < times; i += 1) await act(flush);
}

function openAccordion(el: HTMLElement, name: string) {
  const summary = el.querySelector(`[data-console-accordion="${name}"] summary`) as HTMLElement;
  if (!summary) throw new Error(`accordion ${name} not found`);
  act(() => { summary.click(); });
}

test("project console: launch first, live sessions with «перенести», the rest in accordions", async () => {
  setLocale("uk");
  const opened: FileEntry[] = [];
  const el = mount(<ProjectConsole project="bot" files={FILES} onOpenFile={(file) => { opened.push(file); }} onOpenTranscript={() => {}} />);
  await settle();

  /* 1. the launch form is the first thing, open, with the project preselected */
  const launch = el.querySelector("[data-console-launch]") as HTMLElement;
  expect(launch).not.toBeNull();
  expect((launch.querySelector('[aria-label="Проєкт"]') as HTMLSelectElement).value).toBe("bot");

  /* 2. live sessions are rows; the old one is not among them */
  expect(el.querySelector('[data-console-agent="/pulled/walter/bot-old.jsonl"]')).toBeNull();
  const liveRow = el.querySelector('[data-console-agent="/pulled/walter/bot-live.jsonl"]') as HTMLButtonElement;
  expect(liveRow).not.toBeNull();
  expect(liveRow.textContent).toContain("walter");
  act(() => { liveRow.click(); });
  expect(opened.map((file) => file.path)).toEqual(["/pulled/walter/bot-live.jsonl"]);

  /* «перенести» re-renders the launch form in move mode, with the SOURCE read
     off the transcript's own path and the destination still unanswered — the
     form must not offer «walter → walter» as a move. */
  act(() => { (el.querySelector('[data-console-move="/pulled/walter/bot-live.jsonl"]') as HTMLButtonElement).click(); });
  await settle();
  const moveMode = Array.from(el.querySelectorAll("[data-machines-mode] button"))
    .find((button) => button.textContent?.trim() === "Перенести") as HTMLButtonElement;
  expect(moveMode.getAttribute("aria-pressed")).toBe("true");
  const pressed = (label: string) => Array.from(el.querySelectorAll(`[role="group"][aria-label="${label}"] button`))
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent?.trim());
  expect(pressed("Зараз працює на")).toEqual(["walter"]);
  expect(pressed("Машина")).toEqual([]);

  /* 3. the archive accordion asks the route; sessionmem is not installed here */
  openAccordion(el, "old");
  await settle();
  expect(gets.some((url) => url.startsWith("/api/archive?project=bot"))).toBe(true);
  expect(el.querySelector('[data-console-accordion="old"]')?.textContent).toContain("Архів ще не підключено.");

  /* 4. code on machines */
  openAccordion(el, "code");
  await settle();
  expect(gets.some((url) => url.includes("project=bot") && url.includes("code=1"))).toBe(true);
  expect(el.querySelector('[data-console-accordion="code"]')?.textContent).toContain("main @ abc1234");

  /* 5. own grants carry a revoke, inherited ones do not */
  openAccordion(el, "mcp");
  await settle();
  const mcp = el.querySelector('[data-console-accordion="mcp"]') as HTMLElement;
  const ownRow = mcp.querySelector('[data-console-row="mcp:viewer"]') as HTMLElement;
  const firmRow = mcp.querySelector('[data-console-row="mcp:obsidian"]') as HTMLElement;
  expect(ownRow.textContent).toContain("власний");
  expect(firmRow.textContent).toContain("від фірми");
  expect(firmRow.querySelector("[data-console-revoke]")).toBeNull();
  /* A parent PROJECT is not the firm: calling its grant «від фірми» sent the
     operator to the wrong place to drop it. */
  const parentRow = mcp.querySelector('[data-console-row="mcp:qdrant"]') as HTMLElement;
  expect(parentRow.textContent).toContain("від проєкту parent");
  expect(parentRow.textContent).not.toContain("від фірми");
  expect(parentRow.querySelector("[data-console-revoke]")).toBeNull();

  act(() => { (mcp.querySelector('[data-console-revoke="mcp:viewer"]') as HTMLButtonElement).click(); });
  await settle();
  expect(posts.filter((post) => post.url.startsWith("/api/mcp-registry")).map((post) => post.body))
    .toEqual([{ kind: "mcp", item: "viewer", target: "project:bot", revoke: true }]);

  /* 6. «Сказати HQ» writes one line into the seat's transcript */
  act(() => { (el.querySelector("[data-console-tell-hq]") as HTMLButtonElement).click(); });
  await settle();
  expect(posts.find((post) => post.url === "/api/tmux")?.body)
    .toEqual({ path: "/hq/t.jsonl", text: "Відкриваю проєкт noologic → bot (/w/bot)" });
});

test("switching project shuts the accordions: no machine's git state under another project's name", async () => {
  setLocale("uk");
  const el = mount(<ProjectConsole project="bot" files={FILES} onOpenFile={() => {}} onOpenTranscript={() => {}} />);
  await settle();

  openAccordion(el, "code");
  await settle();
  const code = () => el.querySelector('[data-console-accordion="code"]') as HTMLDetailsElement;
  expect(code().open).toBe(true);
  expect(code().textContent).toContain("main @ abc1234");

  /* The tree selects one project after another without ever passing through
     null, so the column is never unmounted between them. */
  act(() => { root!.render(<ProjectConsole project="money" files={FILES} onOpenFile={() => {}} onOpenTranscript={() => {}} />); });
  await settle();
  expect(code().open).toBe(false);
  expect(code().textContent).not.toContain("main @ abc1234");
});

test("«Сказати HQ» does not claim success when the delivery is refused", async () => {
  setLocale("uk");
  tmuxAnswer = { status: 503, body: { error: "HQ не тримає сеанс" } };
  const el = mount(<ProjectConsole project="bot" files={FILES} onOpenFile={() => {}} onOpenTranscript={() => {}} />);
  await settle();

  act(() => { (el.querySelector("[data-console-tell-hq]") as HTMLButtonElement).click(); });
  await settle();
  expect(posts.some((post) => post.url === "/api/tmux")).toBe(true);
  const console_ = el.querySelector("[data-project-console]") as HTMLElement;
  expect(console_.textContent).not.toContain("HQ отримав.");
  expect(el.querySelector("[data-console-tell-failure]")?.textContent).toBe("HQ не тримає сеанс");
});

test("«Сказати HQ» stays disabled until the project has been read", async () => {
  setLocale("uk");
  const el = mount(<ProjectConsole project="bot" files={FILES} onOpenFile={() => {}} onOpenTranscript={() => {}} />);
  expect((el.querySelector("[data-console-tell-hq]") as HTMLButtonElement).disabled).toBe(true);
  await settle();
  expect((el.querySelector("[data-console-tell-hq]") as HTMLButtonElement).disabled).toBe(false);
});

test("an archived card hands its transcript to the Viewer's own resolver", async () => {
  setLocale("uk");
  /* The board feed is capped, so an archived transcript is usually not in it.
     The button is live anyway and hands the path to the Viewer's resolver —
     NOT to `location.hash`, which fires nothing when the tab already sits on
     that exact fragment. */
  archiveAnswer = { status: 200, body: { total: 1, cards: [{
    sessionId: "s1", title: "Індексатор", host: "walter", endedAt: 1_700_000_000, resumable: false,
    transcriptPath: "/pulled/walter/bot-old.jsonl",
    summary: "Полагодили лічильник.", did: [], broke: [], decided: [], left: [],
  }] } };
  const opened: string[] = [];
  dom.location.hash = "";
  const el = mount(<ProjectConsole project="bot" files={FILES} onOpenFile={() => {}} onOpenTranscript={(path) => { opened.push(path); }} />);
  await settle();
  openAccordion(el, "old");
  await settle();

  const card = el.querySelector('[data-console-archive-card="s1"]') as HTMLElement;
  expect(card.textContent).toContain("Полагодили лічильник.");
  const transcript = el.querySelector('[data-console-transcript="s1"]') as HTMLButtonElement;
  expect(transcript.disabled).toBe(false);
  act(() => { transcript.click(); });
  expect(opened).toEqual(["/pulled/walter/bot-old.jsonl"]);
  expect(dom.location.hash).toBe("");
});

test("the archive panel names the failure it got, and «ще не підключено» only for a missing sessionmem", async () => {
  setLocale("uk");
  archiveAnswer = { status: 500, body: { error: "sessionmem.db is locked" } };
  const el = mount(<ProjectConsole project="bot" files={FILES} onOpenFile={() => {}} onOpenTranscript={() => {}} />);
  await settle();
  openAccordion(el, "old");
  await settle();
  expect(el.querySelector("[data-console-archive-failure]")?.textContent?.trim()).toBe("sessionmem.db is locked");

  act(() => { root!.render(<ProjectConsole project="money" files={FILES} onOpenFile={() => {}} onOpenTranscript={() => {}} />); });
  archiveAnswer = { status: 503, body: { error: "NOT_INSTALLED" } };
  await settle();
  openAccordion(el, "old");
  await settle();
  expect(el.querySelector("[data-console-archive-failure]")?.textContent?.trim()).toBe("Архів ще не підключено.");
});
