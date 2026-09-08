"use client";

/* Named `useLaunchForm.ts` rather than `launchForm.ts`: Bun 1.4.2's bundler
   resolves an extensionless import case-insensitively when a file whose name
   differs only in the first letter's case sits in the same directory — with
   `LaunchForm.tsx` present, `./launchForm` resolved to *it* instead of this
   file (`ENOENT .../launchForm.tsx`, then a "named export not found" once the
   wrong module loaded). Reproduced in isolation before renaming; not a typo. */

import { useEffect, useState } from "react";

import { defaultModelFor } from "@/lib/agent/models";
import {
  enginesPresent,
  useMachines,
  type MachineRow,
  type MachinesRead,
  type SessionRow,
  type SpawnResult,
} from "@/components/mobile/machinesModel";
import { useOrg, type OrgRead } from "@/components/mobile/firmsModel";

/*
 * The state behind the launch form: which machine, which project, which LLM
 * and model, which subscription, whether to refresh the checkout first, and
 * the first prompt — plus the "move" variant of the same question (a source
 * machine and a running tmux session instead of a fresh prompt).
 *
 * This used to live inline in `MobileMachinesScreen`. It moves here so the
 * desktop console column can mount the same form beside the org tree instead
 * of reimplementing it — a second copy of "start an agent" would drift from
 * the first the moment either grew a field the other lacked.
 */

export type LaunchMode = "start" | "move";

export interface UseLaunchFormOptions {
  /** Console project id to start with; the picker stays editable. */
  initialProject?: string;
  initialMode?: LaunchMode;
  initialSession?: { host: string; tmux: string };
  onStarted?: (result: SpawnResult, moved: boolean) => void;
}

export interface LaunchFormState {
  machines: MachinesRead;
  org: OrgRead;

  target: string;
  setTarget: (host: string) => void;
  chosen: MachineRow | undefined;
  /** Engines the chosen machine actually has; both, before a machine is picked. */
  engines: string[];

  project: string;
  setProject: (project: string) => void;

  engine: string;
  /** Also resets `model` to that engine's default. */
  setEngine: (engine: string) => void;

  model: string;
  setModel: (model: string) => void;

  account: string;
  setAccount: (account: string) => void;
  accounts: string[];

  fresh: boolean;
  setFresh: (fresh: boolean) => void;

  prompt: string;
  setPrompt: (prompt: string) => void;

  mode: LaunchMode;
  setMode: (mode: LaunchMode) => void;
  moving: boolean;

  source: string;
  setSource: (host: string) => void;
  session: string;
  setSession: (tmux: string) => void;
  sessions: SessionRow[];

  busy: boolean;
  failure: string | null;
  started: SpawnResult | null;
  startedMoved: boolean;

  ready: boolean;
  start: () => Promise<void>;
}

export function useLaunchForm(options: UseLaunchFormOptions = {}): LaunchFormState {
  const machines = useMachines();
  const org = useOrg();

  const [target, setTarget] = useState(options.initialSession?.host ?? "");
  const [project, setProject] = useState(options.initialProject ?? "");
  const [engine, setEngineRaw] = useState("claude");
  const [model, setModel] = useState(defaultModelFor("claude"));
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [fresh, setFresh] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [started, setStarted] = useState<SpawnResult | null>(null);
  const [startedMoved, setStartedMoved] = useState(false);

  /* Starting and moving are the same form with one extra question: which
     session, and where it is now. A separate screen would have duplicated the
     machine, project, engine and account pickers to change one verb. */
  const [mode, setMode] = useState<LaunchMode>(options.initialMode ?? "start");
  const [source, setSource] = useState(options.initialSession?.host ?? "");
  const [session, setSession] = useState(options.initialSession?.tmux ?? "");
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  /* Accounts belong to the machine, so the picker is refilled whenever the
     machine changes and cleared while the answer is on its way.

     The effect deps name the specific `useCallback`s, not the `machines`
     object itself: `useMachines()` returns a fresh object every render, and
     depending on the whole thing would re-run this effect (and its `setState`
     calls with new empty-array references) every render forever. */
  const { accountsOn, sessionsOn } = machines;
  useEffect(() => {
    setAccount("");
    setAccounts([]);
    if (!target) return;
    let live = true;
    void accountsOn(target).then((answer) => {
      if (live) setAccounts(answer.profiles);
    });
    return () => { live = false; };
  }, [target, accountsOn]);

  /* Sessions belong to the source machine, same as accounts to the target. */
  useEffect(() => {
    setSession("");
    setSessions([]);
    if (!source) return;
    let live = true;
    void sessionsOn(source).then((answer) => {
      if (live) setSessions(answer.sessions);
    });
    return () => { live = false; };
  }, [source, sessionsOn]);

  /* The model catalog is per engine, so switching the LLM without resetting
     the model would routinely leave a Codex id selected under Claude. */
  function setEngine(next: string) {
    setEngineRaw(next);
    setModel(defaultModelFor(next === "codex" ? "codex" : "claude"));
  }

  const chosen = machines.machines?.find((row) => row.id === target);
  const engines = chosen ? enginesPresent(chosen) : ["claude", "codex"];
  const moving = mode === "move";
  const ready = Boolean(target && project && !busy && (!moving || (source && session)));

  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setFailure(null);
    const common = {
      host: target, project, engine, model,
      ...(account ? { account } : {}),
      fresh,
    };
    /* A move carries no first prompt: the brief comes from the work that
       already happened on the source machine. */
    const answer = moving
      ? await machines.transfer({ ...common, session, from_host: source })
      : await machines.spawn({ ...common, ...(prompt.trim() ? { prompt } : {}) });
    setBusy(false);
    if (answer.error) { setFailure(answer.error); return; }
    const result = answer.session ?? null;
    setStarted(result);
    setStartedMoved(moving);
    setPrompt("");
    if (result) options.onStarted?.(result, moving);
  };

  return {
    machines, org,
    target, setTarget, chosen, engines,
    project, setProject,
    engine, setEngine,
    model, setModel,
    account, setAccount, accounts,
    fresh, setFresh,
    prompt, setPrompt,
    mode, setMode, moving,
    source, setSource, session, setSession, sessions,
    busy, failure, started, startedMoved,
    ready, start,
  };
}
