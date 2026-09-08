"use client";

import { useCallback, useState } from "react";

import type { ProjectDetail } from "@/components/mobile/firmsModel";
import { useMcpRegistry, type McpRegistryRead } from "@/components/mobile/mcpModel";
import { shareSecret, useSecretsInventory, type SecretsRead } from "@/components/mobile/secretsModel";
import { fmtAge } from "@/components/utils";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { effectiveRows, effectiveSecretRows, type EffectiveRow } from "./desktopHomeModel";

/*
 * Everything the project already HAS, folded away: the archive, the code on
 * each machine, and the three grant lists. Native <details>, all shut on
 * arrival — the console's first screen is for starting a session, not for
 * reading an inventory.
 *
 * Each accordion asks its route on the first open and never again on its own:
 * a closed panel that polls is a panel nobody asked for.
 */

export interface ProjectAccordionsProps {
  project: string;
  detail: ProjectDetail | null;
  files: readonly FileEntry[];
  onOpenFile: (file: FileEntry) => void;
  onChanged: () => void;
}

/** One host's checkout, as `project_code` answers it. */
interface CodeHost {
  host: string;
  path: string;
  exists: boolean;
  branch: string;
  head: string;
  dirty: boolean;
  detail: string;
}

/** A sessionmem card as `GET /api/archive` will answer it (Task 9 owns the
    canonical type; this is the shape this panel reads). */
interface ArchiveCard {
  sessionId: string;
  title: string;
  host: string;
  endedAt: number | null;
  resumable: boolean;
  transcriptPath: string | null;
  summary: string;
  did: string[];
  broke: string[];
  decided: string[];
  left: string[];
}

type Kind = "mcp" | "skills" | "secrets";

const SUMMARY = "flex min-h-8 cursor-pointer list-none items-center px-2 text-[11.5px] font-semibold text-secondary hover:text-accent";
const CHIP = "inline-flex h-6 shrink-0 items-center rounded-[6px] border border-border px-1.5 text-[11px] text-secondary hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function ProjectAccordions({ project, detail, files, onOpenFile, onChanged }: ProjectAccordionsProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [archive, setArchive] = useState<ArchiveCard[] | null>(null);
  const [archiveFailed, setArchiveFailed] = useState(false);
  const [code, setCode] = useState<CodeHost[] | null>(null);
  const [codeFailed, setCodeFailed] = useState<string | null>(null);
  /* One read of each registry for all three lists: three copies of the same
     poll would ask the console three times to answer one question. */
  const registry = useMcpRegistry();
  /* The inventory is only ever read to offer a key that is not shared yet, so
     it is not asked for until that panel is open. */
  const secrets = useSecretsInventory(open.secrets === true);

  const loadArchive = useCallback(async () => {
    try {
      const response = await fetch(`/api/archive?project=${encodeURIComponent(project)}`, { cache: "no-store" });
      if (!response.ok) { setArchiveFailed(true); return; }
      const body = await response.json() as { cards?: ArchiveCard[] };
      setArchive(body.cards ?? []);
      setArchiveFailed(false);
    } catch {
      setArchiveFailed(true);
    }
  }, [project]);

  const loadCode = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects?project=${encodeURIComponent(project)}&code=1`, { cache: "no-store" });
      const body = await response.json() as { hosts?: CodeHost[]; error?: string };
      if (!response.ok) { setCodeFailed(body.error ?? `HTTP ${response.status}`); return; }
      setCode(body.hosts ?? []);
      setCodeFailed(null);
    } catch (cause) {
      setCodeFailed(cause instanceof Error ? cause.message : String(cause));
    }
  }, [project]);

  const toggle = (name: string, onFirstOpen?: () => void) => {
    const next = open[name] !== true;
    setOpen({ ...open, [name]: next });
    if (next && onFirstOpen) onFirstOpen();
  };

  return (
    <div className="flex flex-col gap-1">
      <Accordion name="old" label={t("desktop.sectionArchive")} open={open.old === true}
        onToggle={() => toggle("old", () => { if (archive === null && !archiveFailed) void loadArchive(); })}>
        {archiveFailed ? <p className="text-[11.5px] text-muted">{t("archive.unavailable")}</p>
          : archive === null ? <p className="text-[11.5px] text-muted">{t("common.loading")}</p>
          : archive.length === 0 ? <p className="text-[11.5px] text-muted">{t("archive.empty")}</p>
          : <ul className="flex flex-col gap-1">{archive.map((card) => (
              <li key={card.sessionId}><ArchiveEntry card={card} files={files} onOpenFile={onOpenFile} /></li>
            ))}</ul>}
      </Accordion>

      <Accordion name="code" label={t("desktop.sectionCode")} open={open.code === true}
        onToggle={() => toggle("code", () => { if (code === null && !codeFailed) void loadCode(); })}>
        {codeFailed ? <p className="text-[11.5px] text-danger">{codeFailed}</p>
          : code === null ? <p className="text-[11.5px] text-muted">{t("common.loading")}</p>
          : code.length === 0 ? <p className="text-[11.5px] text-muted">{t("desktop.codeMissing")}</p>
          : <ul className="flex flex-col gap-1">{code.map((host) => (
              <li key={host.host} data-console-code={host.host} className="flex flex-col px-1">
                <span className="truncate text-[12px] text-primary">{host.host}</span>
                <span className="truncate text-[11px] text-muted">
                  {host.exists ? `${host.branch} @ ${host.head}` : (host.detail || t("desktop.codeMissing"))}
                </span>
                {host.exists && host.dirty ? <span className="text-[11px] text-warning">{t("desktop.codeDirty")}</span> : null}
              </li>
            ))}</ul>}
      </Accordion>

      {([["skills", t("desktop.sectionSkills")], ["mcp", t("desktop.sectionMcp")], ["secrets", t("desktop.sectionSecrets")]] as const).map(([kind, label]) => (
        <GrantSection key={kind} kind={kind} label={label} project={project} detail={detail}
          registry={registry} secrets={secrets}
          open={open[kind] === true} onToggle={() => toggle(kind)} onChanged={onChanged} />
      ))}
    </div>
  );
}

function Accordion({ name, label, open, onToggle, children }: {
  name: string; label: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <details data-console-accordion={name} open={open} className="rounded-[8px] border border-border bg-card">
      {/* The open state is React's, so the native toggle is suppressed: one
          source of truth decides whether the panel has asked its route. */}
      <summary className={SUMMARY} onClick={(event) => { event.preventDefault(); onToggle(); }}>{label}</summary>
      <div className="border-t border-border px-2 py-2">{children}</div>
    </details>
  );
}

function ArchiveEntry({ card, files, onOpenFile }: { card: ArchiveCard; files: readonly FileEntry[]; onOpenFile: (file: FileEntry) => void }) {
  const { t } = useLocale();
  const transcript = card.transcriptPath ? files.find((file) => file.path === card.transcriptPath) ?? null : null;
  const lists: { label: string; items: string[] }[] = [
    { label: t("archive.did"), items: card.did },
    { label: t("archive.broke"), items: card.broke },
    { label: t("archive.decided"), items: card.decided },
    { label: t("archive.left"), items: card.left },
  ].filter((row) => row.items.length > 0);

  return (
    <details data-console-archive-card={card.sessionId} className="rounded-[8px] bg-quiet px-2 py-1">
      <summary className="cursor-pointer list-none text-[12px] text-primary">
        <span className="truncate">{card.title}</span>
        <span className="ml-1 text-[11px] text-muted">
          {[card.endedAt === null ? "" : fmtAge(card.endedAt), card.host].filter(Boolean).join(" · ")}
        </span>
        {card.resumable ? <span className="ml-1 text-[11px] text-success">{t("archive.resumable")}</span> : null}
      </summary>
      <p className="pt-1 text-[11.5px] leading-snug text-secondary">{card.summary || t("archive.noCard")}</p>
      {lists.map((row) => (
        <div key={row.label} className="pt-1">
          <p className="text-[11px] font-semibold text-muted">{row.label}</p>
          <ul className="list-disc pl-4 text-[11.5px] text-secondary">
            {row.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
      {transcript ? (
        <button type="button" data-console-transcript={card.sessionId} className={`${CHIP} mt-1`} onClick={() => onOpenFile(transcript)}>
          {t("archive.transcript")}
        </button>
      ) : (
        <p className="pt-1 text-[11px] text-muted">{t("archive.transcriptElsewhere")}</p>
      )}
    </details>
  );
}

/**
 * Skills, MCP and secrets, each as the same list: what applies here, where it
 * came from, and — only for what this project granted itself — the way to take
 * it back. An inherited row has no revoke button at all rather than a disabled
 * one: the place to drop a firm's grant is the firm.
 */
function GrantSection({ kind, label, project, detail, registry, secrets, open, onToggle, onChanged }: {
  kind: Kind; label: string; project: string; detail: ProjectDetail | null;
  registry: McpRegistryRead; secrets: SecretsRead;
  open: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const target = `project:${project}`;

  const rows: EffectiveRow[] = kind === "secrets" ? effectiveSecretRows(detail) : effectiveRows(detail, kind);
  const known = kind === "secrets"
    ? (secrets.inventory?.secrets ?? []).map((row) => row.name)
    : kind === "mcp"
      ? (registry.servers ?? []).map((row) => row.name)
      : (registry.skills ?? []).map((row) => row.id);
  const candidates = known.filter((item) => !rows.some((row) => row.item === item));

  const write = async (item: string, revoke: boolean) => {
    setBusy(true);
    const error = kind === "secrets"
      ? await shareSecret(item, target, revoke)
      : await registry.grant(kind, item, target, revoke);
    setBusy(false);
    setFailure(error);
    if (!error) onChanged();
  };

  return (
    <Accordion name={kind} label={label} open={open} onToggle={onToggle}>
      {rows.length === 0 ? (
        <p className="text-[11.5px] text-muted">{t("firms.nothingApplies")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <li key={row.item} data-console-row={`${kind}:${row.item}`} className="flex items-center gap-1.5 px-1">
              <span className="min-w-0 flex-1 truncate text-[12px] text-primary">{row.item}</span>
              <span className="shrink-0 text-[11px] text-muted">
                {row.own ? t("desktop.own") : `${t("desktop.fromFirm")} ${row.from.split(":")[1] ?? row.from}`}
              </span>
              {row.own ? (
                <button type="button" data-console-revoke={`${kind}:${row.item}`} disabled={busy}
                  className={CHIP} onClick={() => void write(row.item, true)}>
                  {t("desktop.revoke")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {candidates.length ? (
        <select data-console-add={kind} value="" disabled={busy} aria-label={label}
          onChange={(event) => { const item = event.target.value; if (item) void write(item, false); }}
          className="mt-1.5 h-7 w-full rounded-[8px] border border-border bg-card px-2 text-[11.5px] text-secondary">
          <option value="">{t("desktop.addGrant")}</option>
          {candidates.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      ) : null}
      {failure ? <p role="status" className="pt-1 text-[11px] text-danger">{failure}</p> : null}
    </Accordion>
  );
}
