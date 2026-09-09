/**
 * The phone's viewport budget, rewritten for mobile v2
 * (docs/design/mobile-v2/README.md §3.4).
 *
 * The old model (issue #419) counted five persistent rows — shell header,
 * focus strip, conversation header, composer input row, composer pill row —
 * and proved the transcript kept 60% of an 844 px viewport. The arithmetic was
 * green while the operator's phone showed roughly half the screen as chrome,
 * because four rows that are ALSO always on were never in the sum: the docked
 * background-task strip, the attention banner, the subagent tray, and the
 * live-tail pill with the turn status bar under it (§1.6). A budget that omits
 * what is on screen measures nothing.
 *
 * v2 removes the omissions instead of counting them. Host detail moved behind
 * `⋯ › Host details`, the conversation header folded into the bar's title cell,
 * the strip is gone, and the composer, its model chip and the Stop control are
 * ONE unit (§2 rule 8) — so the band is two regions, and every region left in
 * it is one this module can name:
 *
 *   bar 52 + composer 109 + selected context 38 = 199 px  (76% transcript at 844)
 *   … + the banner slot 45                      = 244 px  (71%)
 *   … + suggested chips 44, keyboard 336        = 243 px of 508 visible (52%)
 *
 * Those are the three numbers §3.4 publishes, and `chatBudget.test.ts` is what
 * holds them. `MobileFocusView` stamps {@link MIN_TRANSCRIPT_SHARE} onto the
 * focus root, so the contract travels with the DOM it governs.
 *
 * Round 2 lane A (docs/ui-round2-spec.md) measured the rendered column —
 * `scripts/capture-round2-lane-a.ts`, production build, 390×844, standalone
 * and browser-tab columns — and found two things the sum above had wrong,
 * exactly the way #419's sum was wrong: a region on screen and not in it.
 *
 *   - The chips' row is its 44 px hit, in the flow of the column, not the
 *     pill's 32 px. The keyboard case published from 32 (315 px, 62%) was
 *     12 px too generous.
 *   - The composer FORM carries a `selected-context` row above the box —
 *     32 px plus its 6 px gap — on every focused conversation. The box itself
 *     measured 104 against the 109 counted here, so COMPOSER_PX stands; the
 *     38 px were never named, so they are now: {@link SELECTED_CONTEXT_PX}.
 *
 * What the phone actually showed (transcript / visible, chips up):
 *
 *   standalone  390×844  587 / 844 = 69.5%     keyboard  251 / 508 = 49.4%
 *   browser tab 390×759  502 / 759 = 66.1%     keyboard  166 / 423 = 39.2%
 *   standalone  360×780  523 / 780 = 67.1%     keyboard  187 / 444 = 42.1%
 *
 * The floors below are set from the standalone column, where the operator
 * uses the board (the tab column loses the browser's own rows on top, lane C's
 * subject). They read low because 38 px of them is a row lane H is expected to
 * take out of the operator's sight; when it does, the region goes to 0 here
 * and the floors go back up — by name, not by wish.
 */

/** The one bar (§3.2): back, title cell, at most three 44 px targets. */
export const BAR_PX = 52;
/** The composer unit (§2 rule 8, §3.4): one box holding the field (32) and the
    tools row (44) — chip, attach, dictate, send slot — plus its padding and the
    14 px home inset. The inset lives INSIDE this number, which is why the
    budget below subtracts no safe-area of its own. This is the unit at REST;
    `MOBILE_COMPOSER_UNIT_CHROME_PX` in `lib/composerScroll` is the same box
    counted from the other side — everything in these 109 px except the field —
    and it is what the grow ceiling reserves so a dictated field never pushes
    the tools row out of the box (#1483). */
export const COMPOSER_PX = 109;
/** The selected-context row the composer form renders ABOVE its box — the
    `data-selected-context` summary saying what the operator is looking at —
    32 px plus the form's 6 px gap, measured on the production build at 390×844
    in standalone (round 2 lane A, `scripts/capture-round2-lane-a.ts`). It is
    on screen for as long as a conversation is focused, so it is persistent
    chrome until lane H takes the prelude out of the operator's sight; then it
    is 0 here, by name. (The same measurement found no chat surface paying
    `env(safe-area-inset-bottom)`: the 14 px inset COMPOSER_PX describes is
    not spent by anything today, in either column.) */
export const SELECTED_CONTEXT_PX = 38;
/** The one banner slot under the bar (§2 rule 3): offline, degraded, or a
    decision that arrived elsewhere. It reserves its height in flow, so it is
    chrome for as long as it is up. */
export const BANNER_PX = 45;
/** Suggested-reply chips: 32 px pills inside a 44 px hit, ONE row directly
    above the composer box (§4.3), in the flow of the column — `LogFeed`'s
    `data-feed-drafts-band`. The row is exactly the hit tall and carries no
    margin, so the band reserves this and `scripts/capture-round2-lane-a.ts`
    measures it. They stay while the keyboard is open. */
export const SUGGESTED_CHIPS_PX = 44;
/** An iOS keyboard's share of a 390×844 phone (#983, §4.3). */
export const KEYBOARD_PX = 336;

/** Persistent chrome with a conversation focused: everything always on screen. */
export const PERSISTENT_CHROME = {
  bar: BAR_PX,
  composer: COMPOSER_PX,
  selectedContext: SELECTED_CONTEXT_PX,
} as const;

/**
 * The band v2 replaced, region by region (§3.4, "Today" column). These are the
 * five rows the #419 budget counted — 264 px — and they are kept here because
 * the surfaces that were measured against one of them still are: the retired
 * chip strip's 56 px is the ceiling the orchestrator pin must not exceed
 * (#1347), and a number cannot be a ceiling once nobody can name it.
 */
export const SUPERSEDED_CHROME = {
  /** Project shell header → the one 52 px bar. */
  shellHeader: 52,
  /** Conversation-switch strip → the bar's title cell and the switcher sheet. */
  focusStrip: 56,
  /** BranchPane's compact header row → folded into the title cell. */
  conversationHeader: 56,
  /** Composer input row → the composer unit's field. */
  composerPrimary: 56,
  /** The always-visible model/reasoning pill row (#499) → the chip INSIDE the
      box, which is the row the operator asked us to stop stacking. */
  composerRuntimePill: 44,
} as const;

/**
 * Persistent rows the old budget never counted (§1.6) — the difference between
 * "264 budgeted" and the "~440–480 observed" on the operator's screenshot.
 * Every one of them is 0 px in v2: tasks live in the host sheet, children open
 * from the feed, Stop is the send slot and elapsed time is the bar's meta line.
 * The arrival banner is the only survivor, at the slot's 45 px rather than 60,
 * and only while it is up.
 */
export const UNCOUNTED_CHROME = {
  /** One docked `TaskStrip` per parentless background process (§1.2). */
  dockedTaskStrip: 44,
  /** The in-flow attention toast (§1.9). */
  attentionBanner: 60,
  /** The inline subagent tray (§1.6). */
  subagentTray: 44,
  /** The live-tail pill plus the turn status bar (§1.6) — this lane's removal. */
  liveTailAndStatusBar: 40,
} as const;

/** The transcript's guaranteed share of the viewport, keyboard closed. The
    worst persistent case is the banner slot up: the budget says 244 of 844
    (71%), and the standalone measurement says 213 px of chrome without chips
    plus the 45 px slot = 586 of 844 (69.4%). The floor is what the measured
    case clears. It was 0.75 while the 38 px selected-context row was not in
    the sum; it goes back up when lane H removes that row. */
export const MIN_TRANSCRIPT_SHARE = 0.69;
/** The same guarantee with the keyboard open (§4.3): the budget says 265 of
    the 508 that are visible (52%), and the standalone measurement 251 (49.4%),
    with the whole question card inside them. The floor is the measured case.
    It was 0.6 from a sum that counted the chips at 32 px and no context row:
    12 px of chips and 38 px of the row are the whole difference. */
export const MIN_KEYBOARD_TRANSCRIPT_SHARE = 0.49;
/** The tab bar (TZ-UI.md): five labelled roots, at the bottom of the stack
    only. Chrome on a tab ROOT, 0 px on every pushed screen, and it yields to
    the keyboard, so it never rides the keyboard case. */
export const TAB_BAR_PX = 56;
/** The agents strip on the Чат tab: 44 px, only while the project has an
    agent to name and the keyboard is down. */
export const AGENTS_STRIP_PX = 44;
/** The transcript's floor on a TAB ROOT, keyboard closed: the worst persistent
    case is bar + strip + composer + context row + tab bar + banner = 344 of
    844 (59.2%). Not measured by the lane A capture (it renders a pushed
    conversation, which has no tab bar); set from the budget's own sum, with
    the same 38 px caveat as the floors above. */
export const MIN_TAB_ROOT_TRANSCRIPT_SHARE = 0.59;

export interface Viewport {
  /** Layout viewport height in CSS px (844 at iPhone 390×844). */
  height: number;
  /** The banner slot is showing something (offline, degraded, an arrival). */
  banner?: boolean;
  /** Suggested-reply chips ride above the composer box. */
  chips?: boolean;
  /** The on-screen keyboard's height, 0 (the default) while it is closed. */
  keyboard?: number;
  /** A tab root carries the tab bar (keyboard closed). */
  tabBar?: boolean;
  /** The Чат tab's agents strip is up. */
  agentsStrip?: boolean;
}

export interface ChatBudget {
  /** Viewport height minus whatever the keyboard covers. */
  readonly usable: number;
  /** Every region of chrome on screen, summed. */
  readonly chrome: number;
  /** Height left for the transcript, never negative. */
  readonly transcript: number;
  /** transcript / usable, clamped to [0, 1]. */
  readonly share: number;
  /** True when the transcript clears the guarantee for this keyboard state. */
  readonly meetsMinimum: boolean;
}

/** The transcript's height and share for one viewport and its chrome. */
export function chatBudget({ height, banner = false, chips = false, keyboard = 0, tabBar = false, agentsStrip = false }: Viewport): ChatBudget {
  const usable = Math.max(0, height - Math.max(0, keyboard));
  /* The tab bar and the strip both yield to the keyboard, so they count only while it is closed. */
  const roots = keyboard > 0 ? 0 : (tabBar ? TAB_BAR_PX : 0) + (agentsStrip ? AGENTS_STRIP_PX : 0);
  const chrome = BAR_PX + COMPOSER_PX + SELECTED_CONTEXT_PX + (banner ? BANNER_PX : 0) + (chips ? SUGGESTED_CHIPS_PX : 0) + roots;
  const transcript = Math.max(0, usable - chrome);
  const share = usable > 0 ? Math.min(1, transcript / usable) : 0;
  const floor = keyboard > 0 ? MIN_KEYBOARD_TRANSCRIPT_SHARE : tabBar ? MIN_TAB_ROOT_TRANSCRIPT_SHARE : MIN_TRANSCRIPT_SHARE;
  return { usable, chrome, transcript, share, meetsMinimum: share >= floor };
}
