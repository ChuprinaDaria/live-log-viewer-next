import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * The session archive, read from the operator's sessionmem.
 *
 * sessionmem already does the digestion: it indexes every transcript, writes a
 * card (`summary/did/broke/decided/left`) for the ones worth summarising and
 * pushes the vectors into Qdrant. The Viewer only READS that, so a session
 * nobody can resume any more is a paragraph and four short lists instead of
 * another row in a pile.
 *
 * The read is a python one-shot inside SESSIONMEM_DIR, exactly the way
 * `src/app/api/sessionmem/brief/route.ts` runs its own: the interpreter gets
 * the script on `-c` and the options as ONE json argument on argv, so nothing
 * from a request is ever spliced into the source. Every statement here is a
 * SELECT — the archive never writes to the operator's database.
 */

export const SESSIONMEM_DIR = process.env.SESSIONMEM_DIR ?? path.join(os.homedir(), "work", "sessionmem");

/** Never let one request ask for the whole database. */
const MAX_LIMIT = 200;

export interface ArchiveCard {
  sessionId: string;
  title: string;
  project: string;
  cwd: string;
  host: string;
  engine: "claude" | "codex";
  endedAt: number | null;
  msgCount: number;
  resumable: boolean;
  transcriptPath: string | null;
  summary: string;
  did: string[];
  broke: string[];
  decided: string[];
  left: string[];
}

/** One `sessions` row as the script prints it: the columns, verbatim, plus the
    card's four lists parsed out of `card_json`. */
export interface ArchiveRow {
  session_id: string;
  source: string | null;
  title: string | null;
  project: string | null;
  cwd: string | null;
  ended_at: number | null;
  msg_count: number | null;
  transcript_path: string | null;
  resumable: boolean;
  summary: string | null;
  did: string[] | null;
  broke: string[] | null;
  decided: string[] | null;
  left: string[] | null;
}

export interface ArchiveOptions {
  /** `cwd LIKE <prefix>%` — a console project's checkout paths. */
  cwdPrefixes?: readonly string[];
  limit?: number;
}

/** Runs the script and answers with its stdout. Injected so the mapping above
    is testable without an interpreter or the operator's database. */
export type ArchivePython = (payload: string) => Promise<string>;

const SCRIPT = `
import json, os, sys
sys.path.insert(0, "lib")
import index, resume
from scrub import scrub

opts = json.loads(sys.argv[1])
prefixes = [p for p in (opts.get("cwdPrefixes") or []) if isinstance(p, str) and p]
db = index.connect()

# A prefix must stop at a path boundary: a bare LIKE 'p%' also matches
# /w/fleet-old for /w/fleet. The boundary is "/", which LIKE never treats as a
# wildcard, so no ESCAPE clause is needed.
where, params = "", []
if prefixes:
    where = " WHERE " + " OR ".join(["(cwd = ? OR cwd LIKE ? || '/%')"] * len(prefixes))
    for prefix in prefixes:
        params += [prefix.rstrip("/"), prefix.rstrip("/")]

total = db.execute("SELECT COUNT(*) FROM sessions" + where, params).fetchone()[0]
if opts.get("count"):
    print(json.dumps({"count": total}))
    raise SystemExit(0)

rows = db.execute(
    "SELECT session_id, source, title, first_prompt, project, cwd, ended_at, msg_count, "
    "transcript_path, card_json FROM sessions" + where + " ORDER BY ended_at DESC LIMIT ?",
    params + [int(opts.get("limit") or 200)]).fetchall()

out = []
for r in rows:
    try:
        card = json.loads(r["card_json"]) if r["card_json"] else {}
    except Exception:
        card = {}
    if not isinstance(card, dict):
        card = {}
    out.append({
        "session_id": r["session_id"],
        "source": r["source"],
        "title": scrub(r["title"] or "") or (r["first_prompt"] or "")[:70],
        "project": r["project"],
        "cwd": r["cwd"],
        "ended_at": r["ended_at"],
        "msg_count": r["msg_count"],
        "transcript_path": r["transcript_path"],
        "resumable": resume.is_resumable(r),
        "summary": card.get("summary", ""),
        "did": card.get("did", []),
        "broke": card.get("broke", []),
        "decided": card.get("decided", []),
        "left": card.get("left", []),
    })
print(json.dumps({"host": os.uname().nodename, "total": total, "rows": out}, ensure_ascii=False))
`;

export function sessionmemInstalled(): boolean {
  try {
    return fs.statSync(path.join(SESSIONMEM_DIR, "bin", "sessionmem")).isFile();
  } catch {
    return false;
  }
}

/** The real one-shot. Same shape as the brief route's: `-c` plus argv, cwd at
    sessionmem, and a timeout short enough that a stuck read cannot hold a
    request open. */
const runPython: ArchivePython = (payload) =>
  new Promise((resolve, reject) => {
    execFile("python3", ["-c", SCRIPT, payload], { cwd: SESSIONMEM_DIR, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`sessionmem: ${(stderr || error.message).trim().split("\n").pop() ?? "failed"}`));
        return;
      }
      resolve(stdout);
    });
  });

const PULLED = /\/pulled\/([a-z0-9_.-]+)\//i;

/** The machine a card belongs to. sessionmem indexes local files only, so a
    transcript that does not sit under `/pulled/<host>/` was written here —
    the fallback is the machine the reader ran on, never a guessed name. */
export function hostOf(transcriptPath: string | null, fallback: string): string {
  if (!transcriptPath) return fallback;
  const match = PULLED.exec(transcriptPath);
  return match ? match[1]! : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A row becomes a card, or nothing at all: a row with no session id cannot be
    opened, keyed or resumed, so it is dropped rather than drawn blank. */
export function cardFromRow(value: unknown, fallbackHost: string): ArchiveCard | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Partial<ArchiveRow>;
  const sessionId = text(row.session_id);
  if (!sessionId) return null;
  const transcriptPath = typeof row.transcript_path === "string" && row.transcript_path ? row.transcript_path : null;
  return {
    sessionId,
    title: text(row.title),
    project: text(row.project),
    cwd: text(row.cwd),
    host: hostOf(transcriptPath, fallbackHost),
    engine: row.source === "codex" ? "codex" : "claude",
    endedAt: typeof row.ended_at === "number" ? row.ended_at : null,
    msgCount: typeof row.msg_count === "number" ? row.msg_count : 0,
    resumable: row.resumable === true,
    transcriptPath,
    summary: text(row.summary),
    did: strings(row.did),
    broke: strings(row.broke),
    decided: strings(row.decided),
    left: strings(row.left),
  };
}

function lastLine(stdout: string): unknown {
  const line = stdout.trim().split("\n").pop() ?? "";
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new Error("sessionmem: unreadable answer");
  }
}

function payloadFor(options: ArchiveOptions, count: boolean): string {
  const limit = typeof options.limit === "number" && options.limit > 0 ? Math.min(Math.floor(options.limit), MAX_LIMIT) : MAX_LIMIT;
  return JSON.stringify({ cwdPrefixes: [...(options.cwdPrefixes ?? [])], limit, count });
}

/** The page of cards, and how many sessions the filter actually matched: the
    list is capped, so a screen that showed only the page would quietly drop the
    rest. */
export interface ArchivePage {
  cards: ArchiveCard[];
  total: number;
}

export async function readArchive(options: ArchiveOptions, run: ArchivePython = runPython): Promise<ArchivePage> {
  const answer = lastLine(await run(payloadFor(options, false)));
  if (typeof answer !== "object" || answer === null) throw new Error("sessionmem: unreadable answer");
  const { host, rows, total, error } = answer as { host?: unknown; rows?: unknown; total?: unknown; error?: unknown };
  if (typeof error === "string") throw new Error(`sessionmem: ${error}`);
  if (!Array.isArray(rows)) throw new Error("sessionmem: unreadable answer");
  const fallback = typeof host === "string" && host ? host : "";
  const cards = rows.map((row) => cardFromRow(row, fallback)).filter((card): card is ArchiveCard => card !== null);
  return { cards, total: typeof total === "number" && Number.isFinite(total) ? total : cards.length };
}

export async function countArchive(options: ArchiveOptions, run: ArchivePython = runPython): Promise<number> {
  const answer = lastLine(await run(payloadFor(options, true)));
  const count = (answer as { count?: unknown } | null)?.count;
  if (typeof count !== "number" || !Number.isFinite(count)) throw new Error("sessionmem: unreadable answer");
  return count;
}
