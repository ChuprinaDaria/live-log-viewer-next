"use client";

import { Building2, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { projectTree, useOrg } from "@/components/mobile/firmsModel";
import { buildProjectSummaries } from "@/components/projectModel";
import { fmtAge } from "@/components/utils";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { unassignedFiles } from "./desktopHomeModel";

/*
 * The console's org tree as the desktop's left column: firms, their projects,
 * subfolders indented. Read from fleetctl through `useOrg`, never from the
 * transcript directories — those only feed the «Без проєкту» bucket at the
 * bottom, which is where every unclaimed session waits for the sorter.
 */

export interface OrgTreeProps {
  files: readonly FileEntry[];
  /** Console project id, or null. */
  selected: string | null;
  onSelect: (project: string) => void;
  /** A board project key from the «Без проєкту» bucket. */
  onOpenBoardProject: (boardProject: string) => void;
}

const ROW = "flex min-h-8 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] hover:bg-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function OrgTree({ files, selected, onSelect, onOpenBoardProject }: OrgTreeProps) {
  const { t } = useLocale();
  const org = useOrg();
  const [bucketOpen, setBucketOpen] = useState(false);
  const unassigned = useMemo(() => unassignedFiles(files), [files]);
  const bucketRows = useMemo(() => (bucketOpen ? buildProjectSummaries([...unassigned]) : []), [bucketOpen, unassigned]);

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
              <ProjectRow id={row.id} label={row.name || row.id} depth={0} selected={selected === row.id} onSelect={onSelect} />
              {children.map((child) => (
                <ProjectRow key={child.id} id={child.id} label={child.name || child.id} depth={1} selected={selected === child.id} onSelect={onSelect} />
              ))}
            </div>
          ))}
        </div>
      ))}
      {unassigned.length ? (
        <div className="mt-2 border-t border-border pt-2">
          <button type="button" data-org-unassigned aria-expanded={bucketOpen} title={t("desktop.unassignedHint")}
            className={`${ROW} font-semibold text-muted`} onClick={() => setBucketOpen((was) => !was)}>
            <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${bucketOpen ? "rotate-90" : ""}`} aria-hidden />
            <span className="truncate">{t("desktop.unassigned")}</span>
            <span className="ml-auto tabular-nums">{unassigned.length}</span>
          </button>
          {bucketRows.map((summary) => (
            <button key={summary.project} type="button" data-org-unassigned-row={summary.project}
              className={`${ROW} pl-6 text-secondary`} onClick={() => onOpenBoardProject(summary.project)}>
              <span className="truncate">{summary.displayName}</span>
              <span className="ml-auto text-[11px] text-muted">{fmtAge(summary.smt)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

function ProjectRow({ id, label, depth, selected, onSelect }: { id: string; label: string; depth: 0 | 1; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" data-org-project={id} aria-current={selected ? "true" : undefined}
      className={`${ROW} ${depth ? "pl-7" : "pl-4"} ${selected ? "bg-accent/10 font-semibold text-accent" : "text-primary"}`}
      onClick={() => onSelect(id)}>
      <span className="truncate">{label}</span>
    </button>
  );
}
