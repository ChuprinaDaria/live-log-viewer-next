"use client";

import { transcriptFocusHash } from "@/components/search/GlobalSearch";
import { fmtAge } from "@/components/utils";
import { useLocale } from "@/lib/i18n";
import type { ArchiveCard } from "@/lib/archive/sessionmemArchive";
import type { FileEntry } from "@/lib/types";

/*
 * One archived session: shut, it is a title, an age and — when `claude
 * --resume` can still take it — one badge. Open, it is what sessionmem wrote
 * about it and a way to the full transcript.
 *
 * Split out of ArchiveScreen so the screen stays about grouping and fetching.
 */

export function ArchiveCardView({ card, files }: { card: ArchiveCard; files: readonly FileEntry[] }) {
  const { t } = useLocale();
  /* The deep link resolves against the Viewer's own catalog, so a transcript
     that is not in it cannot be opened — a card pulled from another machine
     says so instead of offering a button that would land nowhere. */
  const local = card.transcriptPath ? files.some((file) => file.path === card.transcriptPath) : false;
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
            {row.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}

      <button
        type="button"
        data-archive-transcript={card.sessionId}
        disabled={!local}
        title={local ? undefined : t("archive.transcriptElsewhere")}
        onClick={() => { if (card.transcriptPath) window.location.hash = transcriptFocusHash(card.transcriptPath); }}
        className="mt-1.5 inline-flex h-8 items-center rounded-[8px] border border-border px-2 text-label font-semibold text-secondary hover:border-accent/45 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t("archive.transcript")}
      </button>
    </details>
  );
}
