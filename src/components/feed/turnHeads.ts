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
