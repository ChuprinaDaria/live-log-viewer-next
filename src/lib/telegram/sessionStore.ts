import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readValidatedTelegramSessionFiles } from "../../../bin/telegram-session-validator.mjs";

import { statePath } from "@/lib/configDir";

import { validTelegramAccountId, type TelegramAccountIdentity, type TelegramErrorCode } from "./contracts";

/**
 * Owner-only persistence for the Telegram credential (issue #1059).
 *
 * Three files under `<state>/telegram/`, all 0600 in a 0700 directory:
 *
 *  - `session.json` — the Telethon string session. The ONLY place the secret
 *    is at rest; nothing outside this module reads or writes it, and its value
 *    never appears in API JSON, logs, argv, or the registry.
 *  - `connector-token` — per-credential bearer capability for the local MCP
 *    endpoint. The session file stores only its digest.
 *  - `connection.json` — secret-free durable status (phase, opaque
 *    credentialRef, sanitized identity, last health check), which is what the
 *    status API projects from.
 *
 * Reads and writes both go through the same safety fence: the path must be a
 * regular, non-symlinked file with no group/other permission bits, and writes
 * land atomically (tmp + fsync + rename) so a crash never leaves a partial
 * secret or a widened mode on disk.
 */

const DIR_NAME = "telegram";
const ACCOUNTS_DIR = "accounts";
const SESSION_FILE = "session.json";
const CONNECTOR_TOKEN_FILE = "connector-token";
const CONNECTION_FILE = "connection.json";
export const TELEGRAM_CONNECTOR_TOKEN_ENV = "LLV_TELEGRAM_MCP_TOKEN";

/**
 * The name a NAMED account slot answers to.
 *
 * It becomes a directory name, a vault record id and an environment variable,
 * so it is deliberately narrower than any of the three: lowercase, no dots, no
 * separators, two to thirty-two characters. Nothing read from a slug can
 * escape the accounts directory, and nothing a person types can produce a
 * record id the console would refuse.
 */
export const TELEGRAM_ACCOUNT_SLUG = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * The legacy single slot, under the name the listing reports it by.
 *
 * The HQ's connector reads `<state>/telegram/session.json` and always has; the
 * spawn path hands `telegram-mcp` the token beside it. That slot therefore
 * stays exactly where it is — `default` is an alias for READING it, never a
 * slot to write into, and every write path below refuses the name outright
 * rather than quietly relocating the credential the connector depends on.
 */
export const DEFAULT_TELEGRAM_SLUG = "default";

export type StoredTelegramSession = {
  version: 1;
  credentialRef: string;
  connectorToken: string;
  sessionString: string;
  savedAt: string;
};

type StoredTelegramSessionFile = Omit<StoredTelegramSession, "connectorToken"> & { connectorTokenSha256: string };

export type TelegramConnectionStatus = "disconnected" | "connected" | "expired" | "error";

export type StoredTelegramConnection = {
  version: 1;
  status: TelegramConnectionStatus;
  credentialRef: string | null;
  identity: TelegramAccountIdentity | null;
  lastHealthCheckAt: string | null;
  errorCode: TelegramErrorCode | null;
  /** When the pre-#1091 identity on this record was re-read to recover its
      numeric account id (issue #1091). Set the first time that upgrade runs,
      whether or not an id came back, so the migration happens ONCE per
      connection instead of on every health check. */
  identityIdUpgradedAt: string | null;
};

export class UnsafeTelegramSessionError extends Error {
  constructor(detail: string) {
    super(`Telegram session storage is unsafe: ${detail}`);
    this.name = "UnsafeTelegramSessionError";
  }
}

function telegramDir(): string {
  return statePath(DIR_NAME);
}

export function telegramSessionPath(): string {
  return path.join(telegramDir(), SESSION_FILE);
}

export function telegramConnectionPath(): string {
  return path.join(telegramDir(), CONNECTION_FILE);
}

export function telegramConnectorTokenPath(): string {
  return path.join(telegramDir(), CONNECTOR_TOKEN_FILE);
}

/** The fence every read and overwrite passes: regular file, not a symlink, no
    group/other bits, owned by this process's uid. Anything else is treated as
    tampering, never silently accepted. */
function assertSafeSecretFile(pathname: string): void {
  const stat = fs.lstatSync(pathname);
  if (stat.isSymbolicLink()) throw new UnsafeTelegramSessionError("symlink");
  if (!stat.isFile()) throw new UnsafeTelegramSessionError("not a regular file");
  if ((stat.mode & 0o077) !== 0) throw new UnsafeTelegramSessionError("permissions are wider than owner-only");
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new UnsafeTelegramSessionError("not owned by this user");
  }
}

/**
 * The same fence for the directory HOLDING the secrets — mkdir's mode applies
 * only on creation, so a pre-existing telegram dir is validated every time:
 * it must be a real directory (never a symlink pointing the secret write
 * elsewhere), owned by this uid, with no group/other bits. Every mismatch is
 * refused so reads and overwrites share the same fail-closed boundary. The
 * state-dir root above it stays the app-wide boundary it already is — this
 * fences the component this module creates.
 */
function ensureOwnerOnlyDir(dir: string, create: boolean, what: string): string | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (!create) return null;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    stat = fs.lstatSync(dir);
  }
  if (stat.isSymbolicLink()) throw new UnsafeTelegramSessionError(`${what} is a symlink`);
  if (!stat.isDirectory()) throw new UnsafeTelegramSessionError(`${what} is not a directory`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new UnsafeTelegramSessionError(`${what} is not owned by this user`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new UnsafeTelegramSessionError(`${what} permissions are wider than owner-only`);
  }
  return dir;
}

export function ensureTelegramStateDir(create = true): string | null {
  return ensureOwnerOnlyDir(statePath(DIR_NAME), create, "telegram directory");
}

/** A slug that may be READ. `default` passes: it is the legacy slot's alias. */
function accountSlug(slug: unknown): string {
  if (typeof slug !== "string" || !TELEGRAM_ACCOUNT_SLUG.test(slug)) {
    throw new Error("Telegram account slug is invalid");
  }
  return slug;
}

/** A slug that may be WRITTEN. `default` does not: the legacy slot belongs to
    the connector, and a write under that name would move its files. */
function writableAccountSlug(slug: unknown): string {
  const safe = accountSlug(slug);
  if (safe === DEFAULT_TELEGRAM_SLUG) {
    throw new Error("the default Telegram slot is read-only here");
  }
  return safe;
}

/** Where one named slot's three files live. Pure path arithmetic — it creates
    nothing, so a caller can name a slot that does not exist yet. */
export function telegramAccountDir(slug: string): string {
  return statePath(DIR_NAME, ACCOUNTS_DIR, accountSlug(slug));
}

/** The same fence as the legacy slot, applied to all three levels: the
    telegram directory, the accounts directory under it, and the slot itself.
    A widened directory anywhere on that path fails closed. */
export function ensureTelegramAccountDir(slug: string, create = true): string | null {
  const safe = accountSlug(slug);
  const root = ensureTelegramStateDir(create);
  if (root === null) return null;
  const accounts = ensureOwnerOnlyDir(path.join(root, ACCOUNTS_DIR), create, "telegram accounts directory");
  if (accounts === null) return null;
  return ensureOwnerOnlyDir(path.join(accounts, safe), create, `telegram account directory ${safe}`);
}

const INCOMING_FEED_SCOPE_LENGTH = 16;
/** Every feed name this Viewer has ever written, including the pre-#1091
    unscoped one, so the credential boundary can sweep them all. */
const INCOMING_FEED_NAME = new RegExp(`^incoming_feed(-[0-9a-f]{${INCOMING_FEED_SCOPE_LENGTH}})?\\.jsonl$`);

/**
 * The connector's incoming-event feed for ONE credential generation (#1091).
 *
 * The feed is an append-only JSONL record of settled incoming private bursts —
 * the only source that says which dialogs were ACTIVE, in real time, without
 * walking a chat list whose order is pins and folders. It lives beside the
 * credential rather than at the connector's XDG default because it names the
 * operator's correspondents: same 0700 directory, same owner-only fence, and
 * the connector creates it 0600 itself.
 *
 * The name carries the CREDENTIAL GENERATION, and that is the point. One
 * shared file outlives a disconnect, so an account whose bursts it recorded
 * yesterday would still be in it when a DIFFERENT account connects tomorrow —
 * and that second account's report, having passed its own id check, would
 * discover the first account's dialogs as its own active sources. A generation
 * cannot read another generation's feed because it cannot name the file. The
 * suffix is a digest rather than the ref itself: it keeps a value read from
 * disk out of a constructed path, and a digest is always a fixed run of hex.
 */
export function telegramIncomingFeedPath(credentialRef: string): string {
  const scope = crypto.createHash("sha256").update(credentialRef).digest("hex").slice(0, INCOMING_FEED_SCOPE_LENGTH);
  return statePath(DIR_NAME, `incoming_feed-${scope}.jsonl`);
}

/**
 * Drops every credential generation's feed.
 *
 * Disconnect is the credential boundary and the connector is already stopped
 * by the time it is reached, so nothing is mid-write: the account is being
 * forgotten, and a file naming its correspondents does not outlive it. Each
 * removal is independent, because one stubborn file must never be able to
 * block the credential deletion that follows it.
 */
function removeIncomingFeeds(): void {
  const directory = ensureTelegramStateDir(false);
  if (directory === null) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !INCOMING_FEED_NAME.test(entry.name)) continue;
    try { fs.rmSync(path.join(directory, entry.name), { force: true }); } catch { /* best effort */ }
  }
}

/* Exported for the Daily Report store (#1086), which persists settings,
   history and report text in the same directory under the same fence — one
   owner-only write path for everything the connector owns. */
export function atomicSecretWrite(pathname: string, contents: string): void {
  ensureTelegramStateDir(true);
  writeOwnerOnly(pathname, contents);
}

/** The write itself, with the directory already proven owner-only by the
    caller. Split out so a named account slot can reuse the exact bytes-on-disk
    guarantees without re-fencing the legacy directory it does not live in. */
function writeOwnerOnly(pathname: string, contents: string): void {
  try {
    assertSafeSecretFile(pathname);
  } catch (error) {
    if (error instanceof UnsafeTelegramSessionError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const tmp = path.join(path.dirname(pathname), `.${path.basename(pathname)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, contents, { mode: 0o600 });
    const fd = fs.openSync(tmp, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, pathname);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function readSafeJson(pathname: string, corruptIsUnsafe = false): unknown | null {
  if (ensureTelegramStateDir(false) === null) return null;
  try {
    assertSafeSecretFile(pathname);
  } catch (error) {
    if (error instanceof UnsafeTelegramSessionError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(fs.readFileSync(pathname, "utf8"));
  } catch {
    if (corruptIsUnsafe) throw new UnsafeTelegramSessionError(`cannot read ${path.basename(pathname)}`);
    return null;
  }
}

/** The same fence for a text payload — the Daily Report body (#1086), which
    is not JSON and must still be proven owner-only before it is read back. */
export function readSafeText(pathname: string): string | null {
  if (ensureTelegramStateDir(false) === null) return null;
  try {
    assertSafeSecretFile(pathname);
  } catch (error) {
    if (error instanceof UnsafeTelegramSessionError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return fs.readFileSync(pathname, "utf8");
}

/** What one backward tail read found, and whether it reached far enough back
    to answer the caller's question (issue #1091). */
export type SafeTail = {
  /** Whole lines only: a truncated head line is never handed to a parser. */
  text: string;
  /** `true` when the scan included the start of the file or `reached` accepted
      a chunk, so everything the caller asked about is inside `text`. `false` is
      a tail that ran out of budget first — an UNKNOWN answer, never a complete
      one. */
  complete: boolean;
};

/**
 * An owner-only APPEND-ONLY file, read BACKWARD from its end in `chunkBytes`
 * steps until `reached` accepts a chunk, the start of the file is included, or
 * `maxBytes` have been read (issue #1091).
 *
 * The connector's incoming feed grows for as long as the account receives
 * messages and nothing rotates it, so the Viewer must never read it whole —
 * but a FIXED tail was a silent lie. One dialog bursting all day pushes the
 * morning past any constant bound, and a report that then discovers only what
 * the constant happened to keep omits a dialog the operator answered without
 * saying so. The caller supplies the horizon instead: the scan keeps stepping
 * back until `reached` sees a line older than the window, and `complete` says
 * whether it got there before the budget ran out. Both bounds still hold, so a
 * feed of any size costs a fixed ceiling of I/O.
 *
 * `reached` is called with one chunk's whole lines, oldest-first order
 * preserved. A chunk boundary can split a line or a multi-byte character; the
 * split head line is dropped before the predicate sees it, which can only ever
 * make it answer "not yet" one line early.
 */
export function readSafeTailUntil(
  pathname: string,
  bounds: { chunkBytes: number; maxBytes: number },
  reached: (chunkText: string) => boolean,
): SafeTail | null {
  if (ensureTelegramStateDir(false) === null) return null;
  try {
    assertSafeSecretFile(pathname);
  } catch (error) {
    if (error instanceof UnsafeTelegramSessionError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const chunkBytes = Math.max(1, Math.trunc(bounds.chunkBytes));
  const maxBytes = Math.max(0, Math.trunc(bounds.maxBytes));
  const handle = fs.openSync(pathname, "r");
  try {
    const size = fs.fstatSync(handle).size;
    const chunks: Buffer[] = [];
    let start = size;
    let read = 0;
    let crossed = false;
    while (start > 0 && read < maxBytes) {
      const length = Math.min(chunkBytes, start, maxBytes - read);
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, start - length);
      chunks.unshift(buffer);
      start -= length;
      read += length;
      if (start === 0) break;
      const chunkText = buffer.toString("utf8");
      const chunkBreak = chunkText.indexOf("\n");
      if (chunkBreak !== -1 && reached(chunkText.slice(chunkBreak + 1))) {
        crossed = true;
        break;
      }
    }
    /* Decoded after concatenation so a character split across two chunks
       survives; only the predicate ever sees a chunk on its own. */
    const text = Buffer.concat(chunks).toString("utf8");
    if (start === 0) return { text, complete: true };
    const firstBreak = text.indexOf("\n");
    return { text: firstBreak === -1 ? "" : text.slice(firstBreak + 1), complete: crossed };
  } finally {
    fs.closeSync(handle);
  }
}

function safeFileExists(pathname: string): boolean {
  try {
    assertSafeSecretFile(pathname);
    return true;
  } catch (error) {
    if (error instanceof UnsafeTelegramSessionError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function removeSafeFile(pathname: string): void {
  if (ensureTelegramStateDir(false) === null || !safeFileExists(pathname)) return;
  fs.rmSync(pathname);
}

function existingSafeSecretContents(pathname: string): string | null {
  try {
    assertSafeSecretFile(pathname);
  } catch (error) {
    if (error instanceof UnsafeTelegramSessionError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return fs.readFileSync(pathname, "utf8");
}

/** Persists the enrolled session and returns the opaque reference every other
    surface uses to talk about it. */
export function saveTelegramSession(sessionString: string): StoredTelegramSession {
  ensureTelegramStateDir(true);
  return saveSessionFiles(telegramDir(), sessionString);
}

/**
 * The session + connector-token pair for ONE slot, in a directory the caller
 * has already fenced. The legacy slot and every named account slot share this
 * body, so a phone login gets the same atomicity, the same digest binding and
 * the same refusal to overwrite an existing unsafe pair.
 */
function saveSessionFiles(dir: string, sessionString: string): StoredTelegramSession {
  if (!sessionString) throw new Error("Telegram session string is empty");
  const sessionPath = path.join(dir, SESSION_FILE);
  const tokenPath = path.join(dir, CONNECTOR_TOKEN_FILE);
  /* Validate and read BOTH existing files before committing either new value.
     A refused session overwrite therefore cannot rotate or delete the token
     that its preserved JSON still references. */
  const previousSession = existingSafeSecretContents(sessionPath);
  const previousToken = existingSafeSecretContents(tokenPath);
  if (previousSession !== null || previousToken !== null) {
    const existing = readValidatedTelegramSessionFiles(dir);
    if (existing.status !== "valid") {
      throw new UnsafeTelegramSessionError(existing.status === "unsafe" ? existing.detail : "existing session pair is incomplete");
    }
  }
  const connectorToken = crypto.randomBytes(32).toString("base64url");
  const stored: StoredTelegramSession = {
    version: 1,
    credentialRef: crypto.randomUUID(),
    connectorToken,
    sessionString,
    savedAt: new Date().toISOString(),
  };
  const persisted: StoredTelegramSessionFile = {
    version: stored.version,
    credentialRef: stored.credentialRef,
    sessionString: stored.sessionString,
    savedAt: stored.savedAt,
    connectorTokenSha256: crypto.createHash("sha256").update(connectorToken).digest("hex"),
  };
  writeOwnerOnly(tokenPath, connectorToken + "\n");
  try {
    writeOwnerOnly(sessionPath, JSON.stringify(persisted));
  } catch (error) {
    try {
      if (previousToken === null) fs.rmSync(tokenPath, { force: true });
      else writeOwnerOnly(tokenPath, previousToken);
    } catch { /* preserve the original session error; storage remains fail-closed */ }
    throw error;
  }
  return stored;
}

/**
 * One named account slot, enrolled by phone (`<state>/telegram/accounts/<slug>/`).
 *
 * A second Telegram account is not a second copy of the first: it gets its own
 * directory, its own credential reference and its own connector token, and it
 * cannot be written under the `default` name, so the slot the HQ connector
 * reads is untouched by anything that happens here.
 */
export function saveTelegramAccountSession(slug: string, sessionString: string): StoredTelegramSession {
  const safe = writableAccountSlug(slug);
  if (!sessionString) throw new Error("Telegram session string is empty");
  const dir = ensureTelegramAccountDir(safe, true);
  if (dir === null) throw new UnsafeTelegramSessionError("telegram account directory is unavailable");
  return saveSessionFiles(dir, sessionString);
}

/** A slot's stored session, or null when it holds none. `default` reads the
    legacy slot, which is the whole point of the alias. */
export function readTelegramAccountSession(slug: string): StoredTelegramSession | null {
  const safe = accountSlug(slug);
  if (safe === DEFAULT_TELEGRAM_SLUG) return readTelegramSession();
  const result = readValidatedTelegramSessionFiles(telegramAccountDir(safe));
  if (result.status === "missing") return null;
  if (result.status === "unsafe") throw new UnsafeTelegramSessionError(result.detail);
  const row = result.sessionFile;
  return { version: 1, credentialRef: row.credentialRef, connectorToken: result.connectorToken, sessionString: row.sessionString, savedAt: row.savedAt };
}

/** Removes one slot entirely — credential, token and record together. The
    account is being forgotten, so nothing of it stays behind. */
export function deleteTelegramAccountSession(slug: string): void {
  const safe = writableAccountSlug(slug);
  const dir = telegramAccountDir(safe);
  if (!fs.existsSync(dir)) return;
  /* Each file is checked before it is removed, so a tampered slot is refused
     rather than swept: the same fail-closed boundary as the legacy slot. */
  for (const name of [SESSION_FILE, CONNECTOR_TOKEN_FILE, CONNECTION_FILE]) {
    removeSafeFileIn(dir, path.join(dir, name));
  }
  try { fs.rmdirSync(dir); } catch { /* something else lives here; leave it */ }
}

function removeSafeFileIn(dir: string, pathname: string): void {
  if (ensureOwnerOnlyDir(dir, false, "telegram account directory") === null || !safeFileExists(pathname)) return;
  fs.rmSync(pathname);
}

/**
 * What a slot records ABOUT its account, next to (never inside) the credential.
 *
 * The number and the handle are here because they are what the operator
 * recognises the account by on a phone screen; `vaultId` is the console record
 * the session was registered as, and `vaultReason` says why there is none when
 * there is none. No field here is a secret, and the session string is not one
 * of them.
 */
export type StoredTelegramAccountRecord = {
  version: 1;
  slug: string;
  phone: string | null;
  username: string | null;
  name: string | null;
  connectedAt: string;
  vaultId: string | null;
  vaultReason: string | null;
};

export function writeTelegramAccountRecord(slug: string, record: StoredTelegramAccountRecord): void {
  const safe = writableAccountSlug(slug);
  const dir = ensureTelegramAccountDir(safe, true);
  if (dir === null) throw new UnsafeTelegramSessionError("telegram account directory is unavailable");
  writeOwnerOnly(path.join(dir, CONNECTION_FILE), JSON.stringify({ ...record, slug: safe }));
}

export function readTelegramAccountRecord(slug: string): StoredTelegramAccountRecord | null {
  const safe = accountSlug(slug);
  const dir = telegramAccountDir(safe);
  const pathname = path.join(dir, CONNECTION_FILE);
  if (ensureOwnerOnlyDir(dir, false, "telegram account directory") === null) return null;
  try {
    assertSafeSecretFile(pathname);
  } catch (error) {
    if (error instanceof UnsafeTelegramSessionError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(pathname, "utf8")); }
  catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Partial<StoredTelegramAccountRecord>;
  const word = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
  return {
    version: 1,
    slug: safe,
    phone: word(row.phone),
    username: word(row.username),
    name: word(row.name),
    connectedAt: word(row.connectedAt) ?? "",
    vaultId: word(row.vaultId),
    vaultReason: word(row.vaultReason),
  };
}

/** One row per enrolled account, as the phone lists them. */
export type TelegramAccountListing = {
  slug: string;
  phone: string | null;
  username: string | null;
  name: string | null;
  connectedAt: string | null;
  vaultId: string | null;
  /** Why the console holds no record for this account — or why the slot itself
      cannot be read. Absent reasons mean there is nothing to say. */
  vaultReason: string | null;
};

/**
 * Every account this machine holds: the legacy slot as `default`, then each
 * named slot.
 *
 * A slot with no session is not an account and is left out — a half-written
 * directory is not something to offer as a login. A slot that fails the safety
 * fence is NOT hidden, though: it is reported with its reason, because a
 * credential directory someone widened is exactly the thing the operator needs
 * to see rather than the thing to quietly drop from a list.
 */
export function listTelegramAccounts(): TelegramAccountListing[] {
  const rows: TelegramAccountListing[] = [];
  try {
    const legacy = readTelegramSession();
    if (legacy) {
      const connection = readTelegramConnection();
      rows.push({
        slug: DEFAULT_TELEGRAM_SLUG,
        /* The legacy slot was enrolled by QR and never recorded a number.
           Saying so beats inventing one. */
        phone: null,
        username: connection.identity?.username ?? null,
        name: connection.identity?.name ?? null,
        connectedAt: legacy.savedAt,
        vaultId: null,
        vaultReason: null,
      });
    }
  } catch { /* the panel reports an unsafe default slot in its own words */ }

  const accountsRoot = statePath(DIR_NAME, ACCOUNTS_DIR);
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(accountsRoot, { withFileTypes: true }); }
  catch { return rows; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !TELEGRAM_ACCOUNT_SLUG.test(entry.name)) continue;
    try {
      if (readTelegramAccountSession(entry.name) === null) continue;
      const record = readTelegramAccountRecord(entry.name);
      rows.push({
        slug: entry.name,
        phone: record?.phone ?? null,
        username: record?.username ?? null,
        name: record?.name ?? null,
        connectedAt: record?.connectedAt || null,
        vaultId: record?.vaultId ?? null,
        vaultReason: record?.vaultReason ?? null,
      });
    } catch (error) {
      rows.push({
        slug: entry.name, phone: null, username: null, name: null, connectedAt: null, vaultId: null,
        vaultReason: error instanceof UnsafeTelegramSessionError ? error.message : "unreadable",
      });
    }
  }
  return rows;
}

function readTelegramSessionUnchecked(): StoredTelegramSession | null {
  const result = readValidatedTelegramSessionFiles(telegramDir());
  if (result.status === "missing") return null;
  if (result.status === "unsafe") throw new UnsafeTelegramSessionError(result.detail);
  const row = result.sessionFile;
  return { version: 1, credentialRef: row.credentialRef, connectorToken: result.connectorToken, sessionString: row.sessionString, savedAt: row.savedAt };
}

export function readTelegramSession(): StoredTelegramSession | null {
  try {
    return readTelegramSessionUnchecked();
  } catch (error) {
    if (error instanceof UnsafeTelegramSessionError) throw error;
    throw new UnsafeTelegramSessionError("cannot read session storage");
  }
}

export function deleteTelegramSession(): void {
  if (ensureTelegramStateDir(false) === null) return;
  /* The incoming feed goes with the credential that produced it (#1091): the
     connector is stopped by this point, and what it recorded names the
     departing account's correspondents. Swept FIRST so a refused credential
     removal below cannot leave that record behind. */
  removeIncomingFeeds();
  const paths = [telegramSessionPath(), telegramConnectorTokenPath()];
  const existing = paths.filter((pathname) => safeFileExists(pathname));
  for (const pathname of existing) fs.rmSync(pathname);
}

const DISCONNECTED: StoredTelegramConnection = {
  version: 1,
  status: "disconnected",
  credentialRef: null,
  identity: null,
  lastHealthCheckAt: null,
  errorCode: null,
  identityIdUpgradedAt: null,
};

/** A stored identity, with a pre-#1091 record (no `id`) read as an identity
    whose id is simply unknown rather than as no identity at all. */
function readIdentity(value: unknown): TelegramAccountIdentity | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<TelegramAccountIdentity>;
  if (typeof row.name !== "string") return null;
  return {
    name: row.name,
    username: typeof row.username === "string" ? row.username : null,
    id: validTelegramAccountId(row.id),
  };
}

export function readTelegramConnection(): StoredTelegramConnection {
  const parsed = readSafeJson(telegramConnectionPath());
  if (!parsed || typeof parsed !== "object") return { ...DISCONNECTED };
  const row = parsed as Partial<StoredTelegramConnection>;
  if (row.version !== 1 || typeof row.status !== "string") return { ...DISCONNECTED };
  return {
    version: 1,
    status: row.status as TelegramConnectionStatus,
    credentialRef: typeof row.credentialRef === "string" ? row.credentialRef : null,
    identity: readIdentity(row.identity),
    lastHealthCheckAt: typeof row.lastHealthCheckAt === "string" ? row.lastHealthCheckAt : null,
    errorCode: typeof row.errorCode === "string" ? row.errorCode as TelegramErrorCode : null,
    identityIdUpgradedAt: typeof row.identityIdUpgradedAt === "string" ? row.identityIdUpgradedAt : null,
  };
}

export function writeTelegramConnection(connection: StoredTelegramConnection): void {
  atomicSecretWrite(telegramConnectionPath(), JSON.stringify(connection));
}

export function clearTelegramConnection(): void {
  removeSafeFile(telegramConnectionPath());
}
