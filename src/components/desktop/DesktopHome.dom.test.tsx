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

/* The runtime bus is a separate plane; enabled here so the connection pill has
   something to render and its presence on the home can be asserted at all. */
const BUS_STATE = {
  store: { sessions: new Map(), receipts: [], attentions: new Map() },
  connection: "offline", resyncedAt: null, lastEventAt: null,
  enabled: true, structuredHostsEnabled: false,
};
/* One frozen state object, one bus: `useSyncExternalStore` re-renders forever
   when `getState` hands back a fresh reference on every read. */
const BUS = {
  start: () => {},
  getState: () => BUS_STATE,
  subscribe: () => () => {},
  subscribeFilesRevision: () => () => {},
};
mock.module("@/hooks/runtimeBus", () => ({
  SNAPSHOT_URL: "/api/runtime/snapshot",
  STREAM_URL: "/api/runtime/stream",
  STREAM_RECONNECTED_EVENT: "llv:stream-reconnected",
  isRuntimeUiEnabled: () => true,
  getRuntimeBus: () => BUS,
}));

import { setLocale } from "@/lib/i18n";
import { DesktopHome } from "./DesktopHome";

/* The HQ room polls /api/orchestrator/hq; an empty seat renders the «not
   started» state, which is enough to prove the room is mounted. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.startsWith("/api/orchestrator/hq") ? { seat: null, pending: null, exists: false }
    : url.startsWith("/api/firms") ? { firms: [] } : url.startsWith("/api/projects") ? { projects: [] }
    : url === "/api/archive?count=1" ? { count: 4 } : url.startsWith("/api/archive") ? { cards: [] } : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const flush = () => new Promise((r) => setTimeout(r, 0));

test("desktop home = console column + HQ room, and «Дошка» hands off", async () => {
  setLocale("uk");
  let boards = 0;
  const el = mount(<DesktopHome files={[]} selectedProject={null} onSelectProject={() => {}} onOpenBoard={() => { boards += 1; }} onOpenFile={() => {}} onOpenSearch={() => {}} onOpenTranscript={() => {}} />);
  await act(flush); await act(flush);
  expect(el.querySelector("[data-desktop-console]")).not.toBeNull();
  expect(el.querySelector('[data-mobile2-hq="vacant"]')).not.toBeNull();
  expect(el.querySelector("[data-mobile2-tabs]")).toBeNull();
  act(() => { (el.querySelector("[data-desktop-board]") as HTMLButtonElement).click(); });
  expect(boards).toBe(1);
});

test("the home carries the menu, the search trigger and the connection pill", async () => {
  /* This is the first screen of the session now. Without these three, secrets,
     MCP, permissions and the message search were reachable only by leaving the
     home for the board, and nothing said whether the runtime was up. */
  setLocale("uk");
  let searches = 0;
  const el = mount(<DesktopHome files={[]} selectedProject={null} onSelectProject={() => {}} onOpenBoard={() => {}} onOpenFile={() => {}} onOpenSearch={() => { searches += 1; }} onOpenTranscript={() => {}} />);
  await act(flush); await act(flush);

  const header = el.querySelector("[data-desktop-console] > div") as HTMLElement;
  expect(header.querySelector("[data-desktop-menu]")).not.toBeNull();

  const search = header.querySelector('[data-testid="overview-search"]') as HTMLButtonElement;
  expect(search).not.toBeNull();
  act(() => { search.click(); });
  expect(searches).toBe(1);

  /* The pill lives where `shell` docks it, so the one indicator that says
     whether the runtime is there does not disappear on the home. */
  expect(el.querySelector('[data-connection="offline"]')).not.toBeNull();
});

test("the archive row opens the archive in the right-side panel, and Esc closes it", async () => {
  setLocale("uk");
  const el = mount(<DesktopHome files={[]} selectedProject={null} onSelectProject={() => {}} onOpenBoard={() => {}} onOpenFile={() => {}} onOpenSearch={() => {}} onOpenTranscript={() => {}} />);
  await act(flush); await act(flush);
  expect(el.querySelector('[data-mobile2-screen="archive"]')).toBeNull();

  act(() => { (el.querySelector("[data-org-archive]") as HTMLButtonElement).click(); });
  await act(flush); await act(flush);
  const panel = document.querySelector('[data-desktop-archive-panel]');
  expect(panel).not.toBeNull();
  expect(panel!.querySelector('[data-mobile2-screen="archive"]')).not.toBeNull();
  /* One navigation per surface: the panel suppresses the phone's tab bar. */
  expect(panel!.querySelector("[data-mobile2-tabs]")).toBeNull();

  act(() => { window.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event); });
  expect(document.querySelector('[data-desktop-archive-panel]')).toBeNull();
});
