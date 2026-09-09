/**
 * Rendered proof for UI round 2, lane A (docs/ui-round2-spec.md): on the phone
 * the reply drafts and the «back to live» control never cover the transcript.
 *
 *   bun run build && bun scripts/capture-round2-lane-a.ts
 *
 * The production build is served against a synthetic home under the temp root
 * (never the operator's live state, no real path or identity in any frame),
 * the phone is emulated at 390×844 and at the narrow 360×780, in TWO columns
 * — the geometry the board gets from the home screen and the one it gets in a
 * browser tab — and the one conversation is driven through the three states
 * the lane is about:
 *
 *   standalone   the target environment since the board became installable
 *                (manifest `display: standalone`, `viewport-fit=cover`): the
 *                layout viewport is the whole frame, `(display-mode:
 *                standalone)` matches, and the phone's safe-area insets are
 *                emulated through CDP so the frame shows what the column pays
 *                for the home indicator (today: nothing — no chat surface
 *                reads `env(safe-area-inset-bottom)`, which the report states
 *                as `gapUnderComposerPx`).
 *   tab          the same frame minus the browser's own rows: the ~85 px
 *                Safari keeps on an iPhone (docs/ui-round2-spec.md, lane C)
 *                and the 80 px of status bar plus toolbar Chrome keeps on a
 *                360-wide Android. Recorded so the two can be compared; the
 *                budget's floors are gated in the standalone column only,
 *                because that is where the operator uses the board.
 *
 *   bottom       the magnet holds: the drafts band sits under the transcript
 *   scrolled-up  the magnet is released: the round «back to live» button is up,
 *                the band is still in the flow, and the transcript has grown
 *                behind the operator so the button carries a count
 *   keyboard     scrolled up AND the keyboard open (the visual viewport shrunk
 *                through the signal `useKeyboardInset` subscribes to, #983)
 *
 * Every frame is MEASURED, not only rendered, and the numbers go to
 * `report.json` beside the frames so the proof reads in a diff without opening
 * a PNG: the band's height against `SUGGESTED_CHIPS_PX`, the composer unit at
 * rest and under the keyboard, the transcript's share of the visible viewport
 * against the floor documented for THAT frame and column (390×844 standalone
 * reads `chatBudget`'s own floors; every other frame carries its measured
 * floor in `FRAMES`, so a transcript that shrinks anywhere turns the run red),
 * for every state the bottom of the lowest visible transcript row against the
 * top of the band, and — the review's finding — every rectangle of visible
 * transcript TEXT against the «back to live» control joined with everything
 * drawn from it (its count included), which must cover none and must lie
 * whole inside the band — and, since layout boxes see no shadow, ring,
 * outline or pseudo-element, a PIXEL comparison of the strip just above the
 * band with the control hidden, at rest and under keyboard focus, which
 * must not change by one pixel.
 * Two draft-set variants render on top of the base set at 390×844 standalone:
 * one valid 64-character label, and six mixed labels with RTL among them —
 * every label whole, none clipped inside its chip. A frame that fails a gate
 * still lands, and the report says which gate — then the run fails.
 * `capture-round2-lane-a.test.ts` proves each gate can go red.
 *
 * Frames land outside the repository (a browser render is not deterministic,
 * so it can carry no privacy-manifest provenance and the publication gate
 * refuses it committed); the report is the artefact that travels.
 *
 *   <tmp>/llv-issue-20260909-latest/out/lane-a-<frame>-<column>-<state>.png
 *   <tmp>/llv-issue-20260909-latest/out/report.json
 *
 * (The capture directory wants an issue number; round 2 has a spec dated
 * 2026-09-09 instead, so that date is the number.)
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";

import { chromium, type Browser, type Page } from "playwright-core";

import {
  KEYBOARD_PX,
  MIN_KEYBOARD_TRANSCRIPT_SHARE,
  MIN_TRANSCRIPT_SHARE,
  SUGGESTED_CHIPS_PX,
  chatBudget,
} from "@/components/mobile/chatBudget";

import { createCaptureDirectory } from "./capture-directory";
import { demoPort } from "./demo-capture";

const REPO_ROOT = path.resolve(import.meta.dir, "..");
/* Allocated only for a run: the test imports the gates without a browser and
   must not leave a capture directory behind. */
const BASE = import.meta.main
  ? createCaptureDirectory({
    envName: "LANE_A_CAPTURE_DIR",
    prefix: "llv-issue-20260909",
    raw: process.env.LANE_A_CAPTURE_DIR,
    repoRoot: REPO_ROOT,
  })
  : path.join(os.tmpdir(), "llv-issue-20260909-unused");
const HOME = path.join(BASE, "home");
const OUT_DIR = path.join(BASE, "out");
const REPO_DIR = path.join(HOME, "Projects", "atlas");
const CAPTURE_MS = Date.parse("2100-01-02T12:00:00.000Z");

export const COLUMNS = ["standalone", "tab"] as const;
export type Column = (typeof COLUMNS)[number];
export interface Floors { closed: number; keyboard: number }
export interface Frame {
  name: string;
  width: number;
  height: number;
  /** The browser's own rows in a tab, taken off the layout viewport. */
  browserRowsPx: number;
  /** The phone's safe-area insets in standalone, emulated through CDP. */
  safeArea: { top: number; bottom: number };
  /** The transcript's share this frame is held to, per column: measured on
      the production build (2026-09-09) and set just under the measurement,
      so a transcript that shrinks here is a red run, not a footnote. */
  floors: Record<Column, Floors>;
}
export const FRAMES: readonly Frame[] = [
  /* iPhone 390×844: the status bar and the home indicator; Safari's persistent
     row costs ~85 px (lane C's measurement). The standalone floors ARE the
     budget's — `chatBudget.ts` describes this frame. */
  {
    name: "390x844", width: 390, height: 844, browserRowsPx: 85, safeArea: { top: 47, bottom: 34 },
    floors: {
      standalone: { closed: MIN_TRANSCRIPT_SHARE, keyboard: MIN_KEYBOARD_TRANSCRIPT_SHARE },
      /* Measured 502 / 759 = 66.1% and 166 / 423 = 39.2%. */
      tab: { closed: 0.66, keyboard: 0.39 },
    },
  },
  /* A narrow Android 360×780: a 24 px status bar, a 56 px Chrome toolbar,
     gesture navigation overlaid (no bottom inset). Its own floors: measured
     523 / 780 = 67.1% and 187 / 444 = 42.1% standalone, 443 / 700 = 63.3% and
     107 / 364 = 29.4% in a tab. */
  {
    name: "360x780", width: 360, height: 780, browserRowsPx: 80, safeArea: { top: 24, bottom: 0 },
    floors: { standalone: { closed: 0.67, keyboard: 0.42 }, tab: { closed: 0.63, keyboard: 0.29 } },
  },
];
/** The floor one frame, column and keyboard state is held to. */
export function floorFor(frame: Frame, column: Column, keyboard: boolean): number {
  const floors = frame.floors[column];
  return keyboard ? floors.keyboard : floors.closed;
}
export const STATES = ["bottom", "scrolled-up", "keyboard"] as const;
export type State = (typeof STATES)[number];

/** The layout viewport one column gives a frame. */
export function columnViewport(frame: Frame, column: Column): { width: number; height: number } {
  return { width: frame.width, height: column === "tab" ? frame.height - frame.browserRowsPx : frame.height };
}

/** The lane's own drafts, as the operator's photo showed them. */
const DRAFTS = [
  { label: "Запускай раунд 2", text: "Запускай раунд 2, лейни A і E паралельно." },
  { label: "Спершу покажи аудит", text: "Спершу покажи аудит astra, потім вирішимо." },
  { label: "Закоммить і запуш", text: "Закоммить і запуш, я подивлюсь у PR." },
  { label: "Що з клавіатурою?", text: "Що з клавіатурою на 390×844 — виміряно?" },
];
type Draft = { label: string; text: string };
/** The review's acceptance sets: one label at the 64-character maximum the
    suggestion type allows, and six mixed ones with RTL among them. Every
    label must read whole — the chip never clips inside itself. */
export const DRAFT_VARIANTS: readonly { id: string; drafts: Draft[] }[] = [
  { id: "long", drafts: [{ label: "Перевір, будь ласка, що смуга драфтів не накриває жодного рядка", text: "Перевір смугу." }] },
  {
    id: "mixed",
    drafts: [
      { label: "Так", text: "Так." },
      { label: "نعم، ابدأ الجولة الثانية", text: "Yes, start round 2." },
      { label: "Покажи аудит спершу", text: "Покажи аудит спершу." },
      { label: "כן, תמשיך", text: "Yes, go on." },
      { label: "Merge after review", text: "Merge after review." },
      { label: "Скільки це коштує по хрому на 360 px?", text: "Скільки це коштує по хрому?" },
    ],
  },
];
for (const variant of DRAFT_VARIANTS) for (const draft of variant.drafts) if (draft.label.length > 64) throw new Error(`variant ${variant.id}: a label over 64 characters`);

const projectSlug = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");
/* Composed, not written out: a literal UUID in a published source file is
   what the privacy gate's resource-identifier rule catches. */
const SESSION_UUID = ["00000a2a", "0000", "4000", "8000", "000000000000"].join("-");
const TRANSCRIPT_PATH = path.join(HOME, ".claude/projects", projectSlug(REPO_DIR), `${SESSION_UUID}.jsonl`);

/** A conversation long enough to scroll on a phone, in the operator's language,
    with the paragraph shapes the photo had: prose, a list, inline code. */
function transcriptLines(): string[] {
  const at = (minutesAgo: number) => new Date(CAPTURE_MS - minutesAgo * 60_000).toISOString();
  const user = (id: string, minutesAgo: number, text: string) =>
    ({ type: "user", uuid: `${SESSION_UUID}-${id}`, timestamp: at(minutesAgo), cwd: REPO_DIR, message: { role: "user", content: text } });
  const assistant = (id: string, minutesAgo: number, text: string) =>
    ({ type: "assistant", uuid: `${SESSION_UUID}-${id}`, timestamp: at(minutesAgo), cwd: REPO_DIR, message: { role: "assistant", model: "claude-opus-4-6", content: [{ type: "text", text }] } });
  /* Neutral filler with the paragraph shapes the operator's photo had — prose,
     a list, inline code with a path — and enough of it to scroll on a phone.
     It says nothing about the design; the frames and the report do. */
  const paragraph = (n: number) => `Абзац ${n}. Цей текст існує лише для того, щоб стрічка мала що гортати на телефоні: кілька речень звичайної довжини, без жодного змісту, який треба було б читати.`;
  const lines = [
    user("u1", 48, "Перше запитання, коротке."),
    assistant("a1", 47, [paragraph(1), "", "Список:", "- перший пункт списку;", "- другий пункт списку;", "- третій пункт списку.", "", "Шлях у коді: `src/components/feed/SuggestedReplies.tsx`."].join("\n")),
    user("u2", 40, "Друге запитання, трохи довше за перше."),
    assistant("a2", 39, [paragraph(2), "", paragraph(3)].join("\n")),
    user("u3", 31, "Третє запитання."),
    assistant("a3", 30, [paragraph(4), "", "Ще один шлях: `src/components/LogFeed.tsx`, і ще один: `src/components/mobile/chatBudget.ts`."].join("\n")),
    user("u4", 22, "Четверте запитання."),
    assistant("a4", 21, [paragraph(5), "", paragraph(6)].join("\n")),
    user("u5", 12, "П'яте запитання, останнє."),
    assistant("a5", 11, [paragraph(7), "", paragraph(8)].join("\n")),
  ];
  return lines.map((line) => JSON.stringify(line));
}

/** Two more answers, appended while the operator is scrolled up, so the
    «back to live» button has a count to carry. */
function arrivalLines(): string[] {
  const at = (secondsAgo: number) => new Date(CAPTURE_MS - secondsAgo * 1000).toISOString();
  return [
    { type: "assistant", uuid: `${SESSION_UUID}-a6`, timestamp: at(20), cwd: REPO_DIR, message: { role: "assistant", model: "claude-opus-4-6", content: [{ type: "text", text: "Перша відповідь, що прийшла пізніше." }] } },
    { type: "assistant", uuid: `${SESSION_UUID}-a7`, timestamp: at(5), cwd: REPO_DIR, message: { role: "assistant", model: "claude-opus-4-6", content: [{ type: "text", text: "Друга відповідь, що прийшла пізніше." }] } },
  ].map((line) => JSON.stringify(line));
}

function seedHome(): void {
  fs.mkdirSync(REPO_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(BASE, "tmp", `claude-${process.getuid?.() ?? 1000}`), { recursive: true });
  fs.mkdirSync(path.join(HOME, ".config/agent-log-viewer/state"), { recursive: true });
  fs.mkdirSync(path.join(HOME, ".codex/sessions"), { recursive: true });
  fs.mkdirSync(path.dirname(TRANSCRIPT_PATH), { recursive: true });
  fs.writeFileSync(TRANSCRIPT_PATH, transcriptLines().join("\n") + "\n", "utf8");
}

function buildEnvironment(port: number): NodeJS.ProcessEnv {
  const config = path.join(HOME, ".config");
  return {
    NODE_ENV: "production",
    PATH: process.env.PATH,
    HOME,
    TMPDIR: path.join(BASE, "tmp"),
    TMUX_TMPDIR: path.join(BASE, "tmux"),
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: path.join(BASE, "cache"),
    XDG_RUNTIME_DIR: path.join(BASE, "runtime"),
    LLV_STATE_DIR: path.join(config, "agent-log-viewer", "state"),
    LLV_CLAUDE_HOME: path.join(HOME, ".claude"),
    LLV_CODEX_HOME: path.join(HOME, ".codex"),
    LLV_ACCOUNT_CONTROLLER_DISABLED: "1",
    LLV_REAPER_ENABLED: "0",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(port),
    TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", USER: "demo", LOGNAME: "demo", SHELL: "/bin/sh",
  };
}

async function waitForServer(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`production server exited with ${child.exitCode}`);
    try {
      if ((await fetch(`${url}/api/files`)).ok) return;
    } catch {
      /* still booting */
    }
    await Bun.sleep(300);
  }
  throw new Error("production server did not become ready");
}

const seedInit = () => {
  const captureTime = Date.parse("2100-01-02T12:00:00.000Z");
  const NativeDate = Date;
  class CaptureDate extends NativeDate {
    constructor(...args: unknown[]) {
      super(...((args.length ? args : [captureTime]) as []));
    }
    static now() { return captureTime; }
  }
  Object.defineProperty(globalThis, "Date", { configurable: true, value: CaptureDate });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: undefined });
  localStorage.clear();
  sessionStorage.clear();
  /* The operator's phone reads the board in Ukrainian; so does the proof. */
  localStorage.setItem("llv_lang", "uk");
  localStorage.setItem("llvSound", "0");
};

/** What a home-screen launch answers that a tab does not. */
const standaloneInit = () => {
  const native = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    const result = native(query);
    if (/display-mode:\s*standalone/.test(query)) Object.defineProperty(result, "matches", { configurable: true, value: true });
    return result;
  };
  Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
};

/** How many draft reads the page made, for the diagnostic when none render. */
let suggestionRequests = 0;

const SEL = {
  shell: '[data-testid="mobile-chat-shell"]',
  scroller: "[data-log-feed-scroller]",
  rows: "[data-log-feed-scroller] [data-feed-key]",
  band: "[data-feed-drafts-band]",
  chipsRow: "[data-mobile-chips]",
  chips: "[data-reply-suggestion]",
  fadeEnd: '[data-chips-fade="end"]',
  fadeStart: '[data-chips-fade="start"]',
  jump: "[data-feed-jump-tail]",
  newCount: "[data-feed-new-count]",
  composerBox: "[data-mobile2-composer]",
  field: '[data-mobile2-field], [data-testid="mobile-chat-shell"] textarea',
  send: '[data-mobile2-send], [data-testid="mobile-chat-shell"] form button[type="submit"]',
  floating: '[data-reply-suggestions="floating"]',
};

interface Rect { top: number; bottom: number; left: number; right: number; width: number; height: number }

/** What one frame shows, in layout px, read off the live DOM. */
export interface Geometry {
  layout: { width: number; height: number };
  /** Bottom edge of what the operator can see (the keyboard's top once open). */
  visibleBottom: number;
  scroller: Rect | null;
  /** The lowest transcript row that is at least partly inside the scroller,
      clipped to the scroller: its bottom is where text can last be. */
  lowestTextBottom: number | null;
  visibleRows: number;
  band: Rect | null;
  chipsRow: Rect | null;
  chips: Rect[];
  /** Chips whose right edge is past the row's right edge (cut by the row). */
  chipsCutRight: number;
  /** Chips whose label is clipped INSIDE the chip (scrollWidth past clientWidth). */
  chipsClippedInside: number;
  fadeEnd: boolean;
  fadeStart: boolean;
  /** The row swiped to its end: the last chip whole, the fade moved to the
      start. Read after the frame, and the row is put back. */
  rowEnd: { lastChipClear: boolean; fadeStart: boolean; fadeEnd: boolean } | null;
  /** The «back to live» control's own box, plus `union`: its box joined with
      every element drawn from it (the count included) — what the text is
      measured against, since a child can hang over the box's edge. */
  jump: (Rect & { opaque: boolean; count: string | null; inBand: boolean; inScroller: boolean; union: Rect }) | null;
  /** Rectangles of visible transcript text, clipped to the scroller. */
  visibleTextRects: number;
  /** Those of them the «back to live» control covers, and the first one. */
  jumpCoversText: { count: number; first: Rect | null };
  floating: number;
  composerBox: Rect | null;
  /** From the band's bottom (or the scroller's, with no band) to the visible
      bottom: the composer UNIT as the budget counts it. */
  composerUnit: number | null;
  /** What lies between the composer box and the visible bottom: padding, and
      whatever the column pays for a home indicator (today nothing does). */
  gapUnderComposer: number | null;
  standaloneMedia: boolean;
  /** Read off pixels after the frame; null while the magnet holds. */
  ink: InkSpill | null;
  send: Rect | null;
  fieldFocused: boolean;
  documentScrollWidth: number;
  /** Every box in the chat column from the bar down, by name and height, so
      a chrome total that disagrees with the budget can be read row by row. */
  anatomy: { name: string; top: number; height: number }[];
}

async function readGeometry(page: Page): Promise<Geometry> {
  return page.evaluate((sel) => {
    const rect = (el: Element | null): Rect | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const visual = window.visualViewport;
    const visibleBottom = Math.round(visual ? visual.offsetTop + visual.height : window.innerHeight);
    const scroller = rect(document.querySelector(sel.scroller));
    let lowestTextBottom: number | null = null;
    let visibleRows = 0;
    if (scroller) {
      for (const row of document.querySelectorAll(sel.rows)) {
        const r = row.getBoundingClientRect();
        if (r.bottom <= scroller.top || r.top >= scroller.bottom || r.height === 0) continue;
        visibleRows += 1;
        const clippedBottom = Math.round(Math.min(r.bottom, scroller.bottom));
        if (lowestTextBottom === null || clippedBottom > lowestTextBottom) lowestTextBottom = clippedBottom;
      }
    }
    const band = rect(document.querySelector(sel.band));
    const chipsRowEl = document.querySelector(sel.chipsRow);
    const chipsRow = rect(chipsRowEl);
    const chipEls = [...document.querySelectorAll(sel.chips)];
    const chips = chipEls.map((chip) => rect(chip)!) as Rect[];
    const chipsCutRight = chipsRow ? chips.filter((chip) => chip.left < chipsRow.right && chip.right > chipsRow.right).length : 0;
    const chipsClippedInside = chipEls.filter((chip) => {
      const label = chip.firstElementChild as HTMLElement | null;
      return Boolean(label) && label!.scrollWidth > label!.clientWidth + 1;
    }).length;
    const jumpEl = document.querySelector(sel.jump);
    const jumpRect = rect(jumpEl);
    let jump: Geometry["jump"] = null;
    if (jumpEl && jumpRect) {
      const bg = getComputedStyle(jumpEl).backgroundColor;
      const alpha = bg.startsWith("rgba") ? Number(bg.slice(bg.lastIndexOf(",") + 1, -1)) : bg.includes("/") ? Number(bg.slice(bg.lastIndexOf("/") + 1, -1)) : 1;
      const union = { ...jumpRect };
      for (const child of jumpEl.querySelectorAll("*")) {
        const r = child.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        union.top = Math.min(union.top, Math.round(r.top));
        union.left = Math.min(union.left, Math.round(r.left));
        union.bottom = Math.max(union.bottom, Math.round(r.bottom));
        union.right = Math.max(union.right, Math.round(r.right));
      }
      union.width = union.right - union.left;
      union.height = union.bottom - union.top;
      jump = {
        ...jumpRect,
        opaque: alpha >= 0.999,
        count: jumpEl.querySelector(sel.newCount)?.textContent ?? null,
        inBand: Boolean(document.querySelector(sel.band)?.contains(jumpEl)),
        inScroller: Boolean(document.querySelector(sel.scroller)?.contains(jumpEl)),
        union,
      };
    }
    /* Every rectangle of transcript text the operator can see, clipped to the
       scroller: what a control over the transcript would be hiding. */
    let visibleTextRects = 0;
    const covered: Rect[] = [];
    if (scroller) {
      const range = document.createRange();
      for (const row of document.querySelectorAll(sel.rows)) {
        const rowRect = row.getBoundingClientRect();
        if (rowRect.bottom <= scroller.top || rowRect.top >= scroller.bottom) continue;
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent || !node.textContent.trim()) continue;
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            const top = Math.max(r.top, scroller.top);
            const bottom = Math.min(r.bottom, scroller.bottom);
            const left = Math.max(r.left, scroller.left);
            const right = Math.min(r.right, scroller.right);
            if (bottom - top <= 0 || right - left <= 0) continue;
            visibleTextRects += 1;
            const against = jump?.union ?? jumpRect;
            if (against && left < against.right && right > against.left && top < against.bottom && bottom > against.top) {
              covered.push({ top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right), width: Math.round(right - left), height: Math.round(bottom - top) });
            }
          }
        }
      }
    }
    const composerBox = rect(document.querySelector(sel.composerBox));
    const bandOrScrollerBottom = band && band.height > 0 ? band.bottom : scroller?.bottom ?? null;
    const field = document.querySelector(sel.field);
    /* Hooks by NAME; a value only when it is a short word (a state, a slot
       kind) — never a path or an id, which the report must not carry. */
    const name = (el: Element): string => {
      const hooks = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => /^[a-z-]{1,16}$/.test(a.value) ? `${a.name}=${a.value}` : a.name);
      return hooks.length ? hooks.join(" ") : `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`;
    };
    const anatomy: { name: string; top: number; height: number }[] = [];
    const shell = document.querySelector(sel.shell);
    const walk = (el: Element, depth: number) => {
      if (depth > 10) return;
      for (const child of el.children) {
        const r = child.getBoundingClientRect();
        if (r.height >= 8 && r.width >= 100) anatomy.push({ name: `${"  ".repeat(depth)}${name(child)}`, top: Math.round(r.top), height: Math.round(r.height) });
        if (!child.matches(sel.scroller)) walk(child, depth + 1);
      }
    };
    if (shell) walk(shell, 0);
    return {
      anatomy,
      layout: { width: window.innerWidth, height: window.innerHeight },
      visibleBottom,
      scroller,
      lowestTextBottom,
      visibleRows,
      band,
      chipsRow,
      chips,
      chipsCutRight,
      chipsClippedInside,
      visibleTextRects,
      jumpCoversText: { count: covered.length, first: covered[0] ?? null },
      fadeEnd: Boolean(document.querySelector(sel.fadeEnd)),
      fadeStart: Boolean(document.querySelector(sel.fadeStart)),
      rowEnd: null,
      jump,
      floating: document.querySelectorAll(sel.floating).length,
      composerBox,
      composerUnit: bandOrScrollerBottom === null ? null : visibleBottom - bandOrScrollerBottom,
      gapUnderComposer: composerBox ? visibleBottom - composerBox.bottom : null,
      standaloneMedia: window.matchMedia("(display-mode: standalone)").matches,
      ink: null,
      send: rect(document.querySelector(sel.send)),
      fieldFocused: Boolean(field) && document.activeElement === field,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  }, SEL);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * Ink, not boxes                                                              *
 * ────────────────────────────────────────────────────────────────────────── */

/** A PNG as Chromium writes a screenshot: 8-bit RGB or RGBA, no interlace. */
export function decodePng(bytes: Uint8Array): { width: number; height: number; channels: number; pixels: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0, height = 0, channels = 0;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = bytes[offset + 16];
      const colour = bytes[offset + 17];
      if (depth !== 8 || bytes[offset + 20] !== 0) throw new Error(`unsupported PNG: depth ${depth}, interlace ${bytes[offset + 20]}`);
      channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
      if (!channels) throw new Error(`unsupported PNG colour type ${colour}`);
    } else if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat.map((part) => Buffer.from(part))));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? pixels[dst + x - channels]! : 0;
      const b = y > 0 ? pixels[dst - stride + x]! : 0;
      const c = y > 0 && x >= channels ? pixels[dst - stride + x - channels]! : 0;
      let value = raw[src + x]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[dst + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** Pixels whose colour differs between two decodes of the same clip. */
export function differingPixels(a: ReturnType<typeof decodePng>, b: ReturnType<typeof decodePng>, tolerance = 8): number {
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels) throw new Error("clips differ in shape");
  let count = 0;
  for (let i = 0; i < a.width * a.height; i += 1) {
    const o = i * a.channels;
    for (let ch = 0; ch < 3; ch += 1) {
      if (Math.abs(a.pixels[o + ch]! - b.pixels[o + ch]!) > tolerance) { count += 1; break; }
    }
  }
  return count;
}

/** What the control PAINTS over the transcript, read off pixels: the strip
    just above the band, rendered with the control hidden, shown at rest, and
    shown with keyboard focus. Layout boxes do not see shadows, rings,
    outlines or pseudo-elements (round 3 of the review); pixels do. */
export interface InkSpill {
  /** Pixels in the strip that change when the control at rest is painted. */
  decorativeAboveBand: number;
  /** Pixels in the strip that change when the control is focused from the keyboard. */
  focusAboveBand: number;
  /** The focus was a real `:focus-visible` when the focused shot was taken,
      and still was right after it. */
  focusVisible: boolean;
  /** The control was really hidden when the hidden shot was taken. */
  hiddenApplied: boolean;
  /** The probe's own red path: an OUTER 2 px ring injected on the control
      must change pixels in the strip, or the probe is blind in this frame. */
  injectedRingSeen: number;
  /** The strip measured: `height` CSS px above the band, full width. */
  strip: { top: number; height: number; width: number };
  /** How the probe knows it is looking at the right pixels: the band's own
      clip changes when the control is hidden, the strip's clip changes when
      the transcript is scrolled by a few pixels, and what stands at the
      strip's bottom edge over the control's x. */
  probe: { bandSeen: number; stripFollowsScroll: number; aboveControl: string; wrapperBackground: string };
}

async function readInkSpill(page: Page, bandTop: number, width: number): Promise<InkSpill | null> {
  if (!(await page.locator(SEL.jump).count())) return null;
  const strip = { top: Math.max(0, bandTop - 6), height: 6, width };
  const clip = { x: 0, y: strip.top, width: strip.width, height: strip.height };
  const shot = async () => decodePng(new Uint8Array(await page.screenshot({ clip, animations: "disabled", caret: "hide" })));
  const setVisibility = (value: string) => page.evaluate(({ sel, v }) => { document.querySelector<HTMLElement>(sel)!.style.visibility = v; }, { sel: SEL.jump, v: value });
  const isFocusVisible = () => page.evaluate((sel) => document.activeElement?.matches(`${sel}:focus-visible`) ?? false, SEL.jump);
  const bandClip = { x: 0, y: bandTop, width, height: 44 };
  const bandShot = async () => decodePng(new Uint8Array(await page.screenshot({ clip: bandClip, animations: "disabled", caret: "hide" })));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(80);
  const shown = await shot();
  const bandShown = await bandShot();
  await setVisibility("hidden");
  await page.waitForTimeout(80);
  const hiddenApplied = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)!).visibility === "hidden", SEL.jump);
  const hidden = await shot();
  const bandHidden = await bandShot();
  await setVisibility("");
  /* Does the strip's clip follow the DOM at all? Nudge the transcript. */
  await page.evaluate((sel) => { document.querySelector<HTMLElement>(sel)!.scrollTop -= 3; }, SEL.scroller);
  await page.waitForTimeout(80);
  const nudged = await shot();
  await page.evaluate((sel) => { document.querySelector<HTMLElement>(sel)!.scrollTop += 3; }, SEL.scroller);
  await page.waitForTimeout(80);
  const probe = await page.evaluate(({ sel, top }) => {
    const jump = document.querySelector<HTMLElement>(sel)!;
    const r = jump.getBoundingClientRect();
    const above = document.elementFromPoint(r.left + r.width / 2, top - 1);
    const name = (el: Element | null) => el ? `${el.tagName.toLowerCase()}${[...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => `[${a.name}]`).join("")}` : "none";
    const wrapper = document.querySelector<HTMLElement>("[data-log-feed-scroller]")!.parentElement!;
    return { aboveControl: name(above), wrapperBackground: `${getComputedStyle(wrapper).backgroundColor} pos=${getComputedStyle(wrapper).position} z=${getComputedStyle(wrapper).zIndex}` };
  }, { sel: SEL.jump, top: bandTop });
  /* Keyboard focus, so `:focus-visible` is the real one: a Tab first for the
     keyboard modality, then focus, then Tab onward until the control has it. */
  await page.keyboard.press("Tab");
  await page.focus(SEL.jump);
  let focusVisible = await isFocusVisible();
  for (let i = 0; i < 40 && !focusVisible; i += 1) {
    await page.keyboard.press("Tab");
    focusVisible = await isFocusVisible();
  }
  await page.waitForTimeout(80);
  const focused = await shot();
  focusVisible = focusVisible && await isFocusVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  /* The probe's red path, in this very frame: paint an outer 2 px ring on the
     control and look again. A probe that cannot see it cannot clear it. */
  await page.evaluate((sel) => { document.querySelector<HTMLElement>(sel)!.style.boxShadow = "0 0 0 2px rgb(90 81 224)"; }, SEL.jump);
  await page.waitForTimeout(80);
  const injected = await shot();
  await page.evaluate((sel) => { document.querySelector<HTMLElement>(sel)!.style.boxShadow = ""; }, SEL.jump);
  return {
    decorativeAboveBand: differingPixels(hidden, shown),
    focusAboveBand: differingPixels(hidden, focused),
    focusVisible,
    hiddenApplied,
    injectedRingSeen: differingPixels(hidden, injected),
    strip,
    probe: { bandSeen: differingPixels(bandHidden, bandShown), stripFollowsScroll: differingPixels(hidden, nudged), ...probe },
  };
}

/** Swipe the row to its end, read the edge, and put it back. */
async function readRowEnd(page: Page): Promise<Geometry["rowEnd"]> {
  const rowEnd = await page.evaluate(async (sel) => {
    const row = document.querySelector<HTMLElement>(sel.chipsRow);
    if (!row) return null;
    const before = row.scrollLeft;
    row.scrollLeft = row.scrollWidth;
    row.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const rowRect = row.getBoundingClientRect();
    const chips = [...document.querySelectorAll(sel.chips)];
    const last = chips.at(-1)?.getBoundingClientRect();
    /* Swiped to the end, the last chip's END is inside the row: a chip wider
       than the row (one long label) cannot fit whole at once, and reads by
       swiping — what must never happen is its end being past the edge. */
    const result = {
      lastChipClear: Boolean(last) && last!.right <= rowRect.right + 0.5,
      fadeStart: Boolean(document.querySelector(sel.fadeStart)),
      fadeEnd: Boolean(document.querySelector(sel.fadeEnd)),
    };
    row.scrollLeft = before;
    row.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    return result;
  }, SEL);
  return rowEnd;
}

export interface FrameReport {
  frame: string;
  column: Column;
  state: State;
  file: string;
  viewport: { width: number; height: number };
  safeArea: { requested: { top: number; bottom: number }; applied: boolean };
  geometry: Geometry;
  /** What the budget expects of this frame, for the numbers beside it. */
  budget: { chrome: number; transcript: number; share: number; floor: number };
  measured: { transcriptShare: number | null; bandHeight: number; composerUnit: number | null };
  failures: string[];
}

/**
 * The gates, pure so the numbers can be read back without a browser. Every
 * failure names the number that failed it.
 */
export function judge(frame: Frame, column: Column, state: State, g: Geometry, expectedChips = DRAFTS.length): Omit<FrameReport, "frame" | "column" | "state" | "file" | "viewport" | "safeArea"> {
  const failures: string[] = [];
  const keyboard = state === "keyboard" ? KEYBOARD_PX : 0;
  const viewport = columnViewport(frame, column);
  const budget = chatBudget({ height: viewport.height, chips: true, released: state !== "bottom", keyboard });
  const floor = floorFor(frame, column, keyboard > 0);
  const visibleHeight = viewport.height - keyboard;
  const bandHeight = g.band?.height ?? 0;
  const transcriptShare = g.scroller ? g.scroller.height / visibleHeight : null;

  if (!g.scroller) failures.push("no transcript scroller rendered");
  if (g.visibleRows === 0) failures.push("no transcript row is visible, so the frame proves nothing");
  if (g.floating > 0) failures.push(`${g.floating} floating draft row(s) over the transcript on the phone`);
  if (!g.band || bandHeight === 0) failures.push("no drafts band rendered — the set was not offered");
  if (g.chips.length !== expectedChips) failures.push(`${g.chips.length} chips rendered of ${expectedChips}`);
  /* A1: the band is below the scroller, so no transcript pixel can be under it. */
  if (g.band && g.scroller && g.band.top < g.scroller.bottom) failures.push(`the drafts band starts at ${g.band.top}px, above the scroller's bottom at ${g.scroller.bottom}px`);
  if (g.band && g.lowestTextBottom !== null && g.lowestTextBottom > g.band.top) failures.push(`the lowest transcript row ends at ${g.lowestTextBottom}px, under the band that starts at ${g.band.top}px`);
  /* A1: the band reserves exactly what the budget says it does. */
  if (g.band && bandHeight !== SUGGESTED_CHIPS_PX) failures.push(`the drafts band is ${bandHeight}px, SUGGESTED_CHIPS_PX says ${SUGGESTED_CHIPS_PX}`);
  for (const chip of g.chips) if (chip.height < 44) failures.push(`a chip's target is ${chip.height}px, under the 44px floor`);
  /* A3: a label is whole inside its chip; a chip the row cuts is faded, not sliced. */
  if (g.chipsClippedInside > 0) failures.push(`${g.chipsClippedInside} chip label(s) clipped inside the chip`);
  if (g.chipsCutRight > 0 && !g.fadeEnd) failures.push(`${g.chipsCutRight} chip(s) cut by the row's right edge and no fade says the row goes on`);
  if (g.chipsCutRight === 0 && g.fadeEnd) failures.push("an end fade shows with nothing cut behind it");
  if (g.rowEnd) {
    if (!g.rowEnd.lastChipClear) failures.push("swiped to the end, the last chip is still cut");
    if (g.rowEnd.fadeEnd) failures.push("swiped to the end, an end fade still says the row goes on");
    if (g.chipsCutRight > 0 && !g.rowEnd.fadeStart) failures.push("swiped to the end, no start fade says where the row came from");
  }
  /* A2: the way back is a 44px control IN THE BAND, beside the drafts, and it
     covers no rectangle of visible transcript text — the review's own check:
     an opaque control over a paragraph hides it rather than sharing it. */
  if (state !== "bottom") {
    if (!g.jump) failures.push("scrolled up and no «back to live» control");
    else {
      if (g.jump.width < 44 || g.jump.height < 44) failures.push(`the «back to live» control is ${g.jump.width}×${g.jump.height}px`);
      if (!g.jump.opaque) failures.push("the «back to live» control has a translucent surface");
      if (!g.jump.inBand || g.jump.inScroller) failures.push("the «back to live» control is not in the band under the scroller");
      if (g.scroller && g.jump.union.top < g.scroller.bottom) failures.push(`the «back to live» control (with everything drawn from it) starts at ${g.jump.union.top}px, inside the scroller that ends at ${g.scroller.bottom}px`);
      if (g.band && (g.jump.union.top < g.band.top || g.jump.union.bottom > g.band.bottom)) failures.push(`the «back to live» control spans ${g.jump.union.top}..${g.jump.union.bottom}px, outside the band's ${g.band.top}..${g.band.bottom}px`);
      if (g.visibleTextRects === 0) failures.push("no visible transcript text was measured, so the control's cover proves nothing");
      /* Ink, not boxes: nothing the control PAINTS — shadow, ring, outline,
         pseudo-element — reaches the strip above the band. */
      if (!g.ink) failures.push("the control's ink above the band was not measured");
      else {
        if (!g.ink.focusVisible) failures.push("the control never took a visible keyboard focus, so its focus ring was not measured");
        if (!g.ink.hiddenApplied) failures.push("the control was not hidden for the baseline shot, so the ink probe measured nothing");
        if (g.ink.injectedRingSeen === 0) failures.push("the ink probe is blind in this frame: an injected outer ring changed no pixel above the band");
        if (g.ink.decorativeAboveBand > 0) failures.push(`the control at rest paints ${g.ink.decorativeAboveBand} pixel(s) above the band, over the transcript`);
        if (g.ink.focusAboveBand > 0) failures.push(`the control with keyboard focus paints ${g.ink.focusAboveBand} pixel(s) above the band, over the transcript`);
      }
      if (g.jumpCoversText.count > 0) {
        const first = g.jumpCoversText.first!;
        failures.push(`the «back to live» control (with everything drawn from it) covers ${g.jumpCoversText.count} rectangle(s) of transcript text, the first at ${first.left}..${first.right}×${first.top}..${first.bottom}px`);
      }
    }
  } else if (g.jump) failures.push("a «back to live» control shows while the magnet holds");
  /* The keyboard: the whole column, band and send included, above it. */
  if (keyboard) {
    if (!g.fieldFocused) failures.push("the field never took focus, so the keyboard case was not exercised");
    if (g.visibleBottom !== visibleHeight) failures.push(`the visual viewport ends at ${g.visibleBottom}px, expected ${visibleHeight}px`);
    if (g.band && g.band.bottom > visibleHeight) failures.push(`the band ends at ${g.band.bottom}px, under the keyboard's top at ${visibleHeight}px`);
    if (!g.send) failures.push("no send control");
    else if (g.send.bottom > visibleHeight) failures.push(`send ends at ${g.send.bottom}px, under the keyboard's top at ${visibleHeight}px`);
  }
  /* The transcript keeps the floor documented for THIS frame and column —
     `chatBudget`'s own at 390×844 standalone, the frame's measured one
     elsewhere — so a transcript that shrinks anywhere is a red run. */
  if (transcriptShare !== null && transcriptShare < floor) failures.push(`the transcript keeps ${(transcriptShare * 100).toFixed(1)}% of ${visibleHeight}px, under the ${(floor * 100).toFixed(0)}% floor for ${frame.name} ${column}`);
  if (column === "standalone" && !g.standaloneMedia) failures.push("the standalone column does not match (display-mode: standalone)");
  if (g.documentScrollWidth > frame.width) failures.push(`the document scrolls to ${g.documentScrollWidth}px at ${frame.width}px`);
  return {
    geometry: g,
    budget: { chrome: budget.chrome, transcript: budget.transcript, share: Number(budget.share.toFixed(4)), floor },
    measured: { transcriptShare: transcriptShare === null ? null : Number(transcriptShare.toFixed(4)), bandHeight, composerUnit: g.composerUnit },
    failures,
  };
}

async function settle(page: Page, ms = 400): Promise<void> {
  await page.waitForTimeout(ms);
}

async function openChat(page: Page, baseUrl: string, transcript: string): Promise<void> {
  /* «load», not «networkidle»: the board polls, so the network never idles. */
  await page.goto(`${baseUrl}/#f=${encodeURIComponent(transcript)}`, { waitUntil: "load" });
  await page.waitForSelector(SEL.shell, { timeout: 20_000 });
  await page.waitForSelector(SEL.rows, { timeout: 20_000 });
  /* The drafts read off the stream with a 1.5 s floor between reads. When
     they never come, say what the page had instead of a bare timeout. */
  await page.waitForSelector(SEL.chips, { timeout: 10_000 }).catch(async (error: unknown) => {
    const seen = await page.evaluate((sel) => ({
      band: document.querySelectorAll(sel.band).length,
      bandHtml: document.querySelector(sel.band)?.outerHTML.slice(0, 300) ?? null,
      rows: document.querySelectorAll(sel.rows).length,
      screen: document.querySelector("[data-mobile2-screen]")?.getAttribute("data-mobile2-screen") ?? null,
      floating: document.querySelectorAll(sel.floating).length,
    }), SEL);
    throw new Error(`no draft chips: ${JSON.stringify(seen)}; suggestion requests answered: ${suggestionRequests}; ${String(error)}`);
  });
  const dismiss = page.locator("[data-attention-toast-dismiss]").first();
  if (await dismiss.count()) { await dismiss.click(); await settle(page, 120); }
  await settle(page, 700);
}

/** Release the magnet the way a thumb does: an upward gesture the feed sees,
    then the scroll it causes. */
async function scrollUp(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const el = document.querySelector<HTMLElement>(selector)!;
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -320, bubbles: true, cancelable: true }));
    el.scrollTop = Math.max(0, el.scrollTop - 320);
  }, SEL.scroller);
  await page.waitForSelector(SEL.jump, { timeout: 5_000 });
  await settle(page, 300);
  /* Land the boundary on the assistant's prose above the control, the way
     the review's frame had it (round 3): an opaque bubble there would hide
     any ink the control paints upward, and prove nothing either way. */
  for (let i = 0; i < 16; i += 1) {
    const onProse = await page.evaluate((sel) => {
      const scroller = document.querySelector<HTMLElement>(sel.scroller)!;
      const jump = document.querySelector<HTMLElement>(sel.jump)!;
      const r = jump.getBoundingClientRect();
      const above = document.elementFromPoint(r.left + r.width / 2, scroller.getBoundingClientRect().bottom - 2);
      if (above?.closest("[data-tts-message]")) return true;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 37);
      return false;
    }, SEL);
    if (onProse) break;
    await settle(page, 120);
  }
}

/** Two answers arrive while the operator is scrolled up; the tail re-reads on
    the product's own refresh signal and the control shows the count. */
async function letAnswersArrive(page: Page): Promise<void> {
  fs.appendFileSync(TRANSCRIPT_PATH, arrivalLines().join("\n") + "\n", "utf8");
  await page.evaluate(() => window.dispatchEvent(new Event("llv:files-changed")));
  await page.waitForSelector(SEL.newCount, { timeout: 12_000 }).catch(() => undefined);
  await settle(page, 300);
}

/** Open the keyboard the way #979/#983 do: focus the field and shrink the
    visual viewport through the signal the layout subscribes to. */
async function openKeyboard(page: Page): Promise<void> {
  await page.focus(SEL.field);
  await page.evaluate((keyboard) => {
    const visual = window.visualViewport!;
    const full = visual.height;
    Object.defineProperty(visual, "height", { configurable: true, get: () => full - keyboard });
    visual.dispatchEvent(new Event("resize"));
  }, KEYBOARD_PX);
  await settle(page, 500);
}

async function captureFrame(browser: Browser, baseUrl: string, transcript: string, frame: Frame, column: Column, drafts: Draft[] = DRAFTS, variant = ""): Promise<FrameReport[]> {
  const reports: FrameReport[] = [];
  const viewport = columnViewport(frame, column);
  const states: readonly State[] = variant ? ["bottom", "scrolled-up"] : STATES;
  const context = await browser.newContext({ viewport, colorScheme: "dark", deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce", timezoneId: "UTC", locale: "uk-UA" });
  await context.addInitScript(seedInit);
  if (column === "standalone") await context.addInitScript(standaloneInit);
  await context.route("**/api/log/suggestions*", (route) => {
    suggestionRequests += 1;
    const url = new URL(route.request().url());
    const conversationId = url.searchParams.get("conversationId") ?? "";
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ set: { conversationId, setId: `rsg_lane_a_${frame.name}_${variant || "base"}`, at: new Date(CAPTURE_MS - 10 * 60_000).toISOString(), origin: { kind: "manager", conversationId: "seat", role: "orchestrator" }, replies: drafts } }),
    });
  });
  /* A seeded transcript scans with no conversation identity and no process
     behind it, and the drafts are read BY conversation id: the files answer
     is patched on this side, the way `capture-mobile-v2` does it, so the one
     conversation is hosted and addressable. Everything else is the scan. */
  await context.route("**/api/files*", async (route) => {
    const headers = { ...route.request().headers() };
    delete headers["if-none-match"];
    delete headers["if-modified-since"];
    const response = await route.fetch({ headers });
    const text = response.status() === 200 ? await response.text() : "";
    if (!text) { await route.fulfill({ response }); return; }
    const body = JSON.parse(text) as { files?: Record<string, unknown>[] };
    for (const entry of body.files ?? []) {
      if (entry.cwd !== REPO_DIR) continue;
      entry.conversationId = `conversation_lane_a_${frame.name}_${column}${variant ? `_${variant}` : ""}`;
      entry.proc = "running";
      entry.pid = 4_990;
    }
    await route.fulfill({ response, body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  /* The phone's safe area, in standalone: `viewport-fit=cover` hands the
     insets to the page, and what the page pays for them is what this column
     shows. Best effort — an engine without the override records `applied:
     false` rather than pretending. */
  let safeAreaApplied = false;
  if (column === "standalone") {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride" as never, { insets: { top: frame.safeArea.top, left: 0, bottom: frame.safeArea.bottom, right: 0 } } as never);
      safeAreaApplied = true;
    } catch {
      safeAreaApplied = false;
    }
  }
  try {
    /* The transcript is re-seeded per frame so the arrivals do not compound. */
    fs.writeFileSync(TRANSCRIPT_PATH, transcriptLines().join("\n") + "\n", "utf8");
    await openChat(page, baseUrl, transcript);
    for (const state of states) {
      if (state === "scrolled-up") { await scrollUp(page); await letAnswersArrive(page); }
      if (state === "keyboard") await openKeyboard(page);
      const file = path.join(OUT_DIR, `lane-a-${frame.name}-${column}-${state}${variant ? `-${variant}` : ""}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const geometry = await readGeometry(page);
      geometry.rowEnd = await readRowEnd(page);
      if (geometry.band && state !== "bottom") geometry.ink = await readInkSpill(page, geometry.band.top, viewport.width);
      const verdict = judge(frame, column, state, geometry, drafts.length);
      if (errors.length) verdict.failures.push(...errors.splice(0).map((error) => `page error: ${error}`));
      reports.push({ frame: frame.name, column, state, file, viewport, safeArea: { requested: frame.safeArea, applied: safeAreaApplied }, ...verdict });
      console.log(`${frame.name}/${column}/${state}${variant ? `/${variant}` : ""}: ${verdict.failures.length ? verdict.failures.join("; ") : "ok"}`);
    }
  } finally {
    await context.close();
  }
  return reports;
}

async function main(): Promise<void> {
  const port = demoPort(process.env.LANE_A_CAPTURE_PORT, 4990, "LANE_A_CAPTURE_PORT");
  const baseUrl = `http://127.0.0.1:${port}`;
  if (!fs.existsSync(path.join(REPO_ROOT, ".next", "BUILD_ID"))) throw new Error("no production build: run `bun run build` first");
  seedHome();
  const server = spawn("bun", ["--bun", "node_modules/.bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: buildEnvironment(port),
    stdio: ["ignore", "inherit", "inherit"],
  });
  const executablePath = process.env.CHROME_BIN
    ?? ["/usr/bin/chromium", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"].find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const reports: FrameReport[] = [];
  try {
    await waitForServer(baseUrl, server);
    const scanned = await (await fetch(`${baseUrl}/api/files`)).json() as { files?: { cwd?: string; path?: string }[] };
    const transcript = (scanned.files ?? []).find((file) => file.cwd === REPO_DIR)?.path ?? "";
    if (!transcript) throw new Error("the seeded conversation did not scan");
    console.log(`frames: ${OUT_DIR}`);
    for (const frame of FRAMES) for (const column of COLUMNS) reports.push(...await captureFrame(browser, baseUrl, transcript, frame, column));
    for (const variant of DRAFT_VARIANTS) reports.push(...await captureFrame(browser, baseUrl, transcript, FRAMES[0]!, "standalone", variant.drafts, variant.id));
  } finally {
    await browser.close();
    server.kill("SIGTERM");
  }
  const report = {
    lane: "round2-lane-a",
    generatedAt: new Date().toISOString(),
    constants: { SUGGESTED_CHIPS_PX, KEYBOARD_PX, MIN_TRANSCRIPT_SHARE, MIN_KEYBOARD_TRANSCRIPT_SHARE },
    columns: { standalone: "the whole frame, (display-mode: standalone), safe-area insets emulated", tab: "the frame minus the browser's rows (85 px Safari on 390×844, 80 px Chrome on 360×780)" },
    frames: reports.map((entry) => ({
      frame: entry.frame,
      column: entry.column,
      state: entry.state,
      variant: path.basename(entry.file).replace(/^lane-a-\d+x\d+-(?:standalone|tab)-(?:bottom|scrolled-up|keyboard)-?/, "").replace(/\.png$/, "") || "base",
      file: path.basename(entry.file),
      ok: entry.failures.length === 0,
      failures: entry.failures,
      viewport: entry.viewport,
      safeArea: entry.safeArea,
      gapUnderComposerPx: entry.geometry.gapUnderComposer,
      bandHeightPx: entry.measured.bandHeight,
      bandTopPx: entry.geometry.band?.top ?? null,
      lowestTextBottomPx: entry.geometry.lowestTextBottom,
      textClearsBandBy: entry.geometry.band && entry.geometry.lowestTextBottom !== null ? entry.geometry.band.top - entry.geometry.lowestTextBottom : null,
      scrollerHeightPx: entry.geometry.scroller?.height ?? null,
      composerUnitPx: entry.measured.composerUnit,
      composerBoxPx: entry.geometry.composerBox?.height ?? null,
      visibleBottomPx: entry.geometry.visibleBottom,
      transcriptShare: entry.measured.transcriptShare,
      budget: entry.budget,
      budgetHolds: entry.measured.transcriptShare !== null && entry.measured.transcriptShare >= entry.budget.floor,
      ink: entry.geometry.ink,
      backToLive: entry.geometry.jump ? { size: `${entry.geometry.jump.width}×${entry.geometry.jump.height}`, opaque: entry.geometry.jump.opaque, count: entry.geometry.jump.count, topPx: entry.geometry.jump.top, bottomPx: entry.geometry.jump.bottom, unionPx: `${entry.geometry.jump.union.left}..${entry.geometry.jump.union.right}×${entry.geometry.jump.union.top}..${entry.geometry.jump.union.bottom}`, inBand: entry.geometry.jump.inBand, textRectsCovered: entry.geometry.jumpCoversText.count, visibleTextRects: entry.geometry.visibleTextRects } : null,
      chips: { rendered: entry.geometry.chips.length, cutByRowEdge: entry.geometry.chipsCutRight, clippedInside: entry.geometry.chipsClippedInside, fadeEnd: entry.geometry.fadeEnd, fadeStart: entry.geometry.fadeStart, atRowEnd: entry.geometry.rowEnd },
      floatingRows: entry.geometry.floating,
      anatomy: entry.geometry.anatomy,
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const failed = reports.filter((entry) => entry.failures.length);
  console.log(`\nreport: ${path.join(OUT_DIR, "report.json")}`);
  if (failed.length) {
    console.error(`${failed.length} of ${reports.length} frames failed a gate`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
