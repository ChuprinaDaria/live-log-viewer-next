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
    mcp: [{ item: "viewer", from: "project:bot" }, { item: "obsidian", from: "firm:noologic" }],
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

function get(url: string): unknown {
  if (url.startsWith("/api/archive")) return null;
  if (url.startsWith("/api/projects") && url.includes("code=1")) return CODE;
  if (url.startsWith("/api/projects?project=")) return DETAIL;
  if (url.startsWith("/api/projects")) return { projects: [{ id: "bot", name: "bot", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
  if (url.startsWith("/api/firms")) return { firms: [{ id: "noologic", name: "Noologic", projects: ["bot"], people: [], grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
  if (url.startsWith("/api/machines") && url.includes("accounts=1")) return { profiles: ["daria"] };
  if (url.startsWith("/api/machines") && url.includes("sessions=1")) return { sessions: [] };
  if (url.startsWith("/api/machines")) return { hosts: [{ id: "walter", ssh: null, engines: ["claude", "codex"], is_local: true, status: { reachable: true, detail: "" } }] };
  if (url.startsWith("/api/mcp-registry")) return REGISTRY;
  if (url.startsWith("/api/secrets")) return SECRETS;
  if (url.startsWith("/api/orchestrator/hq")) return { seat: { conversationId: "hq1", path: "/hq/t.jsonl" }, pending: null, exists: true };
  return {};
}

const JSON_HEADERS = { "content-type": "application/json" };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "POST") {
    posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(url.startsWith("/api/mcp-registry") ? REGISTRY : { ok: true }), { status: 200, headers: JSON_HEADERS });
  }
  gets.push(url);
  const body = get(url);
  if (body === null) return new Response(JSON.stringify({ error: "no archive route yet" }), { status: 404, headers: JSON_HEADERS });
  return new Response(JSON.stringify(body), { status: 200, headers: JSON_HEADERS });
}) as typeof fetch;
afterEach(() => { globalThis.fetch = realFetch; posts.length = 0; gets.length = 0; });

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
  const el = mount(<ProjectConsole project="bot" files={FILES} onOpenFile={(file) => { opened.push(file); }} />);
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

  /* «перенести» re-renders the launch form in move mode on that machine */
  act(() => { (el.querySelector('[data-console-move="/pulled/walter/bot-live.jsonl"]') as HTMLButtonElement).click(); });
  await settle();
  const moveMode = Array.from(el.querySelectorAll("[data-machines-mode] button"))
    .find((button) => button.textContent?.trim() === "Перенести") as HTMLButtonElement;
  expect(moveMode.getAttribute("aria-pressed")).toBe("true");

  /* 3. the archive accordion asks the (not yet wired) archive route and says so */
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
