"use client";

import { Archive, Building2 } from "lucide-react";
import { useEffect, useState } from "react";

import { projectTree, useOrg } from "@/components/mobile/firmsModel";
import { useLocale } from "@/lib/i18n";

/*
 * The console's org tree as the desktop's left column: firms, their projects,
 * subfolders indented. Read from fleetctl through `useOrg`, never from the
 * transcript directories.
 *
 * At the bottom, one row and not a pile. The «Без проєкту» bucket used to list
 * every unclaimed session here, which is exactly the «звалище старих сесій»
 * the operator asked to be rid of: those sessions are summarised in the
 * archive now, and this row only says how many there are and opens it.
 */

export interface OrgTreeProps {
  /** Console project id, or null. */
  selected: string | null;
  onSelect: (project: string) => void;
  /** Open the session archive. */
  onOpenArchive: () => void;
  /** Desktop column (32px rows) by default; the phone passes false for 44px.
      This is the phone's primary navigation — every row here is a finger. */
  compact?: boolean;
  /** Announced once the org has answered: which project ids actually exist.
      The phone uses it to forget a remembered id the org no longer has. */
  onProjectsKnown?: (ids: readonly string[]) => void;
}

const rowClasses = (compact: boolean) =>
  `flex ${compact ? "min-h-8" : "min-h-11"} w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] hover:bg-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`;

export function OrgTree({ selected, onSelect, onOpenArchive, compact = true, onProjectsKnown }: OrgTreeProps) {
  const { t } = useLocale();
  const org = useOrg();
  const ROW = rowClasses(compact);
  /* Nothing while it is unknown: a count is either the archive's own or absent,
     never a zero this column made up. */
  const [archived, setArchived] = useState<number | null>(null);

  /* The one thing this column knows that its owner does not: which project ids
     the org actually has. A surface that remembers a selection needs it to tell
     a stale id from a slow load — asking `/api/projects` a second time to find
     out would be two copies of one poll. */
  const projects = org.projects;
  useEffect(() => {
    if (!projects || !onProjectsKnown) return;
    onProjectsKnown(projects.map((project) => project.id));
  }, [projects, onProjectsKnown]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/archive?count=1", { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { count?: unknown };
        if (alive && typeof body.count === "number") setArchived(body.count);
      } catch {
        /* the row still opens the archive, which says what went wrong */
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <nav aria-label={t("firms.title")} className="flex flex-col gap-1 px-2 py-2">
      {org.error ? <p className="px-2 py-1 text-[11.5px] text-danger">{t("desktop.firmsUnreachable")}</p> : null}
      {org.firms && org.firms.length === 0 ? <p className="px-2 py-1 text-[11.5px] text-muted">{t("desktop.noFirms")}</p> : null}
      {(org.firms ?? []).map((firm) => (
        <div key={firm.id} className="flex flex-col">
          <div data-org-firm={firm.id} className="flex min-h-7 items-center gap-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted">
            <Building2 className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">{firm.name || firm.id}</span>
          </div>
          {projectTree(org.projects ?? [], firm.id).map(({ row, children }) => (
            <div key={row.id} className="flex flex-col">
              <ProjectRow id={row.id} label={row.name || row.id} depth={0} selected={selected === row.id} onSelect={onSelect} rowClass={ROW} />
              {children.map((child) => (
                <ProjectRow key={child.id} id={child.id} label={child.name || child.id} depth={1} selected={selected === child.id} onSelect={onSelect} rowClass={ROW} />
              ))}
            </div>
          ))}
        </div>
      ))}
      <div className="mt-2 border-t border-border pt-2">
        <button type="button" data-org-archive className={`${ROW} font-semibold text-muted`} onClick={onOpenArchive}>
          <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t("archive.title")}</span>
          {archived === null ? null : <span className="ml-auto tabular-nums">{archived}</span>}
        </button>
      </div>
    </nav>
  );
}

function ProjectRow({ id, label, depth, selected, onSelect, rowClass }: { id: string; label: string; depth: 0 | 1; selected: boolean; onSelect: (id: string) => void; rowClass: string }) {
  return (
    <button type="button" data-org-project={id} aria-current={selected ? "true" : undefined}
      className={`${rowClass} ${depth ? "pl-7" : "pl-4"} ${selected ? "bg-accent/10 font-semibold text-accent" : "text-primary"}`}
      onClick={() => onSelect(id)}>
      <span className="truncate">{label}</span>
    </button>
  );
}
