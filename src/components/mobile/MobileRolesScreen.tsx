"use client";

import { useState } from "react";

import { ChevronDown, Loader2 } from "@/components/icons";
import { useLocale } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { degradationKey, roleClock, roleHasSeed, roleRuntimeLine, useRoles, type RoleRow, type RolesRead } from "./rolesModel";

/* The console is the catalog source, and the only writer. Every claim on this
   screen is the server's own verdict: whether the console can write a role,
   whether the LAUNCH path accepts its config, and which consumers refuse it
   before anything starts. A degraded read says why it degraded and keeps the
   last list visible, dated — never a silent fallback that reads as success. */

export function MobileRolesScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const roles = useRoles();
  const [open, setOpen] = useState<string | null>(null);
  const fromConsole = roles.source === "fleetctl";
  const degraded = degradationKey(roles.degraded);
  /* Rows kept from the last good read stay readable, and stay put — but the
     console cannot take a write right now, so nothing offers one. */
  const writable = fromConsole && !roles.degraded;

  return (
    <MobileShell screen="roles" title={<MobileBarTitle>{t("roles.title")}</MobileBarTitle>} back host={host} renderSheet={renderSheet}>
      <div className="settings-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-roles>
        <div className="mb-3 flex items-start gap-2">
          <p className="min-w-0 flex-1 text-caption leading-snug text-muted" data-mobile2-roles-source>
            {t(fromConsole ? "roles.sourceConsole" : "roles.sourceFallback", { count: roles.roles?.length ?? 0, at: roleClock(roles.readAt) })}
          </p>
          <button type="button" onClick={() => void roles.refresh()} disabled={roles.loading} className="min-h-11 shrink-0 rounded-control border border-border px-3 text-body text-primary disabled:opacity-50">{t("roles.refresh")}</button>
        </div>
        {/* The reason sits ABOVE the list the operator can still read, with the
            one action that can change it. A failed read never silently swaps in
            an older catalog as if it were fresh. */}
        {roles.error || degraded ? (
          <div role="alert" className="mb-3 flex flex-col gap-2 rounded-surface border border-danger/40 bg-card px-3 py-2" data-mobile2-roles-error>
            <p className="text-body leading-snug text-danger">
              {roles.error || roles.stale ? t(roles.roles ? "roles.stale" : "roles.unreachable", { at: roleClock(roles.readAt) }) : null}
              {(roles.error || roles.stale) && degraded ? " " : null}
              {degraded ? t(degraded, { detail: roles.degraded?.detail ?? "" }) : null}
            </p>
            <button
              type="button"
              data-mobile2-roles-retry
              onClick={() => void roles.refresh()}
              disabled={roles.loading}
              className="self-start rounded-control border border-border px-3 py-1 text-body text-primary disabled:opacity-50"
            >
              {t("roles.retry")}
            </button>
          </div>
        ) : null}
        {roles.roles === null ? (
          roles.loading ? <div className="flex flex-1 items-center justify-center gap-2 text-body text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t("common.loading")}</div> : null
        ) : (
          <div className="flex shrink-0 flex-col divide-y divide-border rounded-surface border border-border bg-card">
            {roles.roles.map((role) => (
              <RoleRowView
                key={role.id}
                role={role}
                editable={writable && role.editable === true}
                open={open === role.id}
                onToggle={() => setOpen((was) => (was === role.id ? null : role.id))}
                save={roles.save}
              />
            ))}
          </div>
        )}
      </div>
    </MobileShell>
  );
}

function RoleRowView({ role, editable, open, onToggle, save }: {
  role: RoleRow;
  editable: boolean;
  open: boolean;
  onToggle: () => void;
  save: RolesRead["save"];
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(role.promptScaffold);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  /* What the unconfirmed write sent. A later read that shows exactly this is
     the confirmation the write never got, so the warning retires itself —
     otherwise «not confirmed» would sit above a textarea and a disabled Save
     that both already agree with the console. */
  const [unconfirmedText, setUnconfirmedText] = useState<string | null>(null);
  // Refresh follows the server only while clean. A local edit survives an
  // external change; our own successful Save/Reset adopts its read-back text.
  const [pinned, setPinned] = useState(role.promptScaffold);
  if (pinned !== role.promptScaffold) {
    if (draft === pinned) setDraft(role.promptScaffold);
    setPinned(role.promptScaffold);
  }
  if (unconfirmed !== null && unconfirmedText !== null && role.promptScaffold === unconfirmedText) {
    setUnconfirmed(null);
    setUnconfirmedText(null);
  }
  const dirty = draft !== role.promptScaffold;
  const blocked = role.launchable === false;
  const unsupported = (role.unsupported ?? []).length > 0;

  const run = async (change: Parameters<RolesRead["save"]>[1], kind: "save" | "reset") => {
    setBusy(kind);
    const result = await save(role.id, change);
    setFailure(result.error);
    /* A write that landed with no confirmed read-back leaves the draft ALONE:
       the text on screen is what we sent, not what the console holds, and the
       operator is told to re-read rather than to write again. */
    setUnconfirmed(result.unconfirmed ?? null);
    setUnconfirmedText(result.unconfirmed === undefined
      ? null
      : ("reset" in change ? role.seedPromptScaffold ?? null : change.prompt ?? null));
    if (result.role && !result.error) {
      setDraft(result.role.promptScaffold);
      setPinned(result.role.promptScaffold);
    }
    setBusy(null);
  };

  return (
    <div data-mobile2-role={role.id}>
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-2 px-3 py-2 text-left active:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        onClick={onToggle}
      >
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-body font-semibold text-primary">{role.name}</span>
          <span className="mt-0.5 block break-words font-mono text-caption text-muted">{roleRuntimeLine(role)}</span>
        </span>
        {blocked ? <span className="shrink-0 text-caption font-semibold text-danger" data-mobile2-role-blocked={role.id}>{t("roles.blockedBadge")}</span> : null}
        {!blocked && role.edited ? <span className="shrink-0 text-caption font-semibold text-accent">{t("roles.edited")}</span> : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border bg-sunken px-3 py-3" data-mobile2-role-editor={role.id}>
          {role.description ? <p className="text-caption leading-snug text-secondary">{role.description}</p> : null}
          {/* The launch verdict first: it decides whether editing this role can
              change anything at all. */}
          {blocked
            ? <p className="text-caption leading-snug text-danger" data-mobile2-role-reason>{t("roles.blocked", { reason: role.blockedReason ?? "" })}</p>
            : <p className="text-caption leading-snug text-secondary">{t("roles.launchable")}</p>}
          {unsupported ? <p className="text-caption leading-snug text-secondary" data-mobile2-role-unsupported>{t("roles.unsupportedConsumers")}</p> : null}
          {/* Delegation is a policy, not a preference: a role the board cannot
              classify launches, but creates no child agents. Said here, not
              discovered when a child spawn is refused mid-run. */}
          {role.canDelegate === false ? <p className="text-caption leading-snug text-secondary" data-mobile2-role-nodelegation>{t("roles.noDelegation")}</p> : null}
          {role.origin === "local" ? <p className="text-caption leading-snug text-secondary" data-mobile2-role-own>{t("roles.own")}</p> : null}
          <p className="text-caption leading-snug text-muted">{t("roles.runtimeConsoleOnly")}</p>
          {!editable ? <p className="text-caption text-secondary">{t("roles.readOnly")}</p> : null}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            readOnly={!editable}
            disabled={busy !== null}
            spellCheck={false}
            rows={12}
            aria-label={t("roles.promptAria", { role: role.name })}
            className="w-full min-w-0 resize-y rounded-control border border-border bg-card px-3 py-2 font-mono text-caption leading-snug text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 read-only:text-secondary"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="w-full break-words text-caption text-muted">
              {role.updatedAt ? t("roles.updatedAt", { at: role.updatedAt }) : t("roles.chars", { count: draft.length })}
            </span>
            {editable ? (
              <>
                {/* Reset only where a seed exists: the console refuses the rest,
                    and a button that cannot work is not offered. */}
                {roleHasSeed(role) ? (
                  <button
                    type="button"
                    data-mobile2-role-reset={role.id}
                    disabled={busy !== null || !role.edited}
                    className="inline-flex min-h-11 items-center rounded-control border border-border px-3 text-body text-secondary active:bg-canvas disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    onClick={() => void run({ reset: true }, "reset")}
                  >
                    {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("roles.reset")}
                  </button>
                ) : null}
                <button
                  type="button"
                  data-mobile2-role-save={role.id}
                  disabled={busy !== null || !dirty}
                  className="inline-flex min-h-11 items-center rounded-control border border-accent px-4 text-body font-semibold text-accent active:bg-accent-soft disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  onClick={() => void run({ prompt: draft }, "save")}
                >
                  {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("roles.save")}
                </button>
              </>
            ) : null}
          </div>
          {editable ? <p className="text-caption leading-snug text-muted">{t("roles.nextRunOnly")}</p> : null}
          {unconfirmed ? <p className="text-caption leading-snug text-warning" data-mobile2-role-unconfirmed>{t("roles.savedUnconfirmed", { detail: unconfirmed })}</p> : null}
          {failure ? <p className="text-caption leading-snug text-danger" data-mobile2-role-failure>{failure}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
