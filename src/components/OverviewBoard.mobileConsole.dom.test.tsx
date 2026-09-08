import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { FileEntry } from "@/lib/types";

import { setRuntimeUiEnabledForTests } from "@/hooks/runtimeBus";
import { MOBILE_LAYOUT_QUERY, mobileLayoutViewport } from "@/lib/attention/eligibility";

/*
 * «Десктоп версія зараз краща і зручніша за мою» — so the phone's «Сесії» tab
 * is the same console: the org tree, and under the chosen project the launch
 * form, the live sessions and the folded accordions. The card board is still
 * there, one row down the ⋯ menu, and the choice is remembered.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dom = new Window({ url: "http://localhost/" });
const viewportWidth = 390;
const matchMedia = (query: string) => ({
  matches: query === MOBILE_LAYOUT_QUERY && mobileLayoutViewport({ width: viewportWidth, height: 844 }),
  media: String(query),
  onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent() { return false; },
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

import { setLocale } from "@/lib/i18n";

import { getMobileNav } from "./mobile/mobileNav";
import { MOBILE_CONSOLE_PROJECT_KEY, writeMobileConsoleProject, writeMobileHome } from "./mobile/mobileHomeModel";
import { OverviewBoard } from "./OverviewBoard";

/* The phone shell reads the runtime bus for its banner slot; keep it inert. */
setRuntimeUiEnabledForTests(false);

const FIRMS = { firms: [{ id: "noologic", name: "Noologic", projects: ["bot", "money"], people: [], grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
const PROJECTS = {
  projects: [
    { id: "bot", name: "bot", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
    { id: "money", name: "money", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
  ],
};
const DETAIL = {
  id: "bot", name: "bot", firm: "noologic", path: "/w/bot", parent: null,
  grants: { mcp: [], skills: [] }, secrets: [], rules: 0,
  effective: { mcp: [], skills: [], rules: [], secrets: [] },
};

/* One sessionmem card, with a transcript that `/api/files` does NOT carry —
   the recency cap is exactly why the phone must not resolve the path against
   the feed before opening it. */
const ARCHIVED = {
  sessionId: "s-1", title: "Стара сесія", host: "walter", endedAt: 1_700_000_000,
  resumable: false, transcriptPath: "/w/pulled/walter/s-1.jsonl",
  summary: "", did: [], broke: [], decided: [], left: [],
};

const JSON_HEADERS = { "content-type": "application/json" };
function answer(url: string): unknown {
  if (url.startsWith("/api/projects?project=")) return DETAIL;
  if (url.startsWith("/api/projects")) return PROJECTS;
  if (url.startsWith("/api/firms")) return FIRMS;
  if (url === "/api/archive?count=1") return { count: 3 };
  if (url.startsWith("/api/archive")) return { cards: [ARCHIVED] };
  if (url.startsWith("/api/machines") && url.includes("accounts=1")) return { profiles: [] };
  if (url.startsWith("/api/machines") && url.includes("sessions=1")) return { sessions: [] };
  if (url.startsWith("/api/machines")) return { hosts: [{ id: "walter", ssh: null, engines: ["claude"], is_local: true, status: { reachable: true, detail: "" } }] };
  if (url.startsWith("/api/mcp-registry")) return { servers: [{ name: "viewer", type: "stdio", granted_to: [], fleet_env: [] }], skills: [], registry: "/w/registry.json" };
  if (url.startsWith("/api/secrets")) return { generatedAt: null, accounts: [], clis: [], secrets: [] };
  if (url.startsWith("/api/orchestrator/hq")) return { seat: null, pending: null, exists: false };
  return {};
}
const realFetch = globalThis.fetch;
const fakeFetch = (async (input: RequestInfo | URL) =>
  new Response(JSON.stringify(answer(String(input))), { status: 200, headers: JSON_HEADERS })) as typeof fetch;

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => {
  globalThis.fetch = fakeFetch;
  setLocale("uk");
  dom.localStorage.clear();
  dom.sessionStorage.clear();
  transcripts = [];
});
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  getMobileNav().home();
});
afterAll(() => { globalThis.fetch = realFetch; setRuntimeUiEnabledForTests(null); });

function file(over: Partial<FileEntry> = {}): FileEntry {
  return {
    path: "/sessions/a.jsonl", root: "claude-projects", name: "a.jsonl", project: "atlas", title: "Session",
    engine: "claude", kind: "session", fmt: "claude", parent: null, mtime: 1_000, size: 1,
    activity: "idle", proc: null, pid: null, model: null, pendingQuestion: null, ...over,
  } as FileEntry;
}

let transcripts: string[] = [];

function mount(extra: Partial<React.ComponentProps<typeof OverviewBoard>> = {}): HTMLElement {
  const node = dom.document.createElement("div");
  dom.document.body.appendChild(node);
  container = node as unknown as HTMLElement;
  root = createRoot(node as unknown as Element);
  act(() => {
    root!.render(
      <OverviewBoard
        files={[file()]}
        projectCatalog={[]}
        pipelines={[]}
        workflows={[]}
        archivedProjects={new Set()}
        now={2_000}
        onSelectProject={() => {}}
        onSelectFile={() => {}}
        onOpenTranscript={(path) => transcripts.push(path)}
        mobileShell={{ attentionCount: 0, arrival: null, renderSheet: () => null }}
        {...extra}
      />,
    );
  });
  return container;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(times = 5) { for (let i = 0; i < times; i += 1) await act(flush); }
const click = () => new dom.MouseEvent("click", { bubbles: true }) as unknown as Event;

test("the phone lands on the console: the org tree, not the card grid", async () => {
  const el = mount();
  await settle();
  expect(el.querySelector('[data-org-project="bot"]')).not.toBeNull();
  expect(el.querySelector('[data-org-project="money"]')).not.toBeNull();
  expect(el.querySelector('[data-testid="overview-card"]')).toBeNull();
  expect(el.querySelector("[data-mobile2-launch]")).toBeNull();
  /* Nothing chosen yet: the console below the tree waits for a project. */
  expect(el.querySelector("[data-project-console]")).toBeNull();
});

test("a tap on a project mounts its console with the launch form already on it", async () => {
  const el = mount();
  await settle();
  act(() => { (el.querySelector('[data-org-project="bot"]') as unknown as HTMLElement).dispatchEvent(click()); });
  await settle();

  const console_ = el.querySelector("[data-project-console]");
  expect(console_).not.toBeNull();
  const select = console_!.querySelector('select[aria-label="Проєкт"]') as unknown as HTMLSelectElement;
  expect(select).not.toBeNull();
  expect(select.value).toBe("bot");
  /* The phone gets 44px rows, not the desktop column's 32px ones. */
  expect(select.className).toContain("min-h-11");
  /* And the choice outlives a switch to another tab and back. */
  expect(dom.sessionStorage.getItem(MOBILE_CONSOLE_PROJECT_KEY)).toBe("bot");
});

test("a project remembered from earlier in the session opens with it", async () => {
  writeMobileConsoleProject("bot");
  const el = mount();
  await settle();
  expect(el.querySelector("[data-project-console]")).not.toBeNull();
});

test("«Дошка» brings the card board back, launch button and all", async () => {
  writeMobileHome("board");
  const el = mount();
  await settle();
  expect(el.querySelector("[data-mobile2-launch]")).not.toBeNull();
  expect(el.querySelector("[data-org-project]")).toBeNull();
  expect(el.querySelector('[data-testid="overview-card"]')).not.toBeNull();
});

test("the ⋯ menu carries the row that swaps the two, naming the other one", async () => {
  const el = mount();
  await settle();
  act(() => { (el.querySelector('[data-mobile2-open="menu"]') as unknown as HTMLElement).dispatchEvent(click()); });
  await settle();

  const row = dom.document.querySelector('[data-mobile2-menu-row="home-mode"]') as unknown as HTMLElement;
  expect(row).not.toBeNull();
  /* Standing on the console, the row offers the board. */
  expect(row.textContent).toContain("Дошка");
  act(() => { row.dispatchEvent(click()); });
  await settle();
  expect(el.querySelector('[data-testid="overview-card"]')).not.toBeNull();
  expect(el.querySelector("[data-org-project]")).toBeNull();
});

test("«повний транскрипт» goes to the Viewer's resolver, not through the capped feed", async () => {
  /* The archived transcript is not in `files` — `/api/files` is a recency-
     capped board budget — so a console that looked the path up there had a
     dead button. The path goes out as a path. */
  writeMobileConsoleProject("bot");
  const el = mount();
  await settle();
  act(() => { (el.querySelector('[data-console-accordion="old"] > summary') as unknown as HTMLElement).dispatchEvent(click()); });
  await settle();

  const button = el.querySelector('[data-console-transcript="s-1"]') as unknown as HTMLElement;
  expect(button).not.toBeNull();
  act(() => { button.dispatchEvent(click()); });
  expect(transcripts).toEqual(["/w/pulled/walter/s-1.jsonl"]);
});

test("the title cell is still the project switcher", async () => {
  const el = mount();
  await settle();
  const title = el.querySelector("[data-mobile2-title]") as unknown as HTMLElement;
  expect(title).not.toBeNull();
  expect(title.getAttribute("data-mobile2-open")).toBe("projects");
  expect(title.getAttribute("aria-label")).toBe("Змінити проєкт");
});

test("every row the finger lands on is 44px: the tree, the accordions, their chips and selects", async () => {
  writeMobileConsoleProject("bot");
  const el = mount();
  await settle();

  const row = el.querySelector('[data-org-project="bot"]') as unknown as HTMLElement;
  expect(row.className).toContain("min-h-11");
  expect(row.className).not.toContain("min-h-8");

  const summary = el.querySelector('[data-console-accordion="old"] > summary') as unknown as HTMLElement;
  expect(summary.className).toContain("min-h-11");

  act(() => { summary.dispatchEvent(click()); });
  await settle();
  const chip = el.querySelector('[data-console-transcript="s-1"]') as unknown as HTMLElement;
  expect(chip.className).toContain("min-h-11");
  const card = el.querySelector('[data-console-archive-card="s-1"] > summary') as unknown as HTMLElement;
  expect(card.className).toContain("min-h-11");

  /* The grant panels: a candidate the project has not been given yet is added
     through this select, and 28px is not a target on a phone. */
  act(() => { (el.querySelector('[data-console-accordion="mcp"] > summary') as unknown as HTMLElement).dispatchEvent(click()); });
  await settle();
  const add = el.querySelector('[data-console-add="mcp"]') as unknown as HTMLElement;
  expect(add).not.toBeNull();
  expect(add.className).toContain("min-h-11");
});

test("a project the org no longer has is forgotten rather than shown as an error", async () => {
  writeMobileConsoleProject("ghost");
  const el = mount();
  await settle();
  expect(el.querySelector("[data-project-console]")).toBeNull();
  expect(dom.sessionStorage.getItem(MOBILE_CONSOLE_PROJECT_KEY)).toBeNull();
});

test("a dead catalog is named on the console face too, not only on the board", async () => {
  /* The console does not draw cards, but it lists a project's live sessions
     out of the same `/api/files` payload — a surface that shows an unconfirmed
     feed as if it were the truth is the whole of issue #696. */
  const el = mount({ catalogFailures: 2 });
  await settle();
  expect(el.querySelector('[data-catalog-error="true"]')).not.toBeNull();
});
