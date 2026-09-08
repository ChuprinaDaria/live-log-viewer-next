"use client";

import type { ReactNode } from "react";

import { useLocale } from "@/lib/i18n";
import { ENGINE_MODELS } from "@/lib/agent/models";
import { machineLine, type SpawnResult } from "@/components/mobile/machinesModel";
import { projectTree } from "@/components/mobile/firmsModel";

import { useLaunchForm, type LaunchMode } from "./useLaunchForm";

/*
 * Start an agent: on which machine, in which project, with which LLM and
 * model, under which subscription, with fresh code or not, and — unless this
 * is a move — with which first prompt.
 *
 * One form, two hosts: the phone renders it full-size (44px rows, label above
 * control) inside `MobileMachinesScreen`, the desktop renders it `compact`
 * (32px rows, label beside control) in the 280px console column. The fields
 * and their order are identical either way — only the chrome differs.
 */

export interface LaunchFormProps {
  /** Console project id to start with; the picker stays editable. */
  initialProject?: string;
  /** "start" or "move"; move needs a source machine and a tmux session. */
  initialMode?: LaunchMode;
  initialSession?: { host: string; tmux: string };
  /** Compact = desktop column (labels beside controls, 32px rows); default = phone (44px rows). */
  compact?: boolean;
  onStarted?: (result: SpawnResult, moved: boolean) => void;
}

const CARD = "flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card";

function Field({ label, compact, children }: { label: string; compact: boolean; children: ReactNode }) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span className="w-[84px] shrink-0 text-caption text-muted">{label}</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    );
  }
  return (
    <div className="pb-3">
      <label className="block pb-1 text-caption text-muted">{label}</label>
      {children}
    </div>
  );
}

export function LaunchForm({ initialProject, initialMode, initialSession, compact = false, onStarted }: LaunchFormProps) {
  const { t } = useLocale();
  const form = useLaunchForm({ initialProject, initialMode, initialSession, onStarted });
  const { machines, org } = form;

  const rowH = compact ? "min-h-8" : "min-h-11";
  const pillGap = compact ? "gap-1" : "gap-1.5";
  const pill = (active: boolean) => `${rowH} flex-1 rounded-[10px] px-2 text-label font-semibold ${active ? "bg-accent text-white" : "bg-quiet text-secondary"}`;
  const listPill = (active: boolean) => `${rowH} w-full rounded-[10px] px-3 text-left text-label ${active ? "bg-accent text-white" : "bg-quiet text-secondary"}`;
  const control = `${rowH} w-full rounded-[10px] border border-border bg-card px-3 text-body text-primary`;

  if (machines.error) {
    return (
      <div role="status" className="flex flex-col gap-2 px-1 text-label text-danger">
        <p>{machines.error === "UNREACHABLE" ? t("list.failed") : machines.error}</p>
        <button type="button" onClick={() => void machines.refresh()} className="min-h-11 rounded-[12px] bg-card px-3">{t("list.retry")}</button>
      </div>
    );
  }
  if (!machines.machines) {
    return <p role="status" className="px-1 text-label text-muted">{t("common.loading")}</p>;
  }

  const projects = org.projects ?? [];
  const firms = org.firms ?? [];
  const engineModels = ENGINE_MODELS[form.engine === "codex" ? "codex" : "claude"];

  return (
    <div className="flex flex-col gap-4" data-launch-form>
      {form.started ? (
        <div role="status" data-spawn-started className="flex flex-col gap-1 rounded-surface border border-success/40 bg-success-soft px-3 py-2">
          <p className="text-label font-semibold text-success">{t(form.startedMoved ? "machines.moved" : "machines.started", { name: form.started.tmux })}</p>
          <p className="text-caption text-secondary">{form.started.host} · {form.started.cwd}</p>
          {/* The one thing worth copying by hand: how to sit in it. */}
          <code className="truncate text-caption text-secondary">{form.started.attach}</code>
          {form.started.code?.action ? <p className="text-caption text-muted">{t("machines.code", { action: form.started.code.action })}</p> : null}
          {form.started.note ? <p className="text-caption text-muted">{form.started.note}</p> : null}
        </div>
      ) : null}
      {form.failure ? <p role="status" data-spawn-failure className="px-1 text-label text-danger">{form.failure}</p> : null}

      <section className={`${CARD} p-3`}>
        <div className={`flex ${pillGap} pb-3`} role="group" data-machines-mode>
          {(["start", "move"] as const).map((which) => (
            <button key={which} type="button" onClick={() => form.setMode(which)}
              aria-pressed={form.mode === which}
              className={pill(form.mode === which)}>
              {t(which === "start" ? "machines.modeStart" : "machines.modeMove")}
            </button>
          ))}
        </div>

        {form.moving ? (
          <>
            <Field label={t("machines.source")} compact={compact}>
              <div className={`flex flex-col ${pillGap}`} role="group" aria-label={t("machines.source")}>
                {machines.machines.map((row) => (
                  <button key={row.id} type="button" onClick={() => form.setSource(row.id)}
                    aria-pressed={form.source === row.id}
                    className={listPill(form.source === row.id)}>
                    <span className="block truncate font-semibold">{row.id}</span>
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t("machines.session")} compact={compact}>
              {form.source && form.sessions.length === 0 ? (
                <p className="text-caption text-muted">{t("machines.noSessions")}</p>
              ) : (
                <div className={`flex flex-col ${pillGap}`} role="group" aria-label={t("machines.session")} data-machines-sessions>
                  {form.sessions.map((row) => (
                    <button key={row.tmux} type="button" onClick={() => form.setSession(row.tmux)}
                      aria-pressed={form.session === row.tmux}
                      className={listPill(form.session === row.tmux)}>
                      <span className="block truncate font-semibold">{row.tmux}</span>
                      {row.windows ? <span className="block truncate text-caption opacity-80">{row.windows}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </Field>
          </>
        ) : null}

        <Field label={t("machines.machine")} compact={compact}>
          <div className={`flex flex-col ${pillGap}`} role="group" aria-label={t("machines.machine")}>
            {machines.machines.map((row) => {
              const up = row.status ? row.status.reachable : true;
              return (
                <button key={row.id} type="button" onClick={() => form.setTarget(row.id)}
                  aria-pressed={form.target === row.id}
                  disabled={!up}
                  title={!up ? row.status?.detail : undefined}
                  className={`${listPill(form.target === row.id)} disabled:opacity-40`}>
                  <span className="block truncate font-semibold">{row.id}</span>
                  <span className="block truncate text-caption opacity-80">{machineLine(row)}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t("machines.project")} compact={compact}>
          <select value={form.project} onChange={(event) => form.setProject(event.target.value)}
            aria-label={t("machines.project")} className={control}>
            <option value="">—</option>
            {firms.map((firm) => {
              const tree = projectTree(projects, firm.id);
              if (!tree.length) return null;
              return (
                <optgroup key={firm.id} label={firm.name || firm.id}>
                  {tree.flatMap((node) => [
                    <option key={node.row.id} value={node.row.id}>{node.row.name || node.row.id}</option>,
                    /* optgroup cannot nest, so a subfolder rides under its
                       parent's own group, indented in its label instead. */
                    ...node.children.map((child) => (
                      <option key={child.id} value={child.id}>{`— ${child.name || child.id}`}</option>
                    )),
                  ])}
                </optgroup>
              );
            })}
          </select>
        </Field>

        <Field label={t("machines.engine")} compact={compact}>
          <div className={`flex ${pillGap}`} role="group" aria-label={t("machines.engine")}>
            {form.engines.map((which) => (
              <button key={which} type="button" onClick={() => form.setEngine(which)}
                aria-pressed={form.engine === which}
                className={pill(form.engine === which)}>
                {which}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t("machines.model")} compact={compact}>
          <select value={form.model} onChange={(event) => form.setModel(event.target.value)}
            aria-label={t("machines.model")} className={control}>
            {engineModels.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </Field>

        <Field label={t("machines.account")} compact={compact}>
          {form.accounts.length === 0 ? (
            <p className="text-caption text-muted">
              {form.target ? t("machines.noAccounts") : t("machines.pickMachineFirst")}
            </p>
          ) : (
            <div className={`flex flex-col ${pillGap}`} role="group" aria-label={t("machines.account")}>
              <button type="button" onClick={() => form.setAccount("")} aria-pressed={form.account === ""}
                className={listPill(form.account === "")}>
                {t("machines.machineDefault")}
              </button>
              {form.accounts.map((row) => (
                <button key={row} type="button" onClick={() => form.setAccount(row)} aria-pressed={form.account === row}
                  className={`${listPill(form.account === row)} truncate`}>
                  {row}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label={t("machines.fresh")} compact={compact}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.fresh} onChange={(event) => form.setFresh(event.target.checked)}
              aria-label={t("machines.fresh")} className="h-4 w-4" />
            <span className="text-label text-secondary">{t("machines.fresh")}</span>
          </label>
        </Field>

        {form.moving ? null : (
          <Field label={t("machines.prompt")} compact={compact}>
            <textarea value={form.prompt} onChange={(event) => form.setPrompt(event.target.value)}
              rows={compact ? 2 : 3} aria-label={t("machines.prompt")}
              className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-body text-primary" />
          </Field>
        )}

        <button type="button" disabled={!form.ready} onClick={() => void form.start()}
          className={`${rowH} mt-3 w-full rounded-[10px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50`}>
          {form.busy ? t("common.loading") : t(form.moving ? "machines.move" : "machines.start")}
        </button>
      </section>
    </div>
  );
}
