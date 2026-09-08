import type { FeedEntry, Item } from "./parse";

/**
 * Whether the item at `index` opens an agent turn (TZ-UI.md stage 1): the
 * first header-bearing item after operator input, so the mobile feed shows
 * who/model/account exactly once per turn instead of on every row.
 *
 * A turn is a run of agent-side items between operator inputs. Only the kinds
 * that render a substantial block carry the header; quiet chrome (reasoning
 * folds, service rows, relay notes) neither takes the header nor ends a run.
 * A `sysmsg`/`compact` boundary also opens a new turn: what follows it was
 * produced under different context.
 *
 * Pure and index-local like `speakableAnswer` — computed per visible row in
 * the LogFeed map, so virtualization and scroll anchoring stay untouched.
 */
const HEAD_KINDS = new Set<Item["kind"]>(["prose", "tool", "cmd-group"]);
const BREAK_KINDS = new Set<Item["kind"]>(["user", "voice", "mandate", "sysmsg", "compact"]);

export function isTurnHead(entries: readonly FeedEntry[], index: number): boolean {
  const item = entries[index]?.item;
  if (!item || !HEAD_KINDS.has(item.kind)) return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = entries[i]!.item;
    if (BREAK_KINDS.has(prev.kind)) return true;
    if (HEAD_KINDS.has(prev.kind)) {
      /* An engine flip inside one run (a relayed foreign answer) re-opens the
         header; engines are only known on prose items. */
      return item.kind === "prose" && prev.kind === "prose" && prev.engine !== item.engine;
    }
    /* think / svc / tnote / notes / images…: turn members, keep walking. */
  }
  return true;
}

/**
 * Whether the item at `index` is the first PROSE of its turn — where a room's
 * own signature goes (the HQ room's name and avatar above the answer).
 *
 * Not the same question as {@link isTurnHead}. A turn opens on whatever agent
 * item comes first, and for HQ that is routinely a tool row: it lists agents or
 * takes a board snapshot before it says anything. A signature over that row
 * names nobody's words, and head-only would leave most of HQ's answers with no
 * signature at all. So the boundaries are the turn's — computed by the same
 * walk — and the signature lands on the first thing in it that is text.
 *
 * Pure and index-local like {@link isTurnHead}: computed per visible row in the
 * LogFeed map, so virtualization and scroll anchoring stay untouched.
 */
export function firstProseOfTurn(entries: readonly FeedEntry[], index: number): boolean {
  const item = entries[index]?.item;
  if (!item || item.kind !== "prose") return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = entries[i]!.item;
    /* Operator input (or a context break) starts a turn: nothing before this
       point belongs to it, so this block is its first words. */
    if (BREAK_KINDS.has(prev.kind)) return true;
    /* Earlier words in the SAME turn already carry the signature — unless the
       engine flipped, which `isTurnHead` treats as a new turn and so does this. */
    if (prev.kind === "prose") return prev.engine !== item.engine;
    /* Tool rows, command groups and quiet chrome: turn members that are not
       words, so keep walking back. */
  }
  return true;
}
