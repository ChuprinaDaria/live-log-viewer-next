"use client";

import { useState } from "react";

import { ChevronDown, Loader2 } from "@/components/icons";
import { engineLabel } from "@/components/feed/engineMark";
import { LogFeed } from "@/components/LogFeed";
import { RuntimePill } from "@/components/RuntimePill";
import { TmuxComposer } from "@/components/TmuxComposer";
import { useAgentCapabilities } from "@/components/useAgentCapabilities";
import { accountDisplayName, accountIdFromPath, DEFAULT_ACCOUNT_ID } from "@/lib/accounts/badge";
import { useEngineAccounts } from "@/hooks/useEngineAccounts";
import { useKeyboardInset } from "@/hooks/useComposer";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { hqFileOf, useHqSeat } from "./hqSeat";

/*
 * The Чат tab: the fleet's standing orchestrator, the same room on the
 * overview and inside every project.
 *
 * One conversation, nothing beside it. The room is the operator's main chat,
 * so it carries a chat's furniture and no board's: no launch chips, no
 * per-turn who/model header, no end-of-turn status line, no roster row, no
 * control strip — the feed's own `bare` mode drops each of them, and the
 * mandate that opened the conversation is not shown as a message because the
 * operator never wrote it. What the runtime IS lives one tap up, in the title:
 * engine, model, reasoning, account, folded until asked for.
 */

const ACTION = "inline-flex min-h-11 items-center rounded-control border border-accent px-4 text-body font-semibold text-accent active:bg-accent-soft disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function MobileHqRoom({ files, host, renderSheet }: {
  /** Every scanned file, whatever project the surface shows. */
  files: readonly FileEntry[];
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
}) {
  const { t } = useLocale();
  const hq = useHqSeat();
  const kbInset = useKeyboardInset();
  const [open, setOpen] = useState(false);
  const file = hqFileOf(files, hq.status);
  const seated = Boolean(hq.status?.seat && hq.status.exists);
  const waiting = hq.starting || Boolean(hq.status?.pending) || (seated && !file);

  const title = (
    <button
      type="button"
      data-mobile2-hq-title
      aria-expanded={file ? open : undefined}
      className="flex min-w-0 items-center gap-1 text-title font-semibold text-primary"
      onClick={() => setOpen((was) => file !== null && !was)}
    >
      <span className="min-w-0 truncate">{t("mobile2.hq.name")}</span>
      {file ? <ChevronDown className={`h-4 w-4 shrink-0 text-secondary transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /> : null}
    </button>
  );

  return (
    <MobileShell screen="orchestrator" title={title} host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
        {file ? (
          <>
            {open ? <HqRuntimePanel file={file} /> : null}
            <HqConversation file={file} />
          </>
        ) : hq.status === null && !hq.failed ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-body text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("common.loading")}
          </div>
        ) : waiting ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-body text-secondary" data-mobile2-hq="starting">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("mobile2.hq.starting")}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center" data-mobile2-hq="vacant">
            <p className="max-w-[280px] text-body leading-relaxed text-secondary">{t(hq.failed ? "mobile2.hq.unreachable" : "mobile2.hq.vacant")}</p>
            {hq.failed ? null : (
              <button type="button" className={ACTION} onClick={() => void hq.start()} disabled={hq.starting}>
                {t("mobile2.hq.start")}
              </button>
            )}
            {hq.error ? <p className="max-w-[280px] text-caption text-danger">{hq.error}</p> : null}
          </div>
        )}
      </div>
    </MobileShell>
  );
}

/** The room's transcript and its composer, and nothing else. */
function HqConversation({ file }: { file: FileEntry }) {
  const { t } = useLocale();
  const { caps } = useAgentCapabilities(file);
  const deadHost = caps.surface === "dead";
  const sendCap = caps.controls.send;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-mobile2-hq="room">
      <LogFeed
        file={file}
        showSvc={false}
        lineFilter=""
        onStatus={() => undefined}
        paused={false}
        follow
        setFollow={() => undefined}
        compact
        bare
      />
      <TmuxComposer
        file={file}
        deadHost={deadHost}
        sendBlockedReason={!deadHost && sendCap.state === "disabled" ? t(sendCap.reason) : null}
        placeholder={t("mobile2.hq.placeholder")}
        hideRuntimeControl
        primaryPlace
      />
    </div>
  );
}

/** What the seat is running on, folded behind the title. Four facts and the
    one control that changes them; a fact the session does not carry says
    «типова» rather than inventing a value. */
function HqRuntimePanel({ file }: { file: FileEntry }) {
  const { t } = useLocale();
  const { caps, structuredSession } = useAgentCapabilities(file);
  const account = accountIdFromPath(file.path);
  const accounts = useEngineAccounts("claude");
  /* The mailbox when the registry knows it; the registry word only as a last
     resort — «default» told the operator nothing about whose quota this is. */
  const accountName = accountDisplayName(accounts.accounts, account);
  const rows: { label: string; value: string }[] = [
    { label: t("mobile2.hq.engine"), value: engineLabel(file.engine) ?? "—" },
    { label: t("mobile2.hq.model"), value: file.model || t("draft.summaryModelDefault") },
    { label: t("mobile2.hq.effort"), value: file.effort || t("draft.summaryEffortDefault") },
    { label: t("launch.account"), value: accountName === DEFAULT_ACCOUNT_ID ? t("mobile2.hq.accountDefault") : accountName },
  ];
  return (
    <div data-mobile2-hq-runtime className="shrink-0 border-b border-border bg-card px-4 py-2">
      <dl className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <div key={row.label} className="flex min-h-9 items-center justify-between gap-3">
            <dt className="shrink-0 text-body text-secondary">{row.label}</dt>
            <dd className="min-w-0 truncate text-body font-semibold text-primary">{row.value}</dd>
          </div>
        ))}
      </dl>
      {caps.controls.runtime.state === "hidden" ? null : (
        <div className="mt-2 flex justify-end">
          <RuntimePill
            file={file}
            surface={caps.surface}
            runtimeSettings={structuredSession?.session.capabilities?.runtimeSettings ?? null}
            runtimeSession={structuredSession?.session ?? null}
          />
        </div>
      )}
    </div>
  );
}
