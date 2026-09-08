"use client";

import { useCallback, useEffect, useState } from "react";

import type { AccountView, CliView, SecretsInventoryView, SecretState, SecretView } from "@/app/api/secrets/route";

/*
 * The Secrets page's data: the inventory as the browser reads it, and the
 * grouping the screen renders. The file is rewritten by the operator's
 * inventory agent, so the page re-reads it on mount and on every return to the
 * tab rather than holding an answer from an earlier visit.
 */

export type { AccountView, CliView, SecretState, SecretView };

export type SecretsFilter = "all" | "dead" | "unchecked";

export interface SecretsRead {
  /** Null until the first answer. */
  inventory: SecretsInventoryView | null;
  /** The server's own word for what went wrong, or null. */
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useSecretsInventory(active: boolean): SecretsRead {
  const [inventory, setInventory] = useState<SecretsInventoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/secrets", signal ? { signal, cache: "no-store" } : { cache: "no-store" });
      const body = await response.json() as SecretsInventoryView | { error: string };
      if ("error" in body) {
        setError(body.error);
      } else {
        setInventory(body);
        setError(null);
      }
    } catch (cause) {
      if ((cause as { name?: string }).name !== "AbortError") setError("UNREACHABLE");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [active, load]);

  return { inventory, error, loading, refresh: () => load() };
}

export interface SecretGroup {
  provider: string;
  rows: SecretView[];
  alive: number;
  dead: number;
  unchecked: number;
}

export interface SecretsSummary {
  total: number;
  alive: number;
  dead: number;
  unchecked: number;
}

export function summarize(secrets: readonly SecretView[]): SecretsSummary {
  return {
    total: secrets.length,
    alive: secrets.filter((row) => row.state === "alive").length,
    dead: secrets.filter((row) => row.state === "dead").length,
    unchecked: secrets.filter((row) => row.state === "unchecked").length,
  };
}

export function matchesFilter(row: SecretView, filter: SecretsFilter): boolean {
  return filter === "all" || (filter === "dead" ? row.state === "dead" : row.state === "unchecked");
}

/**
 * Providers in one stable alphabetical order, and their rows likewise.
 *
 * Ordering by "most dead first" was the obvious move and is the wrong one: the
 * list would rebuild itself under the operator every time a key is re-checked,
 * so no position could ever be learned. The dead keys are reached by the
 * filter, which is what it is for, and by the count on each group's header.
 */
export function groupByProvider(secrets: readonly SecretView[], filter: SecretsFilter): SecretGroup[] {
  const groups = new Map<string, SecretView[]>();
  for (const row of secrets) {
    if (!matchesFilter(row, filter)) continue;
    const rows = groups.get(row.provider);
    if (rows) rows.push(row);
    else groups.set(row.provider, [row]);
  }
  return [...groups.entries()]
    .map(([provider, rows]) => ({
      provider,
      rows: [...rows].sort((a, b) => a.name.localeCompare(b.name)),
      alive: rows.filter((row) => row.state === "alive").length,
      dead: rows.filter((row) => row.state === "dead").length,
      unchecked: rows.filter((row) => row.state === "unchecked").length,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
}

/** The row's headline: the inventory's human name when it has one, the slug
    otherwise. A labelled row keeps its slug in the meta line, where it is
    evidence rather than a heading. */
/** Share a key with a scope, or take it back. Resolves with the console's own
    refusal text, or null when it went through. A value is never involved:
    the vault holds an address, and the key reaches an agent by being sourced
    on its machine at launch. */
export async function shareSecret(
  secret: string,
  scope: string,
  revoke = false,
): Promise<string | null> {
  try {
    const response = await fetch("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, [revoke ? "unshare" : "share"]: scope }),
    });
    const body = await response.json() as { error?: string };
    return response.ok ? null : (body.error ?? `HTTP ${response.status}`);
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/** What the phone sends to add a key. The value is here and only here: it is
    read out of the DOM at submit, handed to `fetch`, and never assigned to a
    field of anything that outlives the call. */
export interface SecretAddInput {
  secret: string;
  value: string;
  provider: string;
  label?: string;
  envName?: string;
  kind?: string;
  owner?: string;
  firm?: string;
  project?: string;
  purpose?: string;
  tags?: string[];
  replace?: boolean;
}

/** Why an add did not go through: the sentence to fall back on, and a code
    when the failure is one the screen has its own words for. The code exists
    because the console answers in CLI terms — «додайте --replace» — and the
    operator is holding a phone with a checkbox, not a terminal. */
export interface SecretAddFailure {
  error: string;
  code?: string;
}

/** Add a key: the console writes the value into a private 0600 file and puts
    only its ADDRESS into the vault. Resolves with the refusal, or null when
    the key is in. Nothing of the value is kept here — not in a variable that
    outlives this call, and not in the answer, which is the inventory row. */
export async function addSecret(input: SecretAddInput): Promise<SecretAddFailure | null> {
  try {
    const response = await fetch("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", ...input }),
    });
    const body = await response.json() as { error?: string; code?: string };
    if (response.ok) return null;
    return { error: body.error ?? `HTTP ${response.status}`, ...(body.code ? { code: body.code } : {}) };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Where a key physically lives, in one line: machine, file, variable. This
    is what the store always knew and the screen never said. */
export function secretWhere(row: SecretView): string {
  return [row.host, row.file, row.envName].filter(Boolean).join(" · ");
}

export function secretTitle(row: SecretView): string {
  return row.label?.trim() || row.name;
}

/** The freshest check across the inventory: one date at the top answers "how
    current is this", where 82 dates in 82 rows answer nothing. */
export function lastCheckedAt(secrets: readonly SecretView[]): string | null {
  let latest: string | null = null;
  for (const row of secrets) {
    if (row.checkedAt && (latest === null || row.checkedAt > latest)) latest = row.checkedAt;
  }
  return latest;
}
