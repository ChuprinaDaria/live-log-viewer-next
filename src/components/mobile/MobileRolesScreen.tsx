"use client";

import { useState } from "react";

import { ChevronDown, Loader2 } from "@/components/icons";
import { useLocale } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { roleRuntimeLine, useRoles, type RoleRow, type RolesRead } from "./rolesModel";

/*
 * «Ролі» (TZ-UI.md): the eight agent roles as data the operator edits, not as
 * a table she reads. A row shows the role, its runtime and whether it has been
 * changed; a tap opens the prompt, editable in place, with «повернути
 * початковий» beside it.
 *
 * Every write goes through the console (`/api/roles` → fleetctl), which is the
 * one writer of the role store: the CLI, the MCP server and this page are
 * three doors onto the same file. Editing beside it — writing the store from
 * here — is exactly how a dashboard and a CLI start disagreeing.
 *
 * The console can be absent. Then the page still lists the built-in catalog
 * and says plainly that it is not editable here, rather than offering a field
 * whose Save would go nowhere.
 */

export function MobileRolesScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const roles = useRoles();
  const [open, setOpen] = useState<string | null>(null);
  const editable = roles.source === "fleetctl";

  return (
    <MobileShell screen="roles" title={<MobileBarTitle>{t("roles.title")}</MobileBarTitle>} back host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-roles>
        {roles.error && !roles.roles ? (
          <p className="flex-1 px-6 pt-10 text-center text-body text-secondary" data-mobile2-roles-error>{t("roles.unreachable")}</p>
        ) : roles.roles === null ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-body text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("common.loading")}
          </div>
        ) : (
          <>
            <p className="px-1 pb-2 text-caption leading-snug text-muted">
              {t(editable ? "roles.sourceConsole" : "roles.sourceFallback")}
            </p>
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card">
              {roles.roles.map((role) => (
                <RoleRowView
                  key={role.id}
                  role={role}
                  editable={editable}
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
  /* The draft follows the console's copy while the row is closed, so a row
     reopened after someone else edited the role shows THEIR text, not a stale
     one this tab typed and never sent. */
  const [pinned, setPinned] = useState(role.promptScaffold);
  if (!open && pinned !== role.promptScaffold) { setPinned(role.promptScaffold); setDraft(role.promptScaffold); }
  const dirty = draft !== role.promptScaffold;

  const run = async (change: Parameters<RolesRead["save"]>[1], kind: "save" | "reset") => {
    setBusy(kind);
    setFailure(await save(role.id, change));
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
          <span className="block truncate text-body font-semibold text-primary">{role.name}</span>
          <span className="mt-0.5 block truncate font-mono text-caption text-muted">{roleRuntimeLine(role)}</span>
        </span>
        {role.edited ? <span className="shrink-0 text-caption font-semibold text-accent">{t("roles.edited")}</span> : null}
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border bg-sunken px-3 py-3" data-mobile2-role-editor={role.id}>
          {role.description ? <p className="text-caption leading-snug text-secondary">{role.description}</p> : null}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            readOnly={!editable}
            spellCheck={false}
            rows={12}
            aria-label={t("roles.promptAria", { role: role.name })}
            className="w-full resize-y rounded-control border border-border bg-card px-3 py-2 font-mono text-caption leading-snug text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 read-only:text-secondary"
          />
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-caption text-muted">
              {role.updatedAt ? t("roles.updatedAt", { at: role.updatedAt }) : t("roles.chars", { count: draft.length })}
            </span>
            {editable ? (
              <>
                <button
                  type="button"
                  data-mobile2-role-reset={role.id}
                  disabled={busy !== null || !role.edited}
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
