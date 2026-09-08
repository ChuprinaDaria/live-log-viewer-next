import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { en } from "@/lib/i18n/en";
import type { FileEntry } from "@/lib/types";

import { setRuntimeUiEnabledForTests } from "@/hooks/runtimeBus";
import { MOBILE_LAYOUT_QUERY, mobileLayoutViewport } from "@/lib/attention/eligibility";

import { writeMobileHome } from "./mobile/mobileHomeModel";
import { getMobileNav, topScreen } from "./mobile/mobileNav";
import { OverviewBoard } from "./OverviewBoard";

/*
 * Task 7: the phone's one-tap entry into the launch form. The board's phone
 * branch grows a full-width «Запустити сесію» button above the card grid; a
 * tap pushes the shared `machines` screen (MobileMachinesScreen), the same
 * screen the tab bar's root row already opens.
 *
 * The button belongs to the card board, which is one of the tab's two faces
 * since the console landed; every render here stands on that face.
 */

const dom = new Window({ url: "http://localhost/" });

const viewportWidth = 390;
const matchMediaStub = (query: string) => ({
  matches: query === MOBILE_LAYOUT_QUERY && mobileLayoutViewport({ width: viewportWidth, height: 844 }),
  media: String(query),
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() {
    return false;
  },
});
(dom as unknown as { matchMedia: typeof matchMediaStub }).matchMedia = matchMediaStub;

Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  Node: dom.Node,
  HTMLElement: dom.HTMLElement,
  Event: dom.Event,
  MouseEvent: dom.MouseEvent,
  sessionStorage: dom.sessionStorage,
  localStorage: dom.localStorage,
  matchMedia: matchMediaStub,
});

function fileEntry(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    path: "/sessions/a.jsonl",
    root: "claude-projects",
    name: "a.jsonl",
    project: "atlas",
    title: "Session",
    engine: "claude",
    kind: "session",
    fmt: "claude",
    parent: null,
    mtime: 1_000,
    size: 1,
    activity: "idle",
    proc: null,
    pid: null,
    model: null,
    pendingQuestion: null,
    ...overrides,
  } as FileEntry;
}

/* The phone shell reads the runtime bus for its banner slot; keep it inert. */
setRuntimeUiEnabledForTests(false);

let root: Root | null = null;
beforeEach(() => writeMobileHome("board"));
afterEach(() => {
  if (root) flushSync(() => root?.unmount());
  root = null;
  dom.document.body.replaceChildren();
  getMobileNav().home();
});
afterAll(() => setRuntimeUiEnabledForTests(null));

function renderBoard(extra: Partial<React.ComponentProps<typeof OverviewBoard>> = {}): HTMLElement {
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  root = createRoot(container as unknown as Element);
  flushSync(() =>
    root!.render(
      <OverviewBoard
        files={[fileEntry()]}
        projectCatalog={[]}
        pipelines={[]}
        workflows={[]}
        archivedProjects={new Set()}
        now={2_000}
        onSelectProject={() => {}}
        onSelectFile={() => {}}
        mobileShell={{
          attentionCount: 0,
          arrival: null,
          renderSheet: () => null,
        }}
        {...extra}
      />,
    ),
  );
  return container as unknown as HTMLElement;
}

const launchButton = (host: HTMLElement) => host.querySelector('[data-mobile2-launch]') as unknown as HTMLElement | null;
const click = () => new dom.MouseEvent("click", { bubbles: true }) as unknown as Event;

test("the phone board offers a launch button, stretched by the column, above the card grid", () => {
  const host = renderBoard();
  const button = launchButton(host);
  expect(button).not.toBeNull();
  expect(button!.textContent).toContain(en["desktop.launchTitle"]);
  expect(button!.className).toContain("min-h-11");
  /* Width comes from the flex column plus the margins. `w-full` on top of
     `mx-3` made the button 24px wider than the space it was given, so it hung
     off the right edge of the screen. */
  expect(button!.className).toContain("mx-3");
  expect(button!.className).not.toContain("w-full");
});

test("a tap pushes the shared machines screen", () => {
  const host = renderBoard();
  flushSync(() => launchButton(host)!.dispatchEvent(click()));
  expect(topScreen(getMobileNav().getState())).toEqual({ kind: "machines" });
});
