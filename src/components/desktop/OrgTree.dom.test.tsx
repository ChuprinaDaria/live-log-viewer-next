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
import { OrgTree } from "./OrgTree";

function entry(over: Partial<FileEntry>): FileEntry {
  return { path: "/x/a.jsonl", root: "claude-projects", name: "a.jsonl", project: "dir-1", title: "A", engine: "claude", kind: "session", fmt: "jsonl", parent: null, mtime: 100, size: 1, activity: "idle", proc: null, pid: null, model: null, pendingQuestion: null, ...over } as FileEntry;
}

const realFetch = globalThis.fetch;
function answer(url: string) {
  if (url.startsWith("/api/firms")) return { firms: [{ id: "noologic", name: "Noologic", projects: ["bot", "money"], people: [], grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
  if (url.startsWith("/api/projects")) return { projects: [
    { id: "bot", name: "bot", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
    { id: "money", name: "money", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
    { id: "eva", name: "eva-repro", firm: "noologic", parent: "bot", grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
  ] };
  return {};
}
globalThis.fetch = (async (input: RequestInfo | URL) =>
  new Response(JSON.stringify(answer(String(input))), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const flush = () => new Promise((r) => setTimeout(r, 0));

test("renders firms, projects, subfolders and the unassigned bucket", async () => {
  setLocale("uk");
  const files = [entry({ path: "/u1", project: "dir-old" }), entry({ path: "/u2", project: "dir-old" }), entry({ path: "/a", org: { firm: "noologic", firmName: "Noologic", project: "bot", projectName: "bot", via: "path" } })];
  const selected: string[] = [];
  const el = mount(<OrgTree files={files} selected="bot" onSelect={(p) => selected.push(p)} onOpenBoardProject={() => {}} />);
  await act(flush); await act(flush);
  expect(el.querySelector('[data-org-firm="noologic"]')?.textContent).toContain("Noologic");
  expect(el.querySelector('[data-org-project="bot"]')?.getAttribute("aria-current")).toBe("true");
  expect(el.querySelector('[data-org-project="eva"]')).not.toBeNull();
  const bucket = el.querySelector('[data-org-unassigned]') as HTMLButtonElement;
  expect(bucket.textContent).toContain("Без проєкту");
  expect(bucket.textContent).toContain("2");
  expect(el.querySelector('[data-org-unassigned-row]')).toBeNull();
  act(() => { bucket.click(); });
  expect(el.querySelector('[data-org-unassigned-row="dir-old"]')).not.toBeNull();
  act(() => { (el.querySelector('[data-org-project="money"]') as HTMLButtonElement).click(); });
  expect(selected).toEqual(["money"]);
});
