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

import { setLocale } from "@/lib/i18n";
import { DesktopHome } from "./DesktopHome";

/* The HQ room polls /api/orchestrator/hq; an empty seat renders the «not
   started» state, which is enough to prove the room is mounted. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.startsWith("/api/orchestrator/hq") ? { seat: null, pending: null, exists: false }
    : url.startsWith("/api/firms") ? { firms: [] } : url.startsWith("/api/projects") ? { projects: [] } : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const flush = () => new Promise((r) => setTimeout(r, 0));

test("desktop home = console column + HQ room, and «Дошка» hands off", async () => {
  setLocale("uk");
  let boards = 0;
  const el = mount(<DesktopHome files={[]} selectedProject={null} onSelectProject={() => {}} onOpenBoard={() => { boards += 1; }} onOpenBoardProject={() => {}} onOpenFile={() => {}} />);
  await act(flush); await act(flush);
  expect(el.querySelector("[data-desktop-console]")).not.toBeNull();
  expect(el.querySelector('[data-mobile2-hq="vacant"]')).not.toBeNull();
  expect(el.querySelector("[data-mobile2-tabs]")).toBeNull();
  act(() => { (el.querySelector("[data-desktop-board]") as HTMLButtonElement).click(); });
  expect(boards).toBe(1);
});
