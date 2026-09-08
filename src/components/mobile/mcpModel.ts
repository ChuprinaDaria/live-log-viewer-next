"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * MCP servers and skills as the phone reads them — the operator console's
 * answer, and the one write this page makes: granting an item to a firm, a
 * project, an agent role or a fleet seat, and taking it back.
 *
 * Values never arrive here. The console masks a server's `env` and `headers`
 * down to their key names before answering, so this model can show that a
 * server needs `COHERE_API_KEY` without the key existing anywhere in the page.
 */

export interface McpServerRow {
  name: string;
  type: string;
  command?: string;
  url?: string;
  args?: string[];
  cwd?: string;
  /** Names only — the console never sends a value. */
  env_keys?: string[];
  header_keys?: string[];
  /** Who holds it: firm:…, project:…, agent:… */
  granted_to: string[];
  /** Fleet's own seats, which live in the run environment, not the org store. */
  fleet_env: string[];
  status?: { reachable: boolean; detail: string };
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  granted_to: string[];
}

/** A server as the operator describes it in the form. Values live here for
    exactly as long as the submit takes: the route sends them to the console
    over stdin, the answer carries key names only, and the sheet drops its
    state on close. Nothing in this module stores one. */
export interface McpServerInput {
  name: string;
  type: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  replace?: boolean;
}

export interface McpRegistryRead {
  servers: McpServerRow[] | null;
  skills: SkillRow[] | null;
  registry: string | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Resolves with the console's own refusal text, or null on success. */
  grant: (kind: "mcp" | "skills", item: string, target: string, revoke?: boolean) => Promise<string | null>;
  /** Write the server into the registry; refusal text, or null on success. */
  addServer: (input: McpServerInput) => Promise<string | null>;
  /** Take it out, its grants with it. Irreversible: the env and header values
      went with it and this page never held them to put back. */
  removeServer: (name: string) => Promise<McpRemoveOutcome>;
}

interface Answer {
  /** Null when the write went through but the console could not be re-read. */
  servers?: McpServerRow[] | null;
  skills?: SkillRow[] | null;
  registry?: string;
  error?: string;
  /** The console's own answer to the write. `mcp_remove` reports the grants it
      took down with the server, as a list of holders. */
  result?: { grants_cleaned?: string[] | number };
}

/** What a removal cost: the console's refusal, or the grants it revoked. */
export interface McpRemoveOutcome {
  error: string | null;
  grantsCleaned: number;
}

function countGrants(cleaned: string[] | number | undefined): number {
  if (Array.isArray(cleaned)) return cleaned.length;
  return typeof cleaned === "number" ? cleaned : 0;
}

export function useMcpRegistry(): McpRegistryRead {
  const [servers, setServers] = useState<McpServerRow[] | null>(null);
  const [skills, setSkills] = useState<SkillRow[] | null>(null);
  const [registry, setRegistry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const apply = useCallback((body: Answer) => {
    if (body.servers) setServers(body.servers);
    if (body.skills) setSkills(body.skills);
    if (body.registry) setRegistry(body.registry);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/mcp-registry", { cache: "no-store", ...(signal ? { signal } : {}) });
      const body = await response.json() as Answer;
      if (!response.ok) setError(body.error ?? `HTTP ${response.status}`);
      else { apply(body); setError(null); }
    } catch (cause) {
      if ((cause as { name?: string }).name !== "AbortError") setError("UNREACHABLE");
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  /* One writer for the three verbs this page has. The route answers each of
     them with the whole list, so the view cannot disagree with the store
     about what exists or who holds it. */
  const write = useCallback(async (payload: Record<string, unknown>): Promise<{ error: string | null; body: Answer | null }> => {
    try {
      const response = await fetch("/api/mcp-registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as Answer;
      if (!response.ok) return { error: body.error ?? `HTTP ${response.status}`, body: null };
      apply(body);
      /* A null list means the write landed but the re-read did not; the page
         asks again rather than standing on a view it knows is behind. */
      if (body.servers === null) void load();
      return { error: null, body };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause), body: null };
    }
  }, [apply, load]);

  const grant = useCallback(
    async (kind: "mcp" | "skills", item: string, target: string, revoke = false) =>
      (await write({ kind, item, target, ...(revoke ? { revoke: true } : {}) })).error,
    [write],
  );

  const addServer = useCallback(
    async (input: McpServerInput) => (await write({ action: "add", ...input })).error,
    [write],
  );

  const removeServer = useCallback(async (name: string): Promise<McpRemoveOutcome> => {
    const { error, body } = await write({ action: "remove", name });
    return { error, grantsCleaned: countGrants(body?.result?.grants_cleaned) };
  }, [write]);

  return { servers, skills, registry, error, loading, refresh: () => load(), grant, addServer, removeServer };
}

/** «stdio · uv» / «http · example.com» — what a server IS, in one line. */
export function serverLine(server: McpServerRow): string {
  const where = server.type === "stdio"
    ? (server.command ?? "").split("/").pop() ?? ""
    : hostOf(server.url ?? "");
  return [server.type, where].filter(Boolean).join(" · ");
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** A grant target in the operator's words: «Blue Bird», «money», «reviewer». */
export function targetLabel(target: string, firmNames?: Record<string, string>): string {
  const [scope, ident = ""] = target.split(":");
  if (scope === "firm") return firmNames?.[ident] ?? ident;
  return ident;
}
