"use client";

import { LayoutGrid } from "lucide-react";
import type { ReactNode } from "react";

import { MobileHqRoom } from "@/components/mobile/MobileHqRoom";
import { SuppressMobileTabs } from "@/components/mobile/MobileShell";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { OrgTree } from "./OrgTree";

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
  onOpenBoardProject: (boardProject: string) => void;
  onOpenFile: (file: FileEntry) => void;
  onCreateAgent: (project: string | null) => void;
  projectConsole?: ReactNode;
}

export function DesktopHome({ files, selectedProject, onSelectProject, onOpenBoard, onOpenBoardProject, projectConsole }: DesktopHomeProps) {
  const { t } = useLocale();
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
        <OrgTree files={files} selected={selectedProject} onSelect={(id) => onSelectProject(id === selectedProject ? null : id)} onOpenBoardProject={onOpenBoardProject} />
        {projectConsole}
      </aside>
      <main data-desktop-hq className="flex min-w-0 flex-1 flex-col">
        <SuppressMobileTabs>
          <MobileHqRoom files={files} host={null} />
        </SuppressMobileTabs>
      </main>
    </div>
  );
}
