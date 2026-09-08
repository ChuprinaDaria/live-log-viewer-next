"use client";

import { LayoutGrid, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ArchiveScreen } from "@/components/archive/ArchiveScreen";
import { MobileHqRoom } from "@/components/mobile/MobileHqRoom";
import { SuppressMobileTabs } from "@/components/mobile/MobileShell";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { OrgTree } from "./OrgTree";
import { ProjectConsole } from "./ProjectConsole";

/*
 * The desktop's home (spec 2026-09-08): the console column on the left — the
 * org tree and, once a project is chosen, what acts on it — and the HQ room
 * on the right. The room is the phone's component under SuppressMobileTabs,
 * the same way DesktopMenu mounts every other phone page on a wide window.
 * The board is one click away and never gone.
 */

export interface DesktopHomeProps {
  files: FileEntry[];
  selectedProject: string | null;
  onSelectProject: (project: string | null) => void;
  onOpenBoard: () => void;
  onOpenFile: (file: FileEntry) => void;
}

export function DesktopHome({ files, selectedProject, onSelectProject, onOpenBoard, onOpenFile }: DesktopHomeProps) {
  const { t } = useLocale();
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    if (!archiveOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setArchiveOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [archiveOpen]);

  return (
    <div className="flex h-full">
      <aside data-desktop-console className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="text-[13.5px] font-bold">{t("desktop.consoleTitle")}</span>
          <button type="button" data-desktop-board onClick={onOpenBoard}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-[8px] border border-border px-2 text-[11.5px] font-semibold text-secondary hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            {t("desktop.board")}
          </button>
        </div>
        <OrgTree selected={selectedProject} onSelect={(id) => onSelectProject(id === selectedProject ? null : id)} onOpenArchive={() => setArchiveOpen(true)} />
        {selectedProject ? <ProjectConsole project={selectedProject} files={files} onOpenFile={onOpenFile} /> : null}
      </aside>
      <main data-desktop-hq className="flex min-w-0 flex-1 flex-col">
        <SuppressMobileTabs>
          <MobileHqRoom files={files} host={null} />
        </SuppressMobileTabs>
      </main>

      {/* The archive comes in on the right, in the same panel the menu's pages
          use: a column those screens were drawn for, and Esc to close it. */}
      {archiveOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setArchiveOpen(false)}>
          <div data-desktop-archive-panel className="flex h-full w-full max-w-[560px] flex-col border-l border-border bg-canvas shadow-xl"
            onClick={(event) => event.stopPropagation()}>
            <div className="flex h-10 shrink-0 items-center justify-end border-b border-border bg-card px-2">
              <button type="button" aria-label={t("common.close")} onClick={() => setArchiveOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-muted hover:bg-quiet hover:text-primary">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <SuppressMobileTabs>
                <ArchiveScreen host={null} />
              </SuppressMobileTabs>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
