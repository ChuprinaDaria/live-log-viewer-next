"use client";

import { LayoutGrid, Search, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ArchiveScreen } from "@/components/archive/ArchiveScreen";
import { ConnectionPill } from "@/components/ConnectionPill";
import { DesktopMenu } from "@/components/DesktopMenu";
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
 *
 * The three things the board's own header carries come along, because this is
 * now the first screen of the session and losing them would mean opening the
 * board to reach secrets, to search, or to see whether the runtime is live:
 * the menu and the search trigger sit in the console's header row, and the
 * connection pill keeps the bottom-left corner `shell` docks it in.
 */

export interface DesktopHomeProps {
  files: FileEntry[];
  selectedProject: string | null;
  onSelectProject: (project: string | null) => void;
  onOpenBoard: () => void;
  onOpenFile: (file: FileEntry) => void;
  /** The Viewer's global message search — the same overlay the board opens. */
  onOpenSearch: () => void;
  /** The Viewer's resolver for an archived transcript's path. */
  onOpenTranscript: (path: string) => void;
}

export function DesktopHome({
  files, selectedProject, onSelectProject, onOpenBoard, onOpenFile, onOpenSearch, onOpenTranscript,
}: DesktopHomeProps) {
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
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
          <DesktopMenu />
          <span className="min-w-0 truncate text-[13.5px] font-bold">{t("desktop.consoleTitle")}</span>
          <button
            type="button"
            data-testid="overview-search"
            aria-label={t("search.open")}
            title={t("search.open")}
            onClick={onOpenSearch}
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-border bg-canvas text-muted hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Search className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" data-desktop-board onClick={onOpenBoard}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] border border-border px-2 text-[11.5px] font-semibold text-secondary hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            {t("desktop.board")}
          </button>
        </div>
        <OrgTree selected={selectedProject} onSelect={(id) => onSelectProject(id === selectedProject ? null : id)} onOpenArchive={() => setArchiveOpen(true)} />
        {selectedProject ? (
          <ProjectConsole project={selectedProject} files={files} onOpenFile={onOpenFile} onOpenTranscript={onOpenTranscript} />
        ) : null}
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
                <ArchiveScreen host={null} onOpenTranscript={onOpenTranscript} />
              </SuppressMobileTabs>
            </div>
          </div>
        </div>
      ) : null}

      {/* The same corner `shell` docks it in, so switching home and board does
          not move the one indicator that says whether the runtime is there. */}
      <ConnectionPill />
    </div>
  );
}
