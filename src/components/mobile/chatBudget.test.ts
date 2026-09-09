import { expect, test } from "bun:test";

import {
  BANNER_PX,
  BAR_PX,
  COMPOSER_PX,
  KEYBOARD_PX,
  MIN_KEYBOARD_TRANSCRIPT_SHARE,
  MIN_TRANSCRIPT_SHARE,
  PERSISTENT_CHROME,
  SELECTED_CONTEXT_PX,
  SUGGESTED_CHIPS_PX,
  SUPERSEDED_CHROME,
  UNCOUNTED_CHROME,
  chatBudget,
} from "./chatBudget";

/*
 * Mobile v2 lane 5 (#1439) — the viewport budget of README §3.4, held to its
 * published numbers. The table says 199 px of chrome, 244 with the banner, and
 * 76% / 71% / 52% of the transcript; nothing here restates the implementation,
 * every assertion is a number a reader can find in the design document.
 * (It said 161 / 206 and 81% / 76% / 62% until round 2 lane A measured the
 * rendered column: the chips' row is its 44 px hit, not the pill's 32, and
 * the composer form carries a 38 px selected-context row the sum never had.)
 */

test("the chrome band is the §3.4 total: 199 px, and 244 with the banner slot up", () => {
  expect(chatBudget({ height: 844 }).chrome).toBe(199);
  expect(chatBudget({ height: 844, banner: true }).chrome).toBe(244);
});

test("199 is the bar, the composer unit and the selected-context row, and nothing else is persistent", () => {
  /* Three regions, all nameable. A fourth row appearing in this sum is the
     #419 failure returning: chrome the budget counts but the design does not
     have — or, as with the context row, chrome the design has and the budget
     did not count. Either way it gets a name here first. */
  expect(Object.values(PERSISTENT_CHROME).reduce((a, b) => a + b, 0)).toBe(199);
  expect(BAR_PX + COMPOSER_PX + SELECTED_CONTEXT_PX).toBe(199);
  expect(BAR_PX + COMPOSER_PX + SELECTED_CONTEXT_PX + BANNER_PX).toBe(244);
  /* The row as measured on the production build: 32 px plus the form's 6 px gap. */
  expect(SELECTED_CONTEXT_PX).toBe(32 + 6);
});

test("at 390×844 the transcript keeps 76% of the viewport, and 71% under a banner", () => {
  const plain = chatBudget({ height: 844 });
  expect(plain.transcript).toBe(645);
  expect(Math.round(plain.share * 100)).toBe(76);
  expect(plain.meetsMinimum).toBe(true);

  const banner = chatBudget({ height: 844, banner: true });
  expect(banner.transcript).toBe(600);
  expect(Math.round(banner.share * 100)).toBe(71);
  expect(banner.meetsMinimum).toBe(true);
});

test("the guarantee is what the worst persistent case clears — the banner one, as measured", () => {
  /* The floor is not a wish: the banner case is the tightest chrome-closed
     screen there is, so it is what MIN_TRANSCRIPT_SHARE is set from — and it
     is set from the MEASURED chrome (213 px without chips, standalone
     390×844) plus the slot, which is 586 of 844. */
  expect(chatBudget({ height: 844, banner: true }).share).toBeGreaterThanOrEqual(MIN_TRANSCRIPT_SHARE);
  expect((844 - 213 - BANNER_PX) / 844).toBeGreaterThanOrEqual(MIN_TRANSCRIPT_SHARE);
  expect(MIN_TRANSCRIPT_SHARE).toBe(0.69);
});

test("the taller phone frame clears the same guarantee", () => {
  expect(chatBudget({ height: 932 }).meetsMinimum).toBe(true);
  expect(chatBudget({ height: 932, banner: true }).meetsMinimum).toBe(true);
});

test("keyboard open, the transcript keeps 265 px — 52% of the 508 that are visible", () => {
  const budget = chatBudget({ height: 844, chips: true, keyboard: KEYBOARD_PX });
  expect(budget.usable).toBe(508);
  expect(budget.chrome).toBe(243);
  expect(budget.transcript).toBe(265);
  expect(Math.round(budget.share * 100)).toBe(52);
  expect(budget.meetsMinimum).toBe(true);
  /* The floor is the MEASURED keyboard case, standalone 390×844: 251 of 508. */
  expect(MIN_KEYBOARD_TRANSCRIPT_SHARE).toBe(0.49);
  expect(251 / 508).toBeGreaterThanOrEqual(MIN_KEYBOARD_TRANSCRIPT_SHARE);
  expect(budget.share).toBeGreaterThanOrEqual(MIN_KEYBOARD_TRANSCRIPT_SHARE);
});

test("the suggested-reply chips are the 44 px hit of their row, and stay while the keyboard is open", () => {
  /* The row is the hit, not the pill: a 32 px number here would be the visual
     height of a chip inside a 44 px control, and a band that reserves 44. */
  expect(SUGGESTED_CHIPS_PX).toBe(44);
  const withChips = chatBudget({ height: 844, chips: true, keyboard: KEYBOARD_PX });
  const without = chatBudget({ height: 844, keyboard: KEYBOARD_PX });
  expect(without.transcript - withChips.transcript).toBe(SUGGESTED_CHIPS_PX);
});

test("each region only ever reduces the transcript, and by exactly its declared height", () => {
  const base = chatBudget({ height: 844 });
  expect(chatBudget({ height: 844, banner: true }).transcript).toBe(base.transcript - BANNER_PX);
  expect(chatBudget({ height: 844, chips: true }).transcript).toBe(base.transcript - SUGGESTED_CHIPS_PX);
  expect(chatBudget({ height: 844, keyboard: KEYBOARD_PX }).transcript).toBe(base.transcript - KEYBOARD_PX);
});

test("v2 reaches 161 from the 264 the old band budgeted, by name, and the context row rides on top", () => {
  /* 264 was green while the phone showed ~440–480 of chrome, so the arithmetic
     has to account for both halves: the rows v2 removed outright, and the rows
     it merged into the composer unit. The selected-context row is neither: it
     is a row the design has and the sum never counted, added by name. */
  const old = Object.values(SUPERSEDED_CHROME).reduce((a, b) => a + b, 0);
  expect(old).toBe(264);
  const removed = SUPERSEDED_CHROME.focusStrip + SUPERSEDED_CHROME.conversationHeader + SUPERSEDED_CHROME.composerRuntimePill;
  const merged = COMPOSER_PX - SUPERSEDED_CHROME.composerPrimary;
  expect(old - removed + merged).toBe(161);
  expect(old - removed + merged + SELECTED_CONTEXT_PX).toBe(199);
  expect(SUPERSEDED_CHROME.shellHeader).toBe(BAR_PX);
});

test("the rows the old budget never counted are all zero in v2", () => {
  /* Each of these was on screen and outside the sum (§1.6). They are absent
     from PERSISTENT_CHROME now because the design removed the surfaces, not
     because the budget stopped looking at them. */
  expect(Object.values(UNCOUNTED_CHROME).reduce((a, b) => a + b, 0)).toBe(188);
  const band = Object.values(PERSISTENT_CHROME) as number[];
  for (const height of Object.values(UNCOUNTED_CHROME)) expect(band).not.toContain(height);
  /* The observed band the operator photographed: 264 counted plus the docked
     strip, the toast, the tray, the pill and the status bar under it. */
  expect(264 + Object.values(UNCOUNTED_CHROME).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(440);
});

test("a degenerate viewport yields a zero share, never NaN", () => {
  const budget = chatBudget({ height: 0 });
  expect(budget.transcript).toBe(0);
  expect(budget.share).toBe(0);
  expect(budget.meetsMinimum).toBe(false);
});

test("a keyboard taller than the viewport leaves no transcript and fails the floor", () => {
  const budget = chatBudget({ height: 300, keyboard: 400 });
  expect(budget.usable).toBe(0);
  expect(budget.transcript).toBe(0);
  expect(budget.meetsMinimum).toBe(false);
});
