"use client";

import { useEffect, useState } from "react";

import { useLocale } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { enginesPresent, machineLine, useMachines, type MachineRow, type SpawnResult } from "./machinesModel";
import { useOrg } from "./firmsModel";

/*
 * Start an agent: on which machine, in which project, under which account.
 *
 * This is the form TZ-UI §2 asked for and the dashboard never had. The three
 * choices are the ones the operator actually makes; everything else has a
 * defensible default, so the form is short enough to use on a phone.
 *
 * Machines and accounts are read, not typed: the machine list comes from the
 * console's registry with each one probed, and the accounts come from the
 * machine itself. A project is chosen from the org tree, which is what makes
 * «in this project» mean the same thing here as everywhere else.
 *
 * The account list is per machine on purpose — profiles are enrolled on the
 * box that holds them, and offering one that is not there would produce a
 * refusal at the last step instead of an absence at the first.
 */

const CARD = "flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card";

function MachineRowView({ machine }: { machine: MachineRow }) {
  const { t } = useLocale();
  const up = machine.status?.reachable;
  const engines = enginesPresent(machine);
  return (
    <div data-machine={machine.id} className="flex min-h-14 items-center gap-2.5 px-4 py-2">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-body font-semibold text-primary">{machine.id}</span>
          {machine.status ? (
            <span data-machine-reach={up ? "up" : "down"} title={machine.status.detail}
              className={`shrink-0 text-label font-semibold ${up ? "text-success" : "text-danger"}`}>
              {t(up ? "machines.up" : "machines.down")}
            </span>
          ) : null}
        </span>
        <span className="truncate text-label text-muted">{machineLine(machine)}</span>
        <span className="truncate text-caption text-muted">
          {engines.length ? engines.join(" · ") : t("machines.noEngines")}
        </span>
        {machine.status && !up ? (
          <span className="truncate text-caption text-warning">{machine.status.detail}</span>
        ) : null}
      </span>
    </div>
  );
}

export function MobileMachinesScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const machines = useMachines();
  const org = useOrg();

  const [target, setTarget] = useState("");
  const [project, setProject] = useState("");
  const [engine, setEngine] = useState("claude");
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [started, setStarted] = useState<SpawnResult | null>(null);

  /* Accounts belong to the machine, so the picker is refilled whenever the
     machine changes and cleared while the answer is on its way. */
  useEffect(() => {
    setAccount("");
    setAccounts([]);
    if (!target) return;
    let live = true;
    void machines.accountsOn(target).then((answer) => {
      if (live) setAccounts(answer.profiles);
    });
    return () => { live = false; };
  }, [target, machines]);

  const chosen = machines.machines?.find((row) => row.id === target);
  const engines = chosen ? enginesPresent(chosen) : ["claude", "codex"];
  const ready = target && project && !busy;

  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    const answer = await machines.spawn({
      host: target, project, engine,
      ...(account ? { account } : {}),
      ...(prompt.trim() ? { prompt } : {}),
    });
    setBusy(false);
    if (answer.error) { setFailure(answer.error); return; }
    setStarted(answer.session ?? null);
    setPrompt("");
  };

  const projects = org.projects ?? [];

  return (
    <MobileShell screen="machines" title={<MobileBarTitle>{t("machines.title")}</MobileBarTitle>} host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-machines>
        {machines.error ? (
          <div role="status" className="flex flex-col gap-2 px-1 text-label text-danger">
            <p>{machines.error === "UNREACHABLE" ? t("list.failed") : machines.error}</p>
            <button type="button" onClick={() => void machines.refresh()} className="min-h-11 rounded-[12px] bg-card px-3">{t("list.retry")}</button>
          </div>
        ) : !machines.machines ? (
          <p role="status" className="px-1 text-label text-muted">{t("common.loading")}</p>
        ) : (
          <>
            {started ? (
              <div role="status" data-spawn-started className="flex flex-col gap-1 rounded-surface border border-success/40 bg-success-soft px-3 py-2">
                <p className="text-label font-semibold text-success">{t("machines.started", { name: started.tmux })}</p>
                <p className="text-caption text-secondary">{started.host} · {started.cwd}</p>
                {/* The one thing worth copying by hand: how to sit in it. */}
                <code className="truncate text-caption text-secondary">{started.attach}</code>
                {started.note ? <p className="text-caption text-muted">{started.note}</p> : null}
              </div>
            ) : null}
            {failure ? <p role="status" data-spawn-failure className="px-1 text-label text-danger">{failure}</p> : null}

            <section className={`${CARD} p-3`}>
              <p className="pb-2 text-label font-semibold text-primary">{t("machines.startTitle")}</p>

              <label className="block pb-1 text-caption text-muted">{t("machines.machine")}</label>
              <div className="flex flex-col gap-1.5 pb-3">
                {machines.machines.map((row) => (
                  <button key={row.id} type="button" onClick={() => setTarget(row.id)}
                    aria-pressed={target === row.id}
                    disabled={row.status ? !row.status.reachable : false}
                    className={`min-h-11 w-full rounded-[12px] px-3 text-left text-label disabled:opacity-40 ${target === row.id ? "bg-accent text-white" : "bg-quiet text-secondary"}`}>
                    <span className="block truncate font-semibold">{row.id}</span>
                    <span className="block truncate text-caption opacity-80">{machineLine(row)}</span>
                  </button>
                ))}
              </div>

              <label className="block pb-1 text-caption text-muted">{t("machines.project")}</label>
              <select value={project} onChange={(event) => setProject(event.target.value)}
                aria-label={t("machines.project")}
                className="mb-3 min-h-11 w-full rounded-[12px] border border-border bg-card px-3 text-body text-primary">
                <option value="">—</option>
                {projects.map((row) => (
                  <option key={row.id} value={row.id}>{row.name || row.id}</option>
                ))}
              </select>

              <label className="block pb-1 text-caption text-muted">{t("machines.engine")}</label>
              <div className="flex gap-1.5 pb-3">
                {engines.map((which) => (
                  <button key={which} type="button" onClick={() => setEngine(which)}
                    aria-pressed={engine === which}
                    className={`min-h-11 flex-1 rounded-[12px] px-2 text-label font-semibold ${engine === which ? "bg-accent text-white" : "bg-quiet text-secondary"}`}>
                    {which}
                  </button>
                ))}
              </div>

              <label className="block pb-1 text-caption text-muted">{t("machines.account")}</label>
              {accounts.length === 0 ? (
                <p className="pb-3 text-caption text-muted">
                  {target ? t("machines.noAccounts") : t("machines.pickMachineFirst")}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 pb-3">
                  <button type="button" onClick={() => setAccount("")} aria-pressed={account === ""}
                    className={`min-h-11 w-full rounded-[12px] px-3 text-left text-label ${account === "" ? "bg-accent text-white" : "bg-quiet text-secondary"}`}>
                    {t("machines.machineDefault")}
                  </button>
                  {accounts.map((row) => (
                    <button key={row} type="button" onClick={() => setAccount(row)} aria-pressed={account === row}
                      className={`min-h-11 w-full truncate rounded-[12px] px-3 text-left text-label ${account === row ? "bg-accent text-white" : "bg-quiet text-secondary"}`}>
                      {row}
                    </button>
                  ))}
                </div>
              )}

              <label className="block pb-1 text-caption text-muted">{t("machines.prompt")}</label>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)}
                rows={3} aria-label={t("machines.prompt")}
                className="mb-3 w-full rounded-[12px] border border-border bg-card px-3 py-2 text-body text-primary" />

              <button type="button" disabled={!ready} onClick={() => void start()}
                className="min-h-11 w-full rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50">
                {busy ? t("common.loading") : t("machines.start")}
              </button>
            </section>

            <section className="flex flex-col gap-1.5">
              <h2 className="flex items-center gap-1.5 px-1 text-label font-semibold text-secondary">
                {t("machines.known")}
                <span className="text-caption font-semibold tabular-nums text-muted">{machines.machines.length}</span>
              </h2>
              <div className={CARD}>
                {machines.machines.map((row) => <MachineRowView key={row.id} machine={row} />)}
              </div>
            </section>
          </>
        )}
      </div>
    </MobileShell>
  );
}
