import type { ArchiveCard } from "@/lib/archive/sessionmemArchive";

/*
 * How the archive is read, as pure functions: machine → project → newest
 * first. That is the operator's own filing — «архів сесій, підписаних машина /
 * проєкт» — and it is the only ordering the screen knows. i18n-free.
 */

export interface ArchiveProjectGroup {
  project: string;
  cards: ArchiveCard[];
}

export interface ArchiveHostGroup {
  host: string;
  projects: ArchiveProjectGroup[];
}

/** Seconds since the session ended, or null when it never did — a card with no
    end has no age to show rather than an age of «now». */
export function cardAge(card: ArchiveCard, now: number): number | null {
  return card.endedAt === null ? null : Math.round(now / 1000 - card.endedAt);
}

/** A session that never ended sorts last instead of jumping the queue. */
function newest(cards: readonly ArchiveCard[]): number {
  return cards.reduce((best, card) => Math.max(best, card.endedAt ?? Number.MIN_SAFE_INTEGER), Number.MIN_SAFE_INTEGER);
}

export function groupArchive(cards: readonly ArchiveCard[]): ArchiveHostGroup[] {
  const byHost = new Map<string, Map<string, ArchiveCard[]>>();
  for (const card of cards) {
    const projects = byHost.get(card.host) ?? new Map<string, ArchiveCard[]>();
    byHost.set(card.host, projects);
    const bucket = projects.get(card.project) ?? [];
    projects.set(card.project, bucket);
    bucket.push(card);
  }

  const groups: ArchiveHostGroup[] = [...byHost].map(([host, projects]) => ({
    host,
    projects: [...projects]
      .map(([project, own]) => ({
        project,
        cards: [...own].sort((a, b) => (b.endedAt ?? Number.MIN_SAFE_INTEGER) - (a.endedAt ?? Number.MIN_SAFE_INTEGER)),
      }))
      .sort((a, b) => newest(b.cards) - newest(a.cards)),
  }));
  return groups.sort((a, b) => newest(b.projects.flatMap((entry) => entry.cards)) - newest(a.projects.flatMap((entry) => entry.cards)));
}
