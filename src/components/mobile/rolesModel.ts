"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MessageKey } from "@/lib/i18n";

/*
 * The role catalog as the phone reads it: the console's own answer, and the
 * two writes the page can make. Every write goes through `/api/roles`, which
 * shells out to the console — the page never touches the store itself, so the
 * CLI, the MCP server and this screen cannot drift apart.
 *
 * Everything the screen says about a role comes from the server's verdicts —
 * `editable`, `launchable`, `blockedReason`, `unsupported` — and never from a
 * guess made here. `launchable` is the LAUNCH path's own answer (§1.1 of the
 * audit): «доступна для запуску» cannot disagree with what the launch does.
 */

export interface RoleRow {
  id: string;
  editable?: boolean;
  name: string;
  description: string;
  config: { engine: string; model: string; effort: string };
  promptScaffold: string;
  edited: boolean;
  updatedAt: string | null;
  seedPromptScaffold?: string;
  /** `local` for a role the operator created in the console: it has no seed. */
  origin?: "seed" | "local";
  /** The launch path resolves this role's runtime config. */
  launchable?: boolean;
  /** Why a launch would refuse it, in the launch validator's words. */
  blockedReason?: string | null;
  /** Consumers that refuse this role BEFORE a launch. */
  unsupported?: readonly ("pipeline" | "mcp")[];
  grants?: { mcp: string[]; skills: string[] };
}

/** Why the catalog is not the console's live answer, with the console's own
    message when it had one. */
export interface RolesDegradation {
  reason: string;
  detail: string | null;
}

export interface RolesRead {
  roles: RoleRow[] | null;
  /** "fleetctl" when the console answered, "fallback" when the built-in
      catalog did — the page says which, because only one of them is editable. */
  source: string | null;
  /** When the shown catalog was read, so a stale list can date itself. */
  readAt: string | null;
  error: string | null;
  degraded: RolesDegradation | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Writes one role and returns the server read-back, or its error. */
  save: (role: string, change: RoleChange) => Promise<RoleWrite>;
}

/** The three outcomes of a write, kept apart: confirmed, landed-but-unconfirmed,
    and refused. A landed write reported as a failure invites a second blind
    write of the same text. */
export interface RoleWrite {
  role?: RoleRow;
  /** The write landed; the read-back that would confirm it did not. */
  unconfirmed?: string;
  error: string | null;
}

export type RoleChange =
  | { reset: true }
  | { prompt?: string; engine?: string; model?: string; effort?: string };

export function useRoles(): RolesRead {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<RolesDegradation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const readGeneration = useRef(0);
  const writesInFlight = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    // A GET begun during a write can also capture pre-write state. Leave it
    // to a refresh after the write, rather than racing the POST read-back.
    if (writesInFlight.current > 0) return;
    const generation = ++readGeneration.current;
    const current = () => generation === readGeneration.current && !signal?.aborted;
    setLoading(true);
    try {
      const response = await fetch("/api/roles", { cache: "no-store", ...(signal ? { signal } : {}) });
      const body = await response.json() as {
        roles?: RoleRow[]; source?: string; readAt?: string; degraded?: RolesDegradation | null; error?: string;
      };
      if (!current()) return;
      if (!response.ok || !body.roles) setError(body.error ?? `HTTP ${response.status}`);
      else {
        setRoles(body.roles);
        setSource(body.source ?? null);
        setReadAt(body.readAt ?? null);
        setDegraded(body.degraded ?? null);
        setError(null);
      }
    } catch (cause) {
      if (current() && (cause as { name?: string }).name !== "AbortError") setError("UNREACHABLE");
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const save = useCallback(async (role: string, change: RoleChange): Promise<RoleWrite> => {
    // Invalidate earlier reads when the write starts, not just when it ends:
    // stale fallback/error/source responses must not change an active editor.
    readGeneration.current += 1;
    writesInFlight.current += 1;
    setLoading(true);
    try {
      const response = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, ...change }),
      });
      const body = await response.json() as { role?: RoleRow | null; written?: boolean; unconfirmed?: string; error?: string };
      if (!response.ok) return { error: body.error ?? `HTTP ${response.status}` };
      /* The console took the write but could not be re-read. The row keeps the
         text it had — nothing here has been confirmed — and the screen offers a
         re-read instead of another write. */
      if (!body.role) return { error: null, unconfirmed: body.unconfirmed ?? `HTTP ${response.status}` };
      const updated = body.role;
      setRoles((was) => (was ?? []).map((row) => (row.id === updated.id ? updated : row)));
      return { role: updated, error: null };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      writesInFlight.current -= 1;
      setLoading(writesInFlight.current > 0);
    }
  }, []);

  return { roles, source, readAt, error, degraded, loading, refresh: () => load(), save };
}

/** The one-line summary under a role's name: engine, model, effort. */
export function roleRuntimeLine(role: RoleRow): string {
  return [role.config.engine, role.config.model, role.config.effort].filter(Boolean).join(" · ");
}

/** Whether the draft differs from what the console holds. */
export function roleDirty(role: RoleRow, draft: string): boolean {
  return draft !== role.promptScaffold;
}

/** Reset exists only for a role with a known seed: `role_reset` refuses the
    rest, and «повернути початковий» has no meaning for a role written by hand. */
export function roleHasSeed(role: RoleRow): boolean {
  return typeof role.seedPromptScaffold === "string";
}

/** The i18n key naming why the catalog is degraded, or null when it is not. */
export function degradationKey(degraded: RolesDegradation | null): MessageKey | null {
  if (!degraded) return null;
  if (degraded.reason === "console-missing") return "roles.degradedMissing";
  if (degraded.reason === "console-empty") return "roles.degradedEmpty";
  if (degraded.reason === "invalid-overrides") return "roles.degradedOverrides";
  return "roles.degradedUnavailable";
}

/** A read timestamp as the operator's clock shows it; the raw value when it is
    not a time the browser can parse. */
export function roleClock(at: string | null): string {
  if (!at) return "—";
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? at : parsed.toLocaleTimeString();
}
