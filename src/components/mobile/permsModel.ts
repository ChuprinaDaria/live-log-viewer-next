"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * Claude's permission rules as the phone reads them.
 *
 * Every write goes through `/api/permissions` to the operator console, which
 * is the one writer of this layer. The page therefore never decides what is
 * dangerous: it sends the rule, and when the console refuses — «Bash(sudo:*)
 * відкриває небезпечну дію… додай confirm=true» — that sentence IS the
 * prompt shown to the operator. One judgement, in one place, and the page
 * cannot drift from it.
 */

export const BUCKETS = ["allow", "deny", "ask"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** machine | firm:<id> | project:<id> */
export type PermTarget = string;

export interface MachinePermissions {
  target: "machine";
  settings: string;
  defaultMode: string | null;
  counts: Record<Bucket, number>;
  allow: string[];
  deny: string[];
  ask: string[];
  protected_deny: string[];
}

export interface NodePermissions {
  target: string;
  own: Record<Bucket, string[]>;
  chain?: string[];
  effective?: Record<Bucket, { rule: string; from: string; shadowed_by_deny?: boolean }[]>;
  note?: string;
}

export type PermissionsAnswer = MachinePermissions | NodePermissions;

export const isMachine = (value: PermissionsAnswer): value is MachinePermissions =>
  (value as MachinePermissions).target === "machine";

export interface PermissionsRead {
  permissions: PermissionsAnswer | null;
  error: string | null;
  loading: boolean;
  target: PermTarget;
  setTarget: (target: PermTarget) => void;
  refresh: () => Promise<void>;
  /** Resolves with the console's refusal text, or null when it went through.
      `confirm` and `force` are the operator answering that refusal. */
  write: (change: PermChange) => Promise<string | null>;
}

export type PermChange =
  | { bucket: Bucket; rule: string; confirm?: boolean }
  | { bucket: Bucket; rule: string; remove: true; force?: boolean }
  | { mode: string };

export function usePermissions(initial: PermTarget = "machine"): PermissionsRead {
  const [target, setTarget] = useState<PermTarget>(initial);
  const [permissions, setPermissions] = useState<PermissionsAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (which: PermTarget, signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/permissions?target=${encodeURIComponent(which)}`, {
        cache: "no-store", ...(signal ? { signal } : {}),
      });
      const body = await response.json() as PermissionsAnswer & { error?: string };
      if (!response.ok) { setError(body.error ?? `HTTP ${response.status}`); setPermissions(null); }
      else { setPermissions(body); setError(null); }
    } catch (cause) {
      if ((cause as { name?: string }).name !== "AbortError") setError("UNREACHABLE");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(target, controller.signal);
    return () => controller.abort();
  }, [load, target]);

  const write = useCallback(async (change: PermChange): Promise<string | null> => {
    try {
      const response = await fetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("mode" in change ? change : { target, ...change }),
      });
      const body = await response.json() as { permissions?: PermissionsAnswer; error?: string };
      if (!response.ok) return body.error ?? `HTTP ${response.status}`;
      /* A mode change answers with the console's own result rather than a
         re-read, so the page refreshes itself instead of guessing. */
      if (body.permissions) setPermissions(body.permissions);
      else await load(target);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  }, [load, target]);

  return { permissions, error, loading, target, setTarget, refresh: () => load(target), write };
}

/** Does this refusal mean «say it again, deliberately»? The console phrases
    both of its pauses with the word it wants back, so the page offers exactly
    the confirmation the refusal asked for and invents no third kind. */
export function refusalNeeds(message: string): "confirm" | "force" | null {
  if (message.includes("confirm=true")) return "confirm";
  if (message.includes("force=true")) return "force";
  return null;
}

/** Rules the console will not let go without `force`. Shown so the operator
    can see WHY a row has no remove button, rather than finding out by tapping. */
export function isProtected(permissions: PermissionsAnswer | null, rule: string): boolean {
  return !!permissions && isMachine(permissions) && permissions.protected_deny.includes(rule);
}
