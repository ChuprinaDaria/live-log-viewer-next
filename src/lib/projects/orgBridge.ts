import fs from "node:fs";
import path from "node:path";

import { fleetctl, fleetctlInstalled } from "@/lib/fleetctl/client";
import { statePath } from "@/lib/configDir";
import {
  directoryProjectId,
  projectIdentityFromRemote,
  projectIdentityFromRepositoryRoot,
  repositoryRootForPath,
} from "@/lib/projects/identity";

/*
 * The join between the two things this codebase has always called a "project".
 *
 * The console (`fleetctl`) owns the org layer: a firm holds projects, a project
 * holds rules, grants and a `path` on disk. The board owns the session layer: a
 * project there is a hash minted from where a session ran — a repository
 * identity when the cwd sits in a checkout, a directory identity otherwise.
 * Nothing joined them, so a session could never say which firm it belonged to.
 *
 * The join is computable and needs no third store: the console project's `path`
 * is exactly the value `createManualProject` hashes into a board identity. This
 * module computes it, and nothing here writes to either side.
 *
 * Two indexes, because one is not enough:
 *
 *  - by board id, for a conversation whose project is already resolved;
 *  - by path prefix, longest match wins, for everything else. The prefix index
 *    is the one that survives reality: a console project's `path` may name a
 *    directory that does not exist on THIS machine (another host's work root read
 *    from the desktop side), and a path that is a git checkout over there is
 *    only a plain directory over here — so the two machines would mint two
 *    different ids for one project. The path itself does not change, so the
 *    prefix match does not either.
 */

export interface OrgAttribution {
  firm: string;
  firmName: string;
  project: string;
  projectName: string;
  /** Where the console says this project lives. Empty when it has no path. */
  path: string;
  /** Its repository, when it has one — machine-independent, unlike the path. */
  repo?: string;
  /** How the join was made — useful when a row looks wrong. */
  via: "board-id" | "path";
}

export interface OrgBridge {
  byBoardId: Map<string, OrgAttribution>;
  /** Sorted longest-first so the first prefix hit is the most specific one. */
  byPath: { path: string; attribution: OrgAttribution }[];
  /** Absent console, or a console that answered nothing. */
  empty: boolean;
  builtAt: string;
}

interface ConsoleFirm {
  id: string;
  name?: string | null;
}

interface ConsoleProject {
  id: string;
  name?: string | null;
  firm: string;
  path?: string | null;
  /** The repository, when the project has one. A path is per-machine; a repo
      is not, so this is what joins a checkout on one host to the same project
      seen from another. */
  repo?: string | null;
}

const CACHE_FILE = "org-bridge.json";
/** The org layer changes when an operator edits it, not on its own. A minute
    is short enough that a new project shows up while you are still looking at
    the screen, and long enough that a list of 200 conversations does not shell
    out to the console 200 times. */
const TTL_MS = 60_000;

interface CacheEnvelope {
  builtAt: string;
  rows: OrgAttribution[];
}

let memo: { bridge: OrgBridge; at: number } | null = null;

/** How Claude Code names the folder it keeps a cwd's transcripts in: every
    `/`, `_` and `.` becomes `-`. The scanner falls back to that slug when a
    transcript carries no readable cwd, and a great many do not — which is
    exactly the case this bridge was failing to cover. */
function claudeSlugForPath(resolvedPath: string): string {
  return resolvedPath.replace(/[/_.]/g, "-");
}

/** Board identities a console path can mint.
 *
 *  - the repository identity, where the checkout actually exists;
 *  - the directory identity, which is what another machine would mint for the
 *    same path;
 *  - the Claude folder slug, which is what the scanner falls back to when the
 *    transcript names no cwd. Without this one the join silently covers only
 *    sessions whose cwd survived, and those are the minority. */
function boardIdsForPath(projectPath: string, repo?: string | null): string[] {
  const ids: string[] = [];
  /* The repository identity, derived from the remote rather than from disk.
     This is the one that works across machines: the checkout may live at
     one path on this host and another on the next, and both mint this. */
  if (repo?.trim()) {
    const identity = projectIdentityFromRemote(repo.trim());
    if (identity) ids.push(identity.project);
  }
  const resolved = path.resolve(projectPath);
  const repositoryRoot = repositoryRootForPath(resolved);
  if (repositoryRoot) {
    const identity = projectIdentityFromRepositoryRoot(repositoryRoot);
    if (identity) ids.push(identity.project);
  }
  ids.push(directoryProjectId(resolved));
  ids.push(claudeSlugForPath(resolved));
  return ids;
}

function buildBridge(firms: ConsoleFirm[], projects: ConsoleProject[]): OrgBridge {
  const firmNames = new Map(firms.map((firm) => [firm.id, firm.name?.trim() || firm.id]));
  const byBoardId = new Map<string, OrgAttribution>();
  const byPath: { path: string; attribution: OrgAttribution }[] = [];

  for (const project of projects) {
    const projectPath = project.path?.trim() ?? "";
    const attribution: OrgAttribution = {
      firm: project.firm,
      firmName: firmNames.get(project.firm) ?? project.firm,
      project: project.id,
      projectName: project.name?.trim() || project.id,
      path: projectPath,
      repo: project.repo?.trim() || "",
      via: "board-id",
    };
    if (!projectPath && !project.repo?.trim()) continue;

    for (const id of boardIdsForPath(projectPath, project.repo)) {
      /* A subfolder project and its parent can hash to the same directory id
         only if they name the same path, which the console already forbids.
         First writer still wins, so a duplicate never silently reassigns. */
      if (!byBoardId.has(id)) byBoardId.set(id, attribution);
    }
    byPath.push({ path: path.resolve(projectPath), attribution: { ...attribution, via: "path" } });
  }

  byPath.sort((left, right) => right.path.length - left.path.length);
  return {
    byBoardId,
    byPath,
    empty: byBoardId.size === 0 && byPath.length === 0,
    builtAt: new Date().toISOString(),
  };
}

function readCache(): OrgBridge | null {
  try {
    const raw = fs.readFileSync(statePath(CACHE_FILE), "utf8");
    const envelope = JSON.parse(raw) as CacheEnvelope;
    if (!Array.isArray(envelope.rows)) return null;
    const byBoardId = new Map<string, OrgAttribution>();
    const byPath: { path: string; attribution: OrgAttribution }[] = [];
    for (const row of envelope.rows) {
      if (!row.path && !row.repo) continue;
      for (const id of boardIdsForPath(row.path, row.repo)) {
        if (!byBoardId.has(id)) byBoardId.set(id, { ...row, via: "board-id" });
      }
      if (row.path) byPath.push({ path: path.resolve(row.path), attribution: { ...row, via: "path" } });
    }
    byPath.sort((left, right) => right.path.length - left.path.length);
    return { byBoardId, byPath, empty: byPath.length === 0, builtAt: envelope.builtAt };
  } catch {
    return null;
  }
}

function writeCache(bridge: OrgBridge): void {
  /* The cache is a convenience, never a source of truth: a failed write means
     the next call shells out to the console again, which is the correct
     behaviour and not worth an error path of its own. */
  try {
    const rows = bridge.byPath.map((entry) => ({ ...entry.attribution, via: "path" as const }));
    const file = statePath(CACHE_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ builtAt: bridge.builtAt, rows } satisfies CacheEnvelope, null, 2));
  } catch {
    /* ignored on purpose */
  }
}

const EMPTY_BRIDGE: OrgBridge = {
  byBoardId: new Map(),
  byPath: [],
  empty: true,
  builtAt: new Date(0).toISOString(),
};

/** The org layer as the console currently reports it. Falls back to the last
    cached answer when the console is missing or fails, so a dashboard on a
    machine without `fleetctl` degrades to stale-but-true rather than blank. */
export async function loadOrgBridge(options?: { force?: boolean }): Promise<OrgBridge> {
  if (!options?.force && memo && Date.now() - memo.at < TTL_MS) return memo.bridge;

  if (!fleetctlInstalled()) {
    const cached = readCache();
    const bridge = cached ?? EMPTY_BRIDGE;
    memo = { bridge, at: Date.now() };
    return bridge;
  }

  try {
    const [firms, projects] = await Promise.all([
      fleetctl<{ firms: ConsoleFirm[] }>({ fn: "firms_list" }),
      fleetctl<{ projects: ConsoleProject[] }>({ fn: "projects_list" }),
    ]);
    const bridge = buildBridge(firms.firms ?? [], projects.projects ?? []);
    writeCache(bridge);
    memo = { bridge, at: Date.now() };
    return bridge;
  } catch {
    const bridge = readCache() ?? EMPTY_BRIDGE;
    memo = { bridge, at: Date.now() };
    return bridge;
  }
}

/** Which firm and project a conversation belongs to. `boardProject` is the
    hashed identity the board already resolved; `cwd` is where the session ran
    and is what makes the answer work across machines. */
export function orgAttributionFor(
  bridge: OrgBridge,
  boardProject: string | null | undefined,
  cwd?: string | null,
): OrgAttribution | null {
  if (bridge.empty) return null;

  const project = boardProject?.trim();
  if (project) {
    const direct = bridge.byBoardId.get(project);
    if (direct) return direct;
  }

  const where = cwd?.trim();
  if (!where) return null;
  const resolved = path.resolve(where);
  for (const entry of bridge.byPath) {
    /* Prefix, but on a path boundary: a project at `…/work/fleet` must not
       claim `…/work/fleetctl`. Longest-first ordering makes the first hit the
       most specific project, so a subfolder wins over its parent. */
    if (resolved === entry.path || resolved.startsWith(`${entry.path}${path.sep}`)) {
      return entry.attribution;
    }
  }
  return null;
}

/** What a conversation row carries. The console project's `path` stays server
    side: a row is a label for the operator, not a map of the disk. */
export type OrgAttributionPublic = Omit<OrgAttribution, "path">;

/** Stamps `org` on conversation rows in place. One console read per page, not
    one per row — the bridge is loaded once and every entry consults the same
    snapshot. Rows nothing claims are left untouched: an absent firm is honest,
    an invented one is not. */
export async function attachOrgAttribution(
  entries: { project?: string | null; cwd?: string | null; org?: OrgAttributionPublic }[],
): Promise<void> {
  if (entries.length === 0) return;
  const bridge = await loadOrgBridge();
  if (bridge.empty) return;
  for (const entry of entries) {
    const found = orgAttributionFor(bridge, entry.project, entry.cwd);
    if (!found) continue;
    const { path: _path, ...visible } = found;
    entry.org = visible;
  }
}

/** Drops the in-process memo. For tests and for the operator editing the org
    layer and expecting the next read to see it. */
export function forgetOrgBridge(): void {
  memo = null;
}
