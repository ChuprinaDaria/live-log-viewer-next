import { afterAll, afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dom = new Window({ url: "http://localhost/" });
/* Both branches of the prose renderer are covered: the HQ room is the MOBILE
   one, and the desktop feed can carry a signature too. `mobile` is flipped per
   test, and `useIsMobile` reads matchMedia on every mount. */
let mobile = false;
const matchMedia = (query: string) => ({
  matches: query === MOBILE_LAYOUT_QUERY ? mobile : false,
  media: query, onchange: null,
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
/* `useIsMobile` reads `window.matchMedia`, and `window` here is the happy-dom
   instance rather than globalThis. */
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
  mobile = false;
});
afterAll(() => { globalThis.fetch = realFetch; });

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

import { MOBILE_LAYOUT_QUERY } from "@/lib/attention/eligibility";

import { FeedItem } from "./FeedItem";
import type { Item } from "./parse";

/*
 * The HQ room signs the orchestrator's answers: a 20 px avatar (or its letter)
 * and the name, above the bubble. The signature is the ROOM's, not the item's,
 * so it is passed in — and it rides only the agent's own prose, never the
 * operator's message and never a tool row.
 */

const prose: Item = { kind: "prose", ts: 1_700_000_000_000, text: "готово", engine: "claude" };
const user: Item = { kind: "user", ts: 1_700_000_000_000, text: "зроби" };

const signature = () => document.querySelector("[data-feed-signature]");

test("an agent answer carries the name and the picture the room was given", () => {
  mount(<FeedItem item={prose} signature={{ name: "Дітріх", avatarUrl: "/api/orchestrator/hq/avatar?v=1" }} />);
  const row = signature();
  expect(row).not.toBeNull();
  expect(row!.textContent).toContain("Дітріх");
  const img = row!.querySelector("img");
  expect(img).not.toBeNull();
  expect(img!.getAttribute("src")).toBe("/api/orchestrator/hq/avatar?v=1");
  /* Decorative: the name beside it is the accessible text. */
  expect(img!.getAttribute("alt")).toBe("");
});

test("with no picture the row falls back to the name's first letter", () => {
  mount(<FeedItem item={prose} signature={{ name: "дітріх", avatarUrl: null }} />);
  const row = signature();
  expect(row).not.toBeNull();
  expect(row!.querySelector("img")).toBeNull();
  expect(row!.textContent).toContain("Д");
  expect(row!.textContent).toContain("дітріх");
});

test("no signature prop, no signature row", () => {
  mount(<FeedItem item={prose} />);
  expect(signature()).toBeNull();
});

test("the operator's own message is never signed by the orchestrator", () => {
  mount(<FeedItem item={user} signature={{ name: "Дітріх", avatarUrl: "/api/orchestrator/hq/avatar?v=1" }} />);
  expect(signature()).toBeNull();
});

test("a tool row is never signed", () => {
  const tool: Item = {
    kind: "tool", id: "t1", ts: 1_700_000_000_000, srcCall: 1, family: "shell", tool: "Bash",
    icon: "shell", summary: "ls", chips: [], status: "ok", statusLabel: "ok",
    outputPreview: "", outputTruncated: false, open: false,
  };
  mount(<FeedItem item={tool} signature={{ name: "Дітріх", avatarUrl: null }} />);
  expect(signature()).toBeNull();
});

/* The phone is the surface the HQ room actually runs on: `FeedItem` renders a
   different prose branch there, and the signature has to survive the switch. */
test("on the phone the answer is signed the same way", () => {
  mobile = true;
  mount(<FeedItem item={prose} signature={{ name: "Дітріх", avatarUrl: "/api/orchestrator/hq/avatar?v=1" }} />);
  expect(document.querySelector("[data-mobile-message='agent']")).not.toBeNull();
  const row = signature();
  expect(row).not.toBeNull();
  expect(row!.textContent).toContain("Дітріх");
  expect(row!.querySelector("img")!.getAttribute("src")).toBe("/api/orchestrator/hq/avatar?v=1");
});

test("on the phone with no picture the letter circle stands in", () => {
  mobile = true;
  mount(<FeedItem item={prose} signature={{ name: "дітріх", avatarUrl: null }} />);
  const row = signature();
  expect(row).not.toBeNull();
  expect(row!.querySelector("img")).toBeNull();
  expect(row!.textContent).toContain("Д");
});

test("on the phone an unsigned feed and the operator's own message stay bare", () => {
  mobile = true;
  mount(<FeedItem item={prose} />);
  expect(signature()).toBeNull();
});

test("on the phone the operator's message is never signed", () => {
  mobile = true;
  mount(<FeedItem item={user} signature={{ name: "Дітріх", avatarUrl: null }} />);
  expect(signature()).toBeNull();
});
