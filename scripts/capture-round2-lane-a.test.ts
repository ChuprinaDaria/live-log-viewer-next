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
    jump: { ...rect(333, 308, 377, 352), opaque: true, count: "2", inBand: true, inScroller: false, union: rect(333, 308, 377, 352) },
    visibleTextRects: 40,
    jumpCoversText: { count: 0, first: null },
    floating: 0,
    composerBox: rect(17, 397, 373, 501),
    composerUnit: 156,
    gapUnderComposer: 7,
    standaloneMedia: true,
    ink: { decorativeAboveBand: 0, focusAboveBand: 0, focusVisible: true, hiddenApplied: true, injectedRingSeen: 180, strip: { top: 302, height: 6, width: 390 }, probe: { bandSeen: 900, stripFollowsScroll: 400, aboveControl: "span", wrapperBackground: "rgba(0, 0, 0, 0) pos=relative z=auto" } },
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
  g.jump = { ...rect(333, 252, 377, 296), opaque: true, count: "2", inBand: false, inScroller: true, union: rect(333, 248, 381, 296) };
  g.jumpCoversText = { count: 3, first: rect(338, 268, 347, 282) };
  const failures = judge(frame, "standalone", "keyboard", g).failures;
  expect(failures.some((f) => f.includes("covers 3 rectangle(s) of transcript text"))).toBe(true);
  expect(failures.some((f) => f.includes("not in the band under the scroller"))).toBe(true);
  expect(failures.some((f) => f.includes("inside the scroller that ends at 308px"))).toBe(true);
});

test("an opaque surface and a 44px size do not excuse a control over text", () => {
  const g = green();
  g.jump = { ...rect(333, 252, 377, 296), opaque: true, count: null, inBand: false, inScroller: true, union: rect(333, 252, 377, 296) };
  g.jumpCoversText = { count: 1, first: rect(342, 268, 351, 282) };
  expect(judge(frame, "standalone", "scrolled-up", g).failures.some((f) => f.includes("covers 1 rectangle(s)"))).toBe(true);
});

test("round 2 of the review: the button in the band, its count badge three pixels over the transcript", () => {
  const g = green();
  /* The reviewer's numbers: the button at 333..377 × 308..352, the `-top-1`
     badge at 362..380 × 305..323, and the visible box of an «s» in an inline
     path at 362.15..371.20 × 297..308 — the badge wins elementFromPoint. */
  g.jump = { ...rect(333, 308, 377, 352), opaque: true, count: "2", inBand: true, inScroller: false, union: rect(333, 305, 380, 352) };
  g.jumpCoversText = { count: 1, first: rect(362, 297, 371, 308) };
  const failures = judge(frame, "standalone", "keyboard", g).failures;
  expect(failures.some((f) => f.includes("(with everything drawn from it) covers 1 rectangle(s)"))).toBe(true);
  expect(failures.some((f) => f.includes("starts at 305px, inside the scroller that ends at 308px"))).toBe(true);
  expect(failures.some((f) => f.includes("spans 305..352px, outside the band's 308..352px"))).toBe(true);
  /* The count as a cell of the pill: the union IS the button, and it passes. */
  const fixed = green();
  fixed.jump = { ...rect(303, 308, 377, 352), opaque: true, count: "2", inBand: true, inScroller: false, union: rect(303, 308, 377, 352) };
  expect(judge(frame, "standalone", "keyboard", fixed).failures).toEqual([]);
});

test("round 3 of the review: ink the boxes never saw — a focus ring two pixels over the letters", () => {
  /* The reviewer's numbers: the control's box and union at 644..688, the
     ring painting at 642..644 over «л» (636..653): 63 text pixels touched. */
  const g = green();
  g.ink = { decorativeAboveBand: 0, focusAboveBand: 63, focusVisible: true, hiddenApplied: true, injectedRingSeen: 180, strip: { top: 638, height: 6, width: 390 }, probe: { bandSeen: 900, stripFollowsScroll: 400, aboveControl: "span", wrapperBackground: "rgba(0, 0, 0, 0) pos=relative z=auto" } };
  expect(judge(frame, "standalone", "scrolled-up", g).failures).toContain("the control with keyboard focus paints 63 pixel(s) above the band, over the transcript");
  const shadow = green();
  shadow.ink = { decorativeAboveBand: 12, focusAboveBand: 12, focusVisible: true, hiddenApplied: true, injectedRingSeen: 180, strip: { top: 302, height: 6, width: 390 }, probe: { bandSeen: 900, stripFollowsScroll: 400, aboveControl: "span", wrapperBackground: "rgba(0, 0, 0, 0) pos=relative z=auto" } };
  expect(judge(frame, "standalone", "keyboard", shadow).failures).toContain("the control at rest paints 12 pixel(s) above the band, over the transcript");
  const unfocused = green();
  unfocused.ink = { decorativeAboveBand: 0, focusAboveBand: 0, focusVisible: false, hiddenApplied: true, injectedRingSeen: 180, strip: { top: 302, height: 6, width: 390 }, probe: { bandSeen: 900, stripFollowsScroll: 400, aboveControl: "span", wrapperBackground: "rgba(0, 0, 0, 0) pos=relative z=auto" } };
  expect(judge(frame, "standalone", "keyboard", unfocused).failures.some((f) => f.includes("never took a visible keyboard focus"))).toBe(true);
  /* A probe that cannot see an injected outer ring clears nothing. */
  const blind = green();
  blind.ink = { decorativeAboveBand: 0, focusAboveBand: 0, focusVisible: true, hiddenApplied: true, injectedRingSeen: 0, strip: { top: 302, height: 6, width: 390 }, probe: { bandSeen: 900, stripFollowsScroll: 400, aboveControl: "span", wrapperBackground: "rgba(0, 0, 0, 0) pos=relative z=auto" } };
  expect(judge(frame, "standalone", "keyboard", blind).failures.some((f) => f.includes("the ink probe is blind in this frame"))).toBe(true);
  const notHidden = green();
  notHidden.ink = { decorativeAboveBand: 0, focusAboveBand: 0, focusVisible: true, hiddenApplied: false, injectedRingSeen: 180, strip: { top: 302, height: 6, width: 390 }, probe: { bandSeen: 900, stripFollowsScroll: 400, aboveControl: "span", wrapperBackground: "rgba(0, 0, 0, 0) pos=relative z=auto" } };
  expect(judge(frame, "standalone", "keyboard", notHidden).failures.some((f) => f.includes("was not hidden for the baseline shot"))).toBe(true);
  const unmeasured = green();
  unmeasured.ink = null;
  expect(judge(frame, "standalone", "keyboard", unmeasured).failures).toContain("the control's ink above the band was not measured");
});

test("the PNG decoder and the pixel diff read what a screenshot holds", async () => {
  const { decodePng, differingPixels } = await import("./capture-round2-lane-a");
  /* A 2×1 RGBA PNG: one red pixel, one blue, filter 0 — and the same with the
     second pixel turned green. Written by hand with node's own deflate so the
     decoder is checked against something it did not produce. */
  const { deflateSync } = await import("node:zlib");
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const png = (second: number[]) => {
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const raw = Buffer.from([0, 255, 0, 0, 255, ...second]);
    return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  };
  const a = decodePng(png([0, 0, 255, 255]));
  const b = decodePng(png([0, 255, 0, 255]));
  expect([a.width, a.height, a.channels]).toEqual([2, 1, 4]);
  expect([...a.pixels]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  expect(differingPixels(a, a)).toBe(0);
  expect(differingPixels(a, b)).toBe(1);
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
      g.jump = { ...rect(333, 97, 377, 141), opaque: true, count: null, inBand: true, inScroller: false, union: rect(333, 97, 377, 141) };
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
