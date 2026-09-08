"use client";

import { useCallback, useState } from "react";

import { CatalogFailureNotice } from "@/components/CatalogFailureNotice";
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
 * shell with `compact={false}` so every row, summary, chip and select is a
 * 44px touch target. A second tree and a second launch form would have drifted
 * apart inside a week.
 *
 * The bar is the board's bar: the title cell is the project switcher (README
 * §3.1 — the cell IS the switcher, and it is the phone's only way into a
 * project's own board), the badge and the search sit where they always did.
 * The tree's own «Архів» row pushes the archive screen the tab bar serves,
 * rather than the desktop's side panel.
 */

export interface MobileConsoleScreenProps {
  files: FileEntry[];
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
  /** The Viewer's global message search; absent, the bar shows no target. */
  onOpenSearch?: () => void;
  onSelectFile: (file: FileEntry) => void;
  /** The Viewer's own resolver for an archived transcript's PATH. Never a
      lookup in `files` first: `/api/files` is a recency-capped board budget,
      so the archived transcript this button exists for is usually absent from
      it while sitting right there on disk. */
  onOpenTranscript?: (path: string) => void;
  /** Consecutive `/api/files` failures (issue #696). The console draws no
      cards, but a project's live sessions come out of that same payload, so an
      unconfirmed feed has to be named here as it is on the board. */
  catalogFailures?: number;
}

/** A console mounted without a resolver simply has no transcript button that
    does anything — but the Viewer always passes one. */
const NO_TRANSCRIPT = () => {};

export function MobileConsoleScreen({ files, host, renderSheet, onOpenSearch, onSelectFile, onOpenTranscript, catalogFailures = 0 }: MobileConsoleScreenProps) {
  const { t } = useLocale();
  const nav = useMobileNavStore();
  /* sessionStorage, read once at mount: the tab bar unmounts this screen on
     every visit to Чат or Налаштування, and coming back to the tree each time
     is what makes the phone's console feel worse than the desktop's. */
  const [selected, setSelected] = useState<string | null>(() => readMobileConsoleProject());

  const select = useCallback((id: string) => {
    const next = selected === id ? null : id;
    setSelected(next);
    writeMobileConsoleProject(next);
  }, [selected]);

  /* A project deleted or renamed since the tab was last open would otherwise
     mount a console that can only report a 404. The tree answers with what the
     org actually has — this is the first moment «bot is gone» is knowable, as
     opposed to «the org has not loaded yet». */
  const forgetUnknown = useCallback((ids: readonly string[]) => {
    if (selected === null || ids.includes(selected)) return;
    setSelected(null);
    writeMobileConsoleProject(null);
  }, [selected]);

  return (
    <MobileShell
      screen="board"
      title={<MobileBarTitle>{t("desktop.consoleTitle")}</MobileBarTitle>}
      titleLabel={t("mobile2.bar.switchProject")}
      titleOpens={host ? "projects" : undefined}
      host={host}
      onOpenSearch={onOpenSearch}
      searchTestId="overview-search"
      renderSheet={renderSheet}
    >
      <div data-mobile2-console className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain pb-3">
        <CatalogFailureNotice failures={catalogFailures} className="mt-3" />
        <OrgTree
          selected={selected}
          onSelect={select}
          onOpenArchive={() => nav.push({ kind: "archive" })}
          onProjectsKnown={forgetUnknown}
          compact={false}
        />
        {selected ? (
          <ProjectConsole
            project={selected}
            files={files}
            onOpenFile={onSelectFile}
            onOpenTranscript={onOpenTranscript ?? NO_TRANSCRIPT}
            compact={false}
          />
        ) : null}
      </div>
    </MobileShell>
  );
}
