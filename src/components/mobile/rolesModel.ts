"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * The role catalog as the phone reads it: the console's own answer, and the
 * two writes the page can make. Every write goes through `/api/roles`, which
 * shells out to the console — the page never touches the store itself, so the
 * CLI, the MCP server and this screen cannot drift apart.
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
  grants?: { mcp: string[]; skills: string[] };
}

export interface RolesRead {
  roles: RoleRow[] | null;
  /** "fleetctl" when the console answered, "fallback" when the built-in
      catalog did — the page says which, because only one of them is editable. */
  source: string | null;
  error: string | null;
  warning: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Writes one role and returns the server read-back, or its error. */
  save: (role: string, change: RoleChange) => Promise<{ role?: RoleRow; error: string | null }>;
}

export type RoleChange =
  | { reset: true }
  | { prompt?: string; engine?: string; model?: string; effort?: string };

export function useRoles(): RolesRead {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/roles", { cache: "no-store", ...(signal ? { signal } : {}) });
      const body = await response.json() as { roles?: RoleRow[]; source?: string; warning?: string | null; error?: string };
      if (!response.ok || !body.roles) setError(body.error ?? `HTTP ${response.status}`);
      else { setRoles(body.roles); setSource(body.source ?? null); setWarning(body.warning ?? null); setError(null); }
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

  const save = useCallback(async (role: string, change: RoleChange): Promise<{ role?: RoleRow; error: string | null }> => {
    try {
      const response = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, ...change }),
      });
      const body = await response.json() as { role?: RoleRow; error?: string };
      if (!response.ok || !body.role) return { error: body.error ?? `HTTP ${response.status}` };
      const updated = body.role;
      setRoles((was) => (was ?? []).map((row) => (row.id === updated.id ? updated : row)));
      return { role: updated, error: null };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, []);

  return { roles, source, error, warning, loading, refresh: () => load(), save };
}

/** The one-line summary under a role's name: engine, model, effort. */
export function roleRuntimeLine(role: RoleRow): string {
  return [role.config.engine, role.config.model, role.config.effort].filter(Boolean).join(" · ");
}

/** Whether the draft differs from what the console holds. */
export function roleDirty(role: RoleRow, draft: string): boolean {
  return draft !== role.promptScaffold;
}
