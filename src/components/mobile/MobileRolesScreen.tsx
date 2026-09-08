"use client";

import { useState } from "react";

import { ChevronDown, Loader2 } from "@/components/icons";
import { useLocale } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { roleRuntimeLine, useRoles, type RoleRow, type RolesRead } from "./rolesModel";

/* The console is the catalog source. Unsupported role IDs remain visible but
   read-only, because the board's editor and launch contracts still use seeds. */

export function MobileRolesScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const roles = useRoles();
  const [open, setOpen] = useState<string | null>(null);
  const editable = roles.source === "fleetctl";

  return (
    <MobileShell screen="roles" title={<MobileBarTitle>{t("roles.title")}</MobileBarTitle>} back host={host} renderSheet={renderSheet}>
      <div className="settings-scroll flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-roles>
        <div className="mb-3 flex items-start gap-2">
          <p className="min-w-0 flex-1 text-caption leading-snug text-muted">{t(editable ? "roles.sourceConsole" : "roles.sourceFallback")}</p>
          <button type="button" onClick={() => void roles.refresh()} disabled={roles.loading} className="min-h-11 shrink-0 rounded-control border border-border px-3 text-body text-primary disabled:opacity-50">{t("roles.refresh")}</button>
        </div>
        {roles.error || roles.warning ? <p role="alert" className="mb-3 text-body text-danger" data-mobile2-roles-error>{t(roles.roles ? "roles.stale" : "roles.unreachable")}</p> : null}
        {roles.roles === null ? (
          roles.loading ? <div className="flex flex-1 items-center justify-center gap-2 text-body text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t("common.loading")}</div> : null
        ) : (
          <>
            <div className="flex shrink-0 flex-col divide-y divide-border rounded-surface border border-border bg-card">
              {roles.roles.map((role) => (
                <RoleRowView
                  key={role.id}
                  role={role}
                  editable={editable && role.editable === true}
                  open={open === role.id}
                  onToggle={() => setOpen((was) => (was === role.id ? null : role.id))}
                  save={roles.save}
                />
              ))}
            </div>
          </>
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
  // Refresh follows the server only while clean. A local edit survives an
  // external change; our own successful Save/Reset adopts its read-back text.
  const [pinned, setPinned] = useState(role.promptScaffold);
  if (pinned !== role.promptScaffold) {
    if (draft === pinned) setDraft(role.promptScaffold);
    setPinned(role.promptScaffold);
  }
  const dirty = draft !== role.promptScaffold;

  const run = async (change: Parameters<RolesRead["save"]>[1], kind: "save" | "reset") => {
    setBusy(kind);
    const result = await save(role.id, change);
    setFailure(result.error);
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
        {role.edited ? <span className="shrink-0 text-caption font-semibold text-accent">{t("roles.edited")}</span> : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border bg-sunken px-3 py-3" data-mobile2-role-editor={role.id}>
          {role.description ? <p className="text-caption leading-snug text-secondary">{role.description}</p> : null}
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
                <button
                  type="button"
                  data-mobile2-role-reset={role.id}
                  disabled={busy !== null || !role.edited || role.seedPromptScaffold === undefined}
                  className="inline-flex min-h-11 items-center rounded-control border border-border px-3 text-body text-secondary active:bg-canvas disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  onClick={() => void run({ reset: true }, "reset")}
                >
                  {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("roles.reset")}
                </button>
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
          {failure ? <p className="text-caption leading-snug text-danger" data-mobile2-role-failure>{failure}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
