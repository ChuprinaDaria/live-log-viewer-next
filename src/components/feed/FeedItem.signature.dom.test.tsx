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
afterAll(() => { globalThis.fetch = realFetch; });

const realFetch = globalThis.fetch;
globalThis.fetch = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

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
