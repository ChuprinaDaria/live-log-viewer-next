"use client";

import { useCallback, useEffect, useState } from "react";

import { engineLabel } from "@/components/feed/engineMark";
import { LaunchForm } from "@/components/machines/LaunchForm";
import { loadProject, type ProjectDetail } from "@/components/mobile/firmsModel";
import { hqFileOf, useHqSeat } from "@/components/mobile/hqSeat";
import { cleanTitle, fmtAge } from "@/components/utils";
import { accountDisplayName, accountIdFromPath, DEFAULT_ACCOUNT_ID } from "@/lib/accounts/badge";
import { useEngineAccounts } from "@/hooks/useEngineAccounts";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { machineOf, projectAgents } from "./desktopHomeModel";
import { ProjectAccordions } from "./ProjectAccordions";

/*
 * The console for one project (spec 2026-09-08): what the operator does here
 * FIRST is start a session — «я можу сесію зі свіжим кодом підняти на
 * будь-якій машині» — so the launch form is open at the top, above everything
 * the project already has. Live sessions come next, each with «перенести»,
 * because moving a running session to another machine is the second verb of
 * the same sentence. Everything else — the archive, the code on each machine,
 * skills, MCP, secrets — is folded away until asked for.
 *
 * The form is Task 5's `LaunchForm`, mounted `compact`. There is no second
 * "start an agent" form here on purpose: two would drift apart in a week.
 */

export interface ProjectConsoleProps {
  project: string;
  files: readonly FileEntry[];
  onOpenFile: (file: FileEntry) => void;
  /** The Viewer's resolver for an archived transcript's path. */
  onOpenTranscript: (path: string) => void;
}

/** «перенести» remounts the form: `LaunchForm` reads its `initial*` props
    once, at mount, so a new source machine needs a new instance. `host` is
    whatever the transcript's path says and nothing else — `|| "walter"` named a
    machine the session may never have run on, and the operator would have moved
    it FROM there. Empty leaves the source picker open, which is the truth. */
interface MoveRequest { host: string; tmux: string; nonce: number }

export function ProjectConsole({ project, files, onOpenFile, onOpenTranscript }: ProjectConsoleProps) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [move, setMove] = useState<MoveRequest | null>(null);
  const [told, setTold] = useState<"sent" | "no-seat" | null>(null);
  const [tellFailure, setTellFailure] = useState<string | null>(null);
  const hq = useHqSeat();

  const reload = useCallback(async () => {
    try {
      setDetail(await loadProject(project));
      setDetailError(null);
    } catch (cause) {
      setDetail(null);
      setDetailError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [project]);

  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    setMove(null);
    setTold(null);
    setTellFailure(null);
    void reload();
  }, [reload]);

  /* One registry read for every row: the mailbox behind each session's
     account id, so «default» never reaches the screen when the address is known. */
  const claudeAccounts = useEngineAccounts("claude");
  const live = projectAgents(files, project).filter((file) => file.activity === "live");
  const hqFile = hqFileOf(files, hq.status);

  /* The line is only worth sending once the project has been read: without
     the detail it would say «Відкриваю проєкт  → bot ()». And a refused POST
     is a refusal — «HQ отримав.» over a 503 is the console lying to the
     operator about where their message went. */
  const tellHq = async () => {
    if (!detail) return;
    if (!hqFile) { setTold("no-seat"); setTellFailure(null); return; }
    const text = t("desktop.tellHqLine", { firm: detail.firm, project: detail.name || project, path: detail.path ?? "" });
    try {
      const response = await fetch("/api/tmux", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: hqFile.path, text }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setTold(null);
        setTellFailure(body?.error ?? `HTTP ${response.status}`);
        return;
      }
      setTold("sent");
      setTellFailure(null);
    } catch (cause) {
      setTold(null);
      setTellFailure(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section data-project-console className="flex flex-col gap-3 border-t border-border px-2 py-3">
      <header className="flex flex-col gap-1 px-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-primary">{detail?.name || project}</span>
          <button type="button" data-console-tell-hq disabled={!detail} onClick={() => void tellHq()}
            className="inline-flex h-7 shrink-0 items-center rounded-[8px] border border-border px-2 text-[11.5px] font-semibold text-secondary hover:border-accent/45 hover:text-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            {t("desktop.tellHq")}
          </button>
        </div>
        {detail?.firm ? <span className="truncate text-[11px] text-muted">{detail.firm}</span> : null}
        {told === "sent" ? <p role="status" className="text-[11px] text-success">{t("desktop.tellHqSent")}</p> : null}
        {told === "no-seat" ? <p role="status" className="text-[11px] text-muted">{t("desktop.tellHqNoSeat")}</p> : null}
        {tellFailure ? <p role="status" data-console-tell-failure className="text-[11px] text-danger">{tellFailure}</p> : null}
        {detailError ? <p role="status" className="text-[11px] text-danger">{t("desktop.detailFailed", { reason: detailError })}</p> : null}
      </header>

      <div data-console-launch className="flex flex-col gap-2">
        <h3 className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted">{t("desktop.launchTitle")}</h3>
        <LaunchForm
          key={move ? `move-${move.nonce}` : "start"}
          compact
          initialProject={project}
          initialMode={move ? "move" : "start"}
          {...(move ? { initialSession: { host: move.host, tmux: move.tmux } } : {})}
        />
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted">{t("desktop.sectionSessions")}</h3>
        {live.length === 0 ? (
          <p className="px-1 text-[11.5px] text-muted">{t("desktop.noAgents")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {live.map((file) => <AgentRow key={file.path} file={file} onOpenFile={onOpenFile}
              accountName={accountDisplayName(claudeAccounts.accounts, accountIdFromPath(file.path))}
              onMove={() => setMove({ host: machineOf(file), tmux: "", nonce: Date.now() })} />)}
          </ul>
        )}
      </div>

      {/* Keyed by project: the panels hold what one project answered — which
          branch sits on which machine, which cards the archive returned — and
          the tree switches A→B without unmounting this column, so without the
          key B renders A's git state under B's name. */}
      <ProjectAccordions key={project} project={project} detail={detail} onChanged={() => void reload()}
        onOpenTranscript={onOpenTranscript} />
    </section>
  );
}

function AgentRow({ file, accountName, onOpenFile, onMove }: { file: FileEntry; accountName: string; onOpenFile: (file: FileEntry) => void; onMove: () => void }) {
  const { t } = useLocale();
  const machine = machineOf(file);
  const meta = [engineLabel(file.engine), file.model].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-1">
      <button type="button" data-console-agent={file.path} onClick={() => onOpenFile(file)}
        className="flex min-h-8 min-w-0 flex-1 flex-col items-start rounded-[8px] px-2 py-1 text-left hover:bg-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <span className="w-full truncate text-[12.5px] text-primary">{cleanTitle(file.title)}</span>
        <span className="w-full truncate text-[11px] text-muted">
          {[meta, accountName === DEFAULT_ACCOUNT_ID ? "" : accountName, machine, fmtAge(file.mtime)].filter(Boolean).join(" · ")}
        </span>
      </button>
      <button type="button" data-console-move={file.path} onClick={onMove}
        className="inline-flex h-7 shrink-0 items-center rounded-[8px] border border-border px-2 text-[11px] text-secondary hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        {t("desktop.move")}
      </button>
    </li>
  );
}
