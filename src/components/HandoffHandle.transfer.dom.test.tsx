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
import { uk } from "@/lib/i18n/uk";
import { HandoffHandle } from "./HandoffHandle";

/*
 * Task 7: «перенести» beside the handoff pill on the desktop scheme board.
 * The button only appears when the caller wired `onTransfer` — map mode and
 * any board that has not threaded the prop keep the handle exactly as it was.
 */

function entry(over: Partial<FileEntry> = {}): FileEntry {
  return { path: "/w/a.jsonl", root: "claude-projects", name: "a.jsonl", project: "atlas", title: "A", engine: "claude", kind: "session", fmt: "jsonl", parent: null, mtime: 100, size: 1, activity: "idle", proc: null, pid: null, model: null, pendingQuestion: null, ...over } as FileEntry;
}

test("with onTransfer wired, the transfer button sits beside the handoff pill and a click calls it", () => {
  setLocale("uk");
  const calls: string[] = [];
  const el = mount(<HandoffHandle file={entry()} onHandoff={() => {}} onTransfer={() => calls.push("transfer")} />);
  const button = el.querySelector('[data-transfer]') as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  expect(button!.getAttribute("aria-label")).toBe("перенести на іншу машину / акаунт");
  expect(button!.getAttribute("title")).toBe("перенести на іншу машину / акаунт");
  act(() => { button!.click(); });
  expect(calls).toEqual(["transfer"]);
  /* The handoff pill itself is untouched — still there, still its own control. */
  expect(el.querySelector(`[aria-label="${uk["handoff.aria"]}"]`)).not.toBeNull();
});

test("without onTransfer, no transfer button renders — only the handoff pill", () => {
  const el = mount(<HandoffHandle file={entry()} onHandoff={() => {}} />);
  expect(el.querySelector('[data-transfer]')).toBeNull();
  expect(el.querySelector("button")).not.toBeNull();
});
