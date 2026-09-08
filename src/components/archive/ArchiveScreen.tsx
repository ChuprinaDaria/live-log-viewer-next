"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "@/components/mobile/MobileShell";
import { useFiles } from "@/hooks/useFiles";
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

export function ArchiveScreen({
  host, renderSheet, project,
}: {
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
  /** Narrow to one console project; absent, the whole archive. */
  project?: string;
}) {
  const { t } = useLocale();
  const [cards, setCards] = useState<ArchiveCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  /* The catalog the deep link resolves against: it decides whether a card's
     transcript can be opened on this machine at all. */
  const { files } = useFiles();

  const url = project ? `/api/archive?project=${encodeURIComponent(project)}` : "/api/archive";
  const load = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) { setFailed(true); return; }
      const body = await response.json() as { cards?: ArchiveCard[] };
      setCards(body.cards ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => groupArchive(cards ?? []), [cards]);

  return (
    <MobileShell screen="archive" title={<MobileBarTitle>{t("archive.title")}</MobileBarTitle>} back host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-3 py-3" data-archive-screen>
        {failed ? <p className="text-body text-muted">{t("archive.unavailable")}</p>
          : cards === null ? <p className="text-body text-muted">{t("common.loading")}</p>
          : groups.length === 0 ? <p className="text-body text-muted">{t("archive.empty")}</p>
          : groups.map((group) => (
              <section key={group.host} data-archive-host={group.host} className="flex flex-col gap-2">
                <h2 className="text-label font-bold uppercase tracking-wide text-muted">{group.host}</h2>
                {group.projects.map((entry) => (
                  <div key={entry.project} data-archive-project={entry.project} className="flex flex-col gap-1">
                    <h3 className="text-body font-semibold text-secondary">{entry.project || t("desktop.unassigned")}</h3>
                    {entry.cards.map((card) => (
                      <ArchiveCardView key={card.sessionId} card={card} files={files} />
                    ))}
                  </div>
                ))}
              </section>
            ))}
      </div>
    </MobileShell>
  );
}
