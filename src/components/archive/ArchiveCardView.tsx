"use client";

import { transcriptFocusHash } from "@/components/search/GlobalSearch";
import { fmtAge } from "@/components/utils";
import { useLocale } from "@/lib/i18n";
import type { ArchiveCard } from "@/lib/archive/sessionmemArchive";

/*
 * One archived session: shut, it is a title, an age and — when `claude
 * --resume` can still take it — one badge. Open, it is what sessionmem wrote
 * about it and a way to the full transcript.
 *
 * Split out of ArchiveScreen so the screen stays about grouping and fetching.
 */

export function ArchiveCardView({ card, onOpenTranscript }: {
  card: ArchiveCard;
  /** The Viewer's own resolver, threaded down from `DesktopHome`. Absent on
      the phone, where this screen is mounted straight off the tab bar with no
      Viewer above it — there the `#f=` assignment is still the way in. */
  onOpenTranscript?: (path: string) => void;
}) {
  const { t } = useLocale();
  const lists = [
    { label: t("archive.did"), items: card.did },
    { label: t("archive.broke"), items: card.broke },
    { label: t("archive.decided"), items: card.decided },
    { label: t("archive.left"), items: card.left },
  ].filter((row) => row.items.length > 0);

  return (
    <details data-archive-card={card.sessionId} className="rounded-[8px] border border-border bg-card px-2 py-1">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-body text-primary">
        <span className="min-w-0 flex-1 truncate">{card.title || card.sessionId}</span>
        {card.endedAt === null ? null : <span className="shrink-0 text-label text-muted">{fmtAge(card.endedAt)}</span>}
        {card.resumable ? (
          <span data-archive-resumable className="shrink-0 rounded-[6px] bg-success-soft px-1.5 text-label text-success">
            {t("archive.resumable")}
          </span>
        ) : null}
      </summary>

      <p data-archive-summary className="pt-1 text-body leading-snug text-secondary">
        {card.summary || <span className="text-muted">{t("archive.noCard")}</span>}
      </p>

      {lists.map((row) => (
        <div key={row.label} className="pt-1">
          <p className="text-label font-semibold text-muted">{row.label}</p>
          <ul className="list-disc pl-4 text-body text-secondary">
            {/* Position, not text: sessionmem repeats a bullet often enough
                («переписали SQL» twice in one session) that keying by the
                string collapses the duplicates out of the list. */}
            {row.items.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      ))}

      {/* Always live. `/api/files` is a recency-capped BOARD budget, so most
          archived transcripts are absent from it while sitting right here on
          disk — gating the button on that feed disabled it for nearly every
          card. Either way the path reaches the Viewer's own resolver, whose pin
          ride-along fetches a transcript outside the feed; one that is really
          gone gets the Viewer's stale-focus notice, which is its job, not
          this button's guess. The callback also handles the case the bare hash
          cannot: a tab already standing on that exact `#f=` fires no
          hashchange, so the assignment would open nothing. */}
      <button
        type="button"
        data-archive-transcript={card.sessionId}
        onClick={() => {
          const path = card.transcriptPath;
          if (!path) return;
          if (onOpenTranscript) onOpenTranscript(path);
          else window.location.hash = transcriptFocusHash(path);
        }}
        className="mt-1.5 inline-flex h-8 items-center rounded-[8px] border border-border px-2 text-label font-semibold text-secondary hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t("archive.transcript")}
      </button>
    </details>
  );
}
