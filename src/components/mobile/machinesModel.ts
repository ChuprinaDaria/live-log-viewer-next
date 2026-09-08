"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * The machines an agent can be started on, and what is known about each.
 *
 * Probing costs an ssh round trip per machine and a sleeping desktop spends
 * the full timeout, so the list arrives once and is refreshed on demand rather
 * than polled. A machine that did not answer says so; nobody wakes it to draw
 * a green dot.
 */

export interface MachineRow {
  id: string;
  ssh: string | null;
  hostname?: string;
  work_root?: string;
  engines: string[];
  tailscale?: string;
  note?: string;
  is_local?: boolean;
  status?: { reachable: boolean; detail: string };
  engines_present?: Record<string, boolean>;
}

export interface MachinesRead {
  machines: MachineRow[] | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Accounts enrolled on one machine; empty until asked. */
  accountsOn: (host: string) => Promise<{ profiles: string[]; error?: string }>;
  /** The tmux sessions running on one machine; empty until asked. */
  sessionsOn: (host: string) => Promise<{ sessions: SessionRow[]; error?: string }>;
  /** Resolves with the console's refusal, or the started session. */
  spawn: (input: SpawnInput) => Promise<{ error?: string; session?: SpawnResult }>;
  /** Same shape as spawn: the work moves, the process does not. */
  transfer: (input: TransferInput) => Promise<{ error?: string; session?: SpawnResult }>;
}

export interface SpawnInput {
  host: string;
  project: string;
  engine?: string;
  account?: string;
  model?: string;
  prompt?: string;
  name?: string;
  cwd?: string;
  /** Pull (or clone) fresh code before starting, instead of reusing what is
      already checked out. */
  fresh?: boolean;
}

/** A tmux session as the machine reports it. */
export interface SessionRow {
  tmux: string;
  windows?: string;
  created_at?: string;
}

/** Moving a session that already exists. `host` is where it goes; `session`
    is the tmux name it has now, on `from_host` if that is not this machine. */
export interface TransferInput extends SpawnInput {
  session: string;
  from_host?: string;
}

export interface SpawnResult {
  host: string;
  project: string;
  engine: string;
  tmux: string;
  cwd: string;
  binary?: string;
  account?: string | null;
  isolated_profile?: string | null;
  attach: string;
  prompt_delivered?: boolean;
  note?: string;
  /** What the console did about the code before starting, when `fresh` asked
      for it: `{ action: "pulled" }`, `{ action: "cloned" }`, and so on. */
  code?: { action: string; detail?: string };
}

export function useMachines(): MachinesRead {
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/machines", { cache: "no-store", ...(signal ? { signal } : {}) });
      const body = await response.json() as { hosts?: MachineRow[]; error?: string };
      if (!response.ok) setError(body.error ?? `HTTP ${response.status}`);
      else { setMachines(body.hosts ?? []); setError(null); }
    } catch (cause) {
      if ((cause as { name?: string }).name !== "AbortError") setError("UNREACHABLE");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const accountsOn = useCallback(async (host: string) => {
    try {
      const response = await fetch(`/api/machines?host=${encodeURIComponent(host)}&accounts=1`, { cache: "no-store" });
      const body = await response.json() as { profiles?: string[]; error?: string };
      if (!response.ok) return { profiles: [], error: body.error ?? `HTTP ${response.status}` };
      return { profiles: body.profiles ?? [] };
    } catch (cause) {
      return { profiles: [], error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, []);

  /* Starting and moving differ by one field in the body, so they share the
     request: the route reads `session` and decides which it was asked for. */
  const post = useCallback(async (input: SpawnInput | TransferInput) => {
    try {
      const response = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json() as SpawnResult & { error?: string };
      if (!response.ok) return { error: body.error ?? `HTTP ${response.status}` };
      return { session: body };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, []);

  const sessionsOn = useCallback(async (host: string) => {
    try {
      const response = await fetch(`/api/machines?host=${encodeURIComponent(host)}&sessions=1`, { cache: "no-store" });
      const body = await response.json() as { sessions?: SessionRow[]; error?: string };
      if (!response.ok) return { sessions: [], error: body.error ?? `HTTP ${response.status}` };
      return { sessions: body.sessions ?? [] };
    } catch (cause) {
      return { sessions: [], error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, []);

  const spawn = useCallback((input: SpawnInput) => post(input), [post]);

  /* Transfer posts to the same route: the body carrying a `session` is what
     tells the console to move work instead of starting it. */
  const transfer = useCallback(
    (input: TransferInput) => post(input),
    [post],
  );

  return { machines, error, loading, refresh: () => load(), accountsOn, sessionsOn, spawn, transfer };
}

/** «this machine · <work root>» — what the machine is, in one line. */
export function machineLine(machine: MachineRow): string {
  const parts = [machine.is_local ? "ця машина" : machine.ssh ?? "", machine.work_root ?? ""];
  return parts.filter(Boolean).join(" · ");
}

/** Engines actually present, not the ones the record intends to have. */
export function enginesPresent(machine: MachineRow): string[] {
  const present = machine.engines_present;
  if (!present) return machine.engines;
  return Object.entries(present).filter(([, ok]) => ok).map(([engine]) => engine);
}
