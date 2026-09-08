import { afterAll, afterEach, expect, test } from "bun:test";
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
import { OrgTree } from "./OrgTree";

const realFetch = globalThis.fetch;
let asked: string[] = [];
let countAnswer: { status: number; body: unknown } = { status: 200, body: { count: 317 } };
function answer(url: string) {
  if (url.startsWith("/api/firms")) return { firms: [{ id: "noologic", name: "Noologic", projects: ["bot", "money"], people: [], grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
  if (url.startsWith("/api/projects")) return { projects: [
    { id: "bot", name: "bot", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
    { id: "money", name: "money", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
    { id: "eva", name: "eva-repro", firm: "noologic", parent: "bot", grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
  ] };
  return {};
}
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  asked.push(url);
  if (url.startsWith("/api/archive")) {
    return new Response(JSON.stringify(countAnswer.body), { status: countAnswer.status, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify(answer(url)), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
afterEach(() => { asked = []; countAnswer = { status: 200, body: { count: 317 } }; });
afterAll(() => { globalThis.fetch = realFetch; });

const flush = () => new Promise((r) => setTimeout(r, 0));

test("renders firms, projects, subfolders and the one archive row", async () => {
  setLocale("uk");
  const selected: string[] = [];
  let archives = 0;
  const el = mount(<OrgTree selected="bot" onSelect={(p) => selected.push(p)} onOpenArchive={() => { archives += 1; }} />);
  await act(flush); await act(flush);
  expect(el.querySelector('[data-org-firm="noologic"]')?.textContent).toContain("Noologic");
  expect(el.querySelector('[data-org-project="bot"]')?.getAttribute("aria-current")).toBe("true");
  expect(el.querySelector('[data-org-project="eva"]')).not.toBeNull();

  /* The «Без проєкту» pile is gone: the sessions it held are summarised in
     the archive now, not listed as rows nobody reads. */
  expect(el.querySelector("[data-org-unassigned]")).toBeNull();
  expect(el.querySelector("[data-org-unassigned-row]")).toBeNull();

  const archive = el.querySelector("[data-org-archive]") as HTMLButtonElement;
  expect(archive.textContent).toContain("Архів сесій");
  expect(archive.textContent).toContain("317");
  act(() => { archive.click(); });
  expect(archives).toBe(1);

  act(() => { (el.querySelector('[data-org-project="money"]') as HTMLButtonElement).click(); });
  expect(selected).toEqual(["money"]);
});

test("the archive row shows no count while the count is unknown", async () => {
  setLocale("uk");
  countAnswer = { status: 503, body: { error: "NOT_INSTALLED" } };
  const el = mount(<OrgTree selected={null} onSelect={() => {}} onOpenArchive={() => {}} />);
  await act(flush); await act(flush);
  const archive = el.querySelector("[data-org-archive]") as HTMLButtonElement;
  expect(archive.textContent).toContain("Архів сесій");
  expect(archive.textContent).not.toContain("317");
  expect(asked.some((url) => url === "/api/archive?count=1")).toBe(true);
});
