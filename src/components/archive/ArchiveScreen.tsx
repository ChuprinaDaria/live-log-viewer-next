"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "@/components/mobile/MobileShell";
import { useLocale } from "@/lib/i18n";
import type { ArchiveCard } from "@/lib/archive/sessionmemArchive";

import { ArchiveCardView } from "./ArchiveCardView";
import { groupArchive } from "./archiveModel";

/*
 * The archive of sessions (task 9), the operator's own words: «окремо — архів
 * сесій, підписаних машина / проєкт; тицяєш акордеон — коротке самарі, за
 * бажанням повний транскрипт; не треба звалища старих сесій у дашборді».
 *
 * So: machine, then project, then one <details> per session — never a list of
 * raw old sessions. Everything shown here was written by sessionmem; when it
 * has no card for a session the card says so instead of inventing one.
 */

/** «Архів ще не підключено.» means exactly one thing: the route answered 503
    NOT_INSTALLED because sessionmem is not on the machine. Every other failure
    says what actually happened. Returns the reason, not the sentence: `t` is a
    fresh closure on every render, so translating here would drag it into the
    load callback's deps and refetch the archive forever. */
export function archiveFailure(status: number, error: string | undefined): ArchiveFailure {
  if (status === 503 && error === "NOT_INSTALLED") return { notInstalled: true, text: "" };
  return { notInstalled: false, text: error ?? `HTTP ${status}` };
}

export interface ArchiveFailure { notInstalled: boolean; text: string }

export function ArchiveScreen({
  host, renderSheet, project, onOpenTranscript,
}: {
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
  /** Narrow to one console project; absent, the whole archive. */
  project?: string;
  /** The Viewer's resolver, when there is a Viewer above this screen. */
  onOpenTranscript?: (path: string) => void;
}) {
  const { t } = useLocale();
  const [cards, setCards] = useState<ArchiveCard[] | null>(null);
  /* How many sessions the archive actually holds for this filter. The list is
     capped, so «317» in the tree and 200 on screen is a difference the screen
     has to say out loud rather than swallow. */
  const [total, setTotal] = useState(0);
  /* Why it failed, not just that it did: «Архів ще не підключено.» is the
     answer to a 503 NOT_INSTALLED and to nothing else — a 500, a broken JSON
     body or a dead network told the operator to go install sessionmem, which
     is already installed. */
  const [failure, setFailure] = useState<ArchiveFailure | null>(null);

  const url = project ? `/api/archive?project=${encodeURIComponent(project)}` : "/api/archive";
  const load = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { cards?: ArchiveCard[]; total?: number; error?: string } | null;
      if (!response.ok) { setFailure(archiveFailure(response.status, body?.error)); return; }
      const page = body?.cards ?? [];
      setCards(page);
      setTotal(typeof body?.total === "number" ? body.total : page.length);
      setFailure(null);
    } catch (cause) {
      setFailure({ notInstalled: false, text: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupArchive(cards ?? []), [cards]);

  return (
    <MobileShell screen="archive" title={<MobileBarTitle>{t("archive.title")}</MobileBarTitle>} back host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-3 py-3" data-archive-screen>
        {failure ? (
          <p data-archive-failure className="text-body text-muted">
            {failure.notInstalled ? t("archive.unavailable") : failure.text}
          </p>
        )
          : cards === null ? <p className="text-body text-muted">{t("common.loading")}</p>
          : groups.length === 0 ? <p className="text-body text-muted">{t("archive.empty")}</p>
          : <>
            {cards.length < total ? (
              <p data-archive-showing className="text-label text-muted">{t("archive.showing", { shown: cards.length, total })}</p>
            ) : null}
            {groups.map((group) => (
              <section key={group.host} data-archive-host={group.host} className="flex flex-col gap-2">
                {/* A machine sessionmem could not name gets no heading rather
                    than an empty one. */}
                {group.host ? <h2 className="text-label font-bold uppercase tracking-wide text-muted">{group.host}</h2> : null}
                {group.projects.map((entry) => (
                  <div key={entry.project} data-archive-project={entry.project} className="flex flex-col gap-1">
                    <h3 className="text-body font-semibold text-secondary">{entry.project || t("desktop.unassigned")}</h3>
                    {entry.cards.map((card) => (
                      <ArchiveCardView key={card.sessionId} card={card} onOpenTranscript={onOpenTranscript} />
                    ))}
                  </div>
                ))}
              </section>
            ))}
          </>}
      </div>
    </MobileShell>
  );
}
