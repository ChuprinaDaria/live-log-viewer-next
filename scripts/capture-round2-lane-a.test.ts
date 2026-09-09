import { expect, test } from "bun:test";

import { DRAFT_VARIANTS, FRAMES, floorFor, judge, type Geometry } from "./capture-round2-lane-a";

/*
 * The gates of the round 2 lane A capture, each shown to go red — a check
 * whose red path nobody has seen is a claim, not a proof. The geometries here
 * are the review's own numbers (2026-09-09, 390×844 standalone, keyboard
 * open): the «back to live» control at 333..377 × 252..296 with the letters
 * of «чіпом?» centred at (342, 275), (351, 275), (361, 275) inside it.
 */

const frame = FRAMES[0]!;
const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

/** The keyboard frame as the fixed build renders it: the control in the band,
    every text rectangle above the band. */
function green(): Geometry {
  return {
    layout: { width: 390, height: 844 },
    visibleBottom: 508,
    scroller: rect(5, 57, 385, 308),
    lowestTextBottom: 308,
    visibleRows: 4,
    band: rect(5, 308, 385, 352),
    chipsRow: rect(17, 308, 321, 352),
    chips: [rect(17, 308, 160, 352), rect(166, 308, 330, 352), rect(336, 308, 480, 352), rect(486, 308, 640, 352)],
    chipsCutRight: 1,
    chipsClippedInside: 0,
    fadeEnd: true,
    fadeStart: false,
    rowEnd: { lastChipClear: true, fadeStart: true, fadeEnd: false },
    jump: { ...rect(333, 308, 377, 352), opaque: true, count: "2", inBand: true, inScroller: false },
    visibleTextRects: 40,
    jumpCoversText: { count: 0, first: null },
    floating: 0,
    composerBox: rect(17, 397, 373, 501),
    composerUnit: 156,
    gapUnderComposer: 7,
    standaloneMedia: true,
    send: rect(329, 453, 373, 497),
    fieldFocused: true,
    documentScrollWidth: 390,
    anatomy: [],
  };
}

test("the fixed keyboard frame passes every gate", () => {
  expect(judge(frame, "standalone", "keyboard", green()).failures).toEqual([]);
});

test("the review's reproduced case is red: the control floats over «чіпом?»", () => {
  const g = green();
  /* The control as it was — absolute in the scroller's corner — and the three
     letters under it, as glyph rectangles ~9 px wide on the 268..282 line. */
  g.jump = { ...rect(333, 252, 377, 296), opaque: true, count: "2", inBand: false, inScroller: true };
  g.jumpCoversText = { count: 3, first: rect(338, 268, 347, 282) };
  const failures = judge(frame, "standalone", "keyboard", g).failures;
  expect(failures.some((f) => f.includes("covers 3 rectangle(s) of transcript text"))).toBe(true);
  expect(failures.some((f) => f.includes("not in the band under the scroller"))).toBe(true);
  expect(failures.some((f) => f.includes("inside the scroller that ends at 308px"))).toBe(true);
});

test("an opaque surface and a 44px size do not excuse a control over text", () => {
  const g = green();
  g.jump = { ...rect(333, 252, 377, 296), opaque: true, count: null, inBand: false, inScroller: true };
  g.jumpCoversText = { count: 1, first: rect(342, 268, 351, 282) };
  expect(judge(frame, "standalone", "scrolled-up", g).failures.some((f) => f.includes("covers 1 rectangle(s)"))).toBe(true);
});

test("a frame with no measured text cannot prove the control covers none", () => {
  const g = green();
  g.visibleTextRects = 0;
  expect(judge(frame, "standalone", "keyboard", g).failures.some((f) => f.includes("proves nothing"))).toBe(true);
});

test("a label clipped inside its chip is red, whatever the row's fades say", () => {
  const g = green();
  g.chipsClippedInside = 1;
  expect(judge(frame, "standalone", "keyboard", g).failures).toContain("1 chip label(s) clipped inside the chip");
});

test("a deliberate regression of the transcript's height is red in every frame and column", () => {
  for (const f of FRAMES) {
    for (const column of ["standalone", "tab"] as const) {
      const g = green();
      g.scroller = rect(5, 57, 385, 97);
      g.band = rect(5, 97, 385, 141);
      g.jump = { ...rect(333, 97, 377, 141), opaque: true, count: null, inBand: true, inScroller: false };
      const failures = judge(f, column, "scrolled-up", g).failures;
      expect(failures.some((x) => x.includes(`under the ${(floorFor(f, column, false) * 100).toFixed(0)}% floor for ${f.name} ${column}`))).toBe(true);
    }
  }
});

test("the narrow frame carries its own measured floor, under the 390×844 one", () => {
  const narrow = FRAMES[1]!;
  expect(narrow.name).toBe("360x780");
  expect(floorFor(narrow, "standalone", false)).toBeLessThan(floorFor(frame, "standalone", false));
  expect(floorFor(narrow, "standalone", true)).toBeLessThan(floorFor(frame, "standalone", true));
  /* Just under the measured 67.1% / 42.1%, so the measurement itself passes
     and a 2-point loss does not. */
  expect(floorFor(narrow, "standalone", false)).toBe(0.67);
  expect(floorFor(narrow, "standalone", true)).toBe(0.42);
});

test("the band under the scroller and the text above it are still gated", () => {
  const g = green();
  g.band = rect(5, 300, 385, 344);
  expect(judge(frame, "standalone", "keyboard", g).failures.some((f) => f.includes("above the scroller's bottom"))).toBe(true);
  const h = green();
  h.band = rect(5, 308, 385, 340);
  expect(judge(frame, "standalone", "keyboard", h).failures.some((f) => f.includes("SUGGESTED_CHIPS_PX says"))).toBe(true);
});

test("the review's acceptance sets: one 64-character label and six mixed with RTL", () => {
  const long = DRAFT_VARIANTS.find((v) => v.id === "long")!;
  expect(long.drafts).toHaveLength(1);
  expect(long.drafts[0]!.label.length).toBeLessThanOrEqual(64);
  expect(long.drafts[0]!.label.length).toBeGreaterThanOrEqual(60);
  const mixed = DRAFT_VARIANTS.find((v) => v.id === "mixed")!;
  expect(mixed.drafts).toHaveLength(6);
  expect(mixed.drafts.some((d) => /[֐-׿؀-ۿ]/.test(d.label))).toBe(true);
});
