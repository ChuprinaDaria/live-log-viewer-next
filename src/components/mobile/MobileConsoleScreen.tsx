"use client";

import { useCallback, useState } from "react";

import { OrgTree } from "@/components/desktop/OrgTree";
import { ProjectConsole } from "@/components/desktop/ProjectConsole";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { readMobileConsoleProject, writeMobileConsoleProject } from "./mobileHomeModel";
import { useMobileNavStore } from "./mobileNav";
import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";

/*
 * The phone's «Сесії» tab, as the console the desktop already has — «десктоп
 * версія зараз краща і зручніша за мою».
 *
 * Nothing here is a phone-shaped copy of anything: `OrgTree` and
 * `ProjectConsole` are the desktop's own components, mounted in the phone's
 * shell with `compact={false}` so every row is a 44px touch target. A second
 * tree and a second launch form would have drifted apart inside a week.
 *
 * The tree's own «Архів» row pushes the archive screen the tab bar already
 * serves, rather than the desktop's side panel, and an archived transcript
 * opens through the Viewer's `onSelectFile` — the same hand-off the card board
 * uses for a conversation.
 */

export interface MobileConsoleScreenProps {
  files: FileEntry[];
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
  /** The Viewer's global message search; absent, the bar shows no target. */
  onOpenSearch?: () => void;
  onSelectFile: (file: FileEntry) => void;
}

export function MobileConsoleScreen({ files, host, renderSheet, onOpenSearch, onSelectFile }: MobileConsoleScreenProps) {
  const { t } = useLocale();
  const nav = useMobileNavStore();
  /* sessionStorage, read once at mount: the tab bar unmounts this screen on
     every visit to Чат or Налаштування, and coming back to the tree each time
     is what makes the phone's console feel worse than the desktop's. */
  const [selected, setSelected] = useState<string | null>(() => readMobileConsoleProject());

  const select = useCallback((id: string) => {
    setSelected((current) => {
      const next = current === id ? null : id;
      writeMobileConsoleProject(next);
      return next;
    });
  }, []);

  /* The archive accordion hands back a path; the Viewer speaks in entries. */
  const openTranscript = useCallback((path: string) => {
    const file = files.find((entry) => entry.path === path);
    if (file) onSelectFile(file);
  }, [files, onSelectFile]);

  return (
    <MobileShell
      screen="board"
      title={<MobileBarTitle>{t("desktop.consoleTitle")}</MobileBarTitle>}
      host={host}
      onOpenSearch={onOpenSearch}
      searchTestId="overview-search"
      renderSheet={renderSheet}
    >
      <div data-mobile2-console className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain pb-3">
        <OrgTree selected={selected} onSelect={select} onOpenArchive={() => nav.push({ kind: "archive" })} />
        {selected ? (
          <ProjectConsole
            project={selected}
            files={files}
            onOpenFile={onSelectFile}
            onOpenTranscript={openTranscript}
            compact={false}
          />
        ) : null}
      </div>
    </MobileShell>
  );
}
