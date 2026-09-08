"use client";

import { useRef, useState } from "react";

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
import { useHqIdentity, type HqIdentityState } from "./hqIdentity";

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

/* A plain <img>: an animated GIF must keep moving, and next/image would hand
   back a single frame. `alt=""` because the name is right beside it. */
function HqAvatar({ name, avatarUrl, size = 24 }: { name: string; avatarUrl: string | null; size?: number }) {
  const box = { width: size, height: size };
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" data-hq-avatar style={box} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden
      data-hq-avatar-letter
      style={box}
      className="flex shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-secondary"
    >
      {([...name][0] ?? "").toLocaleUpperCase()}
    </span>
  );
}

export function MobileHqRoom({ files, host, renderSheet }: {
  /** Every scanned file, whatever project the surface shows. */
  files: readonly FileEntry[];
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
}) {
  const { t } = useLocale();
  const hq = useHqSeat();
  const identity = useHqIdentity();
  const kbInset = useKeyboardInset();
  const [open, setOpen] = useState(false);
  const file = hqFileOf(files, hq.status);
  /* The signature the operator set; the i18n word only until the first read
     answers, so the title never flashes an empty name. */
  const name = identity.identity?.name ?? t("mobile2.hq.name");
  const avatarUrl = identity.identity?.avatarUrl ?? null;
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
      <HqAvatar name={name} avatarUrl={avatarUrl} />
      <span className="min-w-0 truncate">{name}</span>
      {file ? <ChevronDown className={`h-4 w-4 shrink-0 text-secondary transition-transform ${open ? "rotate-180" : ""}`} aria-hidden /> : null}
    </button>
  );

  return (
    <MobileShell screen="orchestrator" title={title} host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
        {file ? (
          <>
            {open ? <HqRuntimePanel file={file} identity={identity} /> : null}
            <HqConversation file={file} signature={{ name, avatarUrl }} />
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
function HqConversation({ file, signature }: { file: FileEntry; signature: { name: string; avatarUrl: string | null } }) {
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
        signature={signature}
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
function HqRuntimePanel({ file, identity }: { file: FileEntry; identity: HqIdentityState }) {
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
      <HqIdentityBlock identity={identity} />
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

/** The one place the operator sets who the room signs its answers as: a name
    that saves when the field is left, and a picture behind a file input. One
    status line for both, so a save and a refusal never stack. */
function HqIdentityBlock({ identity }: { identity: HqIdentityState }) {
  const { t } = useLocale();
  const picker = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<{ text: string; bad: boolean } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? identity.identity?.name ?? "";
  const avatarUrl = identity.identity?.avatarUrl ?? null;

  const settle = (error: string | null) => setStatus(error ? { text: error, bad: true } : { text: t("hq.identity.saved"), bad: false });

  const commitName = () => {
    const next = draft;
    setDraft(null);
    /* Nothing typed, or typed back to what it already is: no request. */
    if (next === null || next === identity.identity?.name) return;
    void identity.saveName(next).then(settle);
  };

  return (
    <div data-hq-identity className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
      <div className="text-body text-secondary">{t("hq.identity.title")}</div>
      <label className="flex min-h-9 items-center justify-between gap-3">
        <span className="shrink-0 text-body text-secondary">{t("hq.identity.name")}</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          data-hq-identity-name
          className="min-w-0 flex-1 rounded-control border border-border bg-sunken px-2 py-1 text-right text-body font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitName(); } }}
        />
      </label>
      <div className="flex min-h-11 items-center gap-3">
        <span className="shrink-0 text-body text-secondary">{t("hq.identity.avatar")}</span>
        <HqAvatar name={name} avatarUrl={avatarUrl} size={64} />
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <button type="button" className={ACTION} onClick={() => picker.current?.click()}>
            {t("hq.identity.change")}
          </button>
          {avatarUrl ? (
            <button type="button" className={ACTION} onClick={() => void identity.clearAvatar().then(settle)}>
              {t("hq.identity.remove")}
            </button>
          ) : null}
        </span>
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          data-hq-avatar-input
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            /* The input is cleared so picking the SAME file twice still fires. */
            event.target.value = "";
            if (file) void identity.saveAvatar(file).then(settle);
          }}
        />
      </div>
      {status ? (
        <p role="status" className={`text-caption ${status.bad ? "text-danger" : "text-secondary"}`}>{status.text}</p>
      ) : null}
    </div>
  );
}
