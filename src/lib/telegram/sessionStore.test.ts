import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "llv-telegram-store-"));
const OLD_STATE = process.env.LLV_STATE_DIR;
process.env.LLV_STATE_DIR = path.join(SANDBOX, "state");

const {
  deleteTelegramSession,
  readTelegramConnection,
  readTelegramSession,
  saveTelegramSession,
  telegramConnectionPath,
  telegramIncomingFeedPath,
  telegramConnectorTokenPath,
  telegramSessionPath,
  writeTelegramConnection,
  UnsafeTelegramSessionError,
} = await import("./sessionStore");

/* A placeholder with the string-session shape; never a real credential. */
const PLACEHOLDER_SESSION = "1ApWapzMBu4placeholder-not-a-real-session";

beforeEach(() => {
  fs.rmSync(process.env.LLV_STATE_DIR!, { recursive: true, force: true });
});
afterAll(() => {
  if (OLD_STATE === undefined) delete process.env.LLV_STATE_DIR;
  else process.env.LLV_STATE_DIR = OLD_STATE;
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test("saves the session owner-only, atomically, and reads it back", () => {
  const stored = saveTelegramSession(PLACEHOLDER_SESSION);
  expect(stored.credentialRef).toMatch(/^[0-9a-f-]{36}$/);
  expect(stored.connectorToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

  const file = telegramSessionPath();
  const stat = fs.statSync(file);
  expect(stat.isFile()).toBe(true);
  expect(stat.mode & 0o777).toBe(0o600);
  expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  expect(fs.statSync(telegramConnectorTokenPath()).mode & 0o777).toBe(0o600);
  expect(fs.readFileSync(file, "utf8")).not.toContain(stored.connectorToken);
  /* Atomic: no temp sibling survives the write. */
  expect(fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp"))).toEqual([]);

  const read = readTelegramSession();
  expect(read?.sessionString).toBe(PLACEHOLDER_SESSION);
  expect(read?.credentialRef).toBe(stored.credentialRef);
});

test("a fresh save rotates the opaque credentialRef", () => {
  const first = saveTelegramSession(PLACEHOLDER_SESSION);
  const second = saveTelegramSession(PLACEHOLDER_SESSION + "-again");
  expect(second.credentialRef).not.toBe(first.credentialRef);
  expect(second.connectorToken).not.toBe(first.connectorToken);
  expect(readTelegramSession()?.sessionString).toBe(PLACEHOLDER_SESSION + "-again");
});

test("a refused overwrite preserves the existing session and connector token bytes", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  const sessionBefore = fs.readFileSync(telegramSessionPath());
  const tokenBefore = fs.readFileSync(telegramConnectorTokenPath());
  fs.chmodSync(telegramSessionPath(), 0o644);

  expect(() => saveTelegramSession(PLACEHOLDER_SESSION + "-replacement")).toThrow(UnsafeTelegramSessionError);

  expect(fs.readFileSync(telegramSessionPath())).toEqual(sessionBefore);
  expect(fs.readFileSync(telegramConnectorTokenPath())).toEqual(tokenBefore);
});

test("a mismatched existing pair remains preserved until explicit deletion", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  fs.writeFileSync(telegramConnectorTokenPath(), "C".repeat(43) + "\n", { mode: 0o600 });
  const sessionBefore = fs.readFileSync(telegramSessionPath());
  const tokenBefore = fs.readFileSync(telegramConnectorTokenPath());

  expect(() => saveTelegramSession(PLACEHOLDER_SESSION + "-replacement")).toThrow(UnsafeTelegramSessionError);

  expect(fs.readFileSync(telegramSessionPath())).toEqual(sessionBefore);
  expect(fs.readFileSync(telegramConnectorTokenPath())).toEqual(tokenBefore);
});

test("a session write failure rolls the connector token back byte-for-byte", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  const sessionBefore = fs.readFileSync(telegramSessionPath());
  const tokenBefore = fs.readFileSync(telegramConnectorTokenPath());
  const originalWrite = fs.writeFileSync;
  const write = spyOn(fs, "writeFileSync").mockImplementation(((pathname: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (typeof pathname === "string" && path.basename(pathname).startsWith(".session.json.")) {
      const error = new Error("simulated session write failure") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    }
    return originalWrite(pathname, ...(args as Parameters<typeof fs.writeFileSync> extends [unknown, ...infer Rest] ? Rest : never));
  }) as typeof fs.writeFileSync);
  try {
    expect(() => saveTelegramSession(PLACEHOLDER_SESSION + "-replacement")).toThrow("simulated session write failure");
  } finally {
    write.mockRestore();
  }

  expect(fs.readFileSync(telegramSessionPath())).toEqual(sessionBefore);
  expect(fs.readFileSync(telegramConnectorTokenPath())).toEqual(tokenBefore);
});

test("refuses a symlinked session file instead of following it", () => {
  const target = path.join(SANDBOX, "outside.json");
  fs.writeFileSync(target, JSON.stringify({ version: 1, credentialRef: "x", sessionString: "y" }));
  fs.mkdirSync(path.dirname(telegramSessionPath()), { recursive: true, mode: 0o700 });
  fs.symlinkSync(target, telegramSessionPath());
  expect(() => readTelegramSession()).toThrow(UnsafeTelegramSessionError);
  /* And refuses to overwrite through it. */
  expect(() => saveTelegramSession(PLACEHOLDER_SESSION)).toThrow(UnsafeTelegramSessionError);
  expect(() => deleteTelegramSession()).toThrow(UnsafeTelegramSessionError);
  expect(fs.existsSync(target)).toBe(true);
});

test("refuses a session file with group/other permission bits", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  fs.chmodSync(telegramSessionPath(), 0o644);
  expect(() => readTelegramSession()).toThrow(UnsafeTelegramSessionError);
});

test("a symlinked telegram DIRECTORY is refused for reads and writes alike", () => {
  const outside = path.join(SANDBOX, "outside-dir");
  fs.mkdirSync(outside, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(outside, "session.json"), JSON.stringify({ version: 1, credentialRef: "x", sessionString: "planted" }), { mode: 0o600 });
  const dir = path.dirname(telegramSessionPath());
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.symlinkSync(outside, dir);
  /* Read, write, and deletion all refuse the redirected directory. */
  expect(() => saveTelegramSession(PLACEHOLDER_SESSION)).toThrow(UnsafeTelegramSessionError);
  expect(() => readTelegramSession()).toThrow(UnsafeTelegramSessionError);
  expect(() => deleteTelegramSession()).toThrow(UnsafeTelegramSessionError);
  expect(fs.readdirSync(outside)).toEqual(["session.json"]);
});

test("a pre-existing group-readable telegram directory is refused", () => {
  const dir = path.dirname(telegramSessionPath());
  /* mkdir mode only applies on creation — a pre-existing 0755 boundary must
     fail closed instead of being silently accepted or rewritten. */
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  fs.chmodSync(dir, 0o755);
  expect(() => saveTelegramSession(PLACEHOLDER_SESSION)).toThrow(UnsafeTelegramSessionError);
  expect(() => readTelegramSession()).toThrow(UnsafeTelegramSessionError);
  expect(fs.statSync(dir).mode & 0o777).toBe(0o755);
});

test("deletion is idempotent and leaves nothing behind", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  deleteTelegramSession();
  deleteTelegramSession();
  expect(fs.existsSync(telegramSessionPath())).toBe(false);
  expect(readTelegramSession()).toBeNull();
});

test("disconnect takes the incoming feed with the credential (#1091)", () => {
  const session = saveTelegramSession(PLACEHOLDER_SESSION);
  /* What the connector wrote for this generation, plus the pre-#1091 unscoped
     name a Viewer that predates the scoping left behind. Both name the
     operator's correspondents, so neither outlives the credential. */
  const scoped = telegramIncomingFeedPath(session.credentialRef);
  const legacy = path.join(path.dirname(scoped), "incoming_feed.jsonl");
  const unrelated = path.join(path.dirname(scoped), "report-history.json");
  for (const pathname of [scoped, legacy, unrelated]) fs.writeFileSync(pathname, "{}\n", { mode: 0o600 });

  deleteTelegramSession();

  expect(fs.existsSync(scoped)).toBe(false);
  expect(fs.existsSync(legacy)).toBe(false);
  /* Only the feed: disconnect is not a sweep of the directory. */
  expect(fs.existsSync(unrelated)).toBe(true);
});

test("a reconnect cannot read the previous credential generation's feed (#1091)", () => {
  const first = saveTelegramSession(PLACEHOLDER_SESSION);
  deleteTelegramSession();
  const second = saveTelegramSession(PLACEHOLDER_SESSION);

  expect(second.credentialRef).not.toBe(first.credentialRef);
  expect(telegramIncomingFeedPath(second.credentialRef)).not.toBe(telegramIncomingFeedPath(first.credentialRef));
  /* A digest of the ref, never the ref itself: nothing read from disk is
     spliced into a path. */
  expect(path.basename(telegramIncomingFeedPath(second.credentialRef))).toMatch(/^incoming_feed-[0-9a-f]{16}\.jsonl$/);
  expect(telegramIncomingFeedPath(second.credentialRef)).not.toContain(second.credentialRef);
});

test("connection status round-trips and never carries the session string", () => {
  writeTelegramConnection({
    version: 1,
    status: "connected",
    credentialRef: "ref-1",
    identity: { name: "Account A", username: "account_a", id: "770000001" },
    lastHealthCheckAt: "2026-08-20T10:00:00.000Z",
    errorCode: null,
    identityIdUpgradedAt: null,
  });
  const read = readTelegramConnection();
  expect(read.status).toBe("connected");
  expect(read.identity?.name).toBe("Account A");
  expect(fs.readFileSync(telegramConnectionPath(), "utf8")).not.toContain("sessionString");
});

test("a missing or corrupt connection file reads as disconnected", () => {
  expect(readTelegramConnection().status).toBe("disconnected");
  fs.mkdirSync(path.dirname(telegramConnectionPath()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(telegramConnectionPath(), "{not json", { mode: 0o600 });
  expect(readTelegramConnection().status).toBe("disconnected");
});

test("a corrupt session is unsafe and preserved for explicit local deletion", () => {
  const file = telegramSessionPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, "{broken", { mode: 0o600 });

  expect(() => readTelegramSession()).toThrow(UnsafeTelegramSessionError);
  expect(fs.readFileSync(file, "utf8")).toBe("{broken");

  deleteTelegramSession();
  expect(fs.existsSync(file)).toBe(false);
});

test("a session read I/O failure is unsafe and preserves the credential", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  const originalRead = fs.readFileSync;
  const read = spyOn(fs, "readFileSync").mockImplementation(((pathname: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    if (pathname === telegramSessionPath()) {
      const error = new Error("simulated session read failure") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    }
    return originalRead(pathname, ...(args as Parameters<typeof fs.readFileSync> extends [unknown, ...infer Rest] ? Rest : never));
  }) as typeof fs.readFileSync);
  try {
    expect(() => readTelegramSession()).toThrow(UnsafeTelegramSessionError);
  } finally {
    read.mockRestore();
  }
  expect(fs.existsSync(telegramSessionPath())).toBe(true);
});

test("local deletion preflights both credential files before removing either", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  const external = path.join(SANDBOX, "external-token");
  fs.writeFileSync(external, "external", { mode: 0o600 });
  fs.rmSync(telegramConnectorTokenPath());
  fs.symlinkSync(external, telegramConnectorTokenPath());

  expect(() => deleteTelegramSession()).toThrow(UnsafeTelegramSessionError);
  expect(fs.existsSync(telegramSessionPath())).toBe(true);
  expect(fs.readFileSync(external, "utf8")).toBe("external");
});

/* ---------------------------------------------------------------------------
 * Named account slots (the phone-login flow).
 *
 * The HQ's connector reads ONE session — the legacy files at the top of the
 * telegram directory — and it must keep reading exactly those. Everything a
 * phone login enrols lands in its own slot under `accounts/<slug>/`, with the
 * same three files behind the same owner-only fence, so a second account can
 * never widen or move the first. `default` names the legacy slot in listings
 * and nowhere else: it is an alias for reading, never a slot to write into.
 * ------------------------------------------------------------------------ */

const {
  DEFAULT_TELEGRAM_SLUG,
  deleteTelegramAccountSession,
  listTelegramAccounts,
  readTelegramAccountRecord,
  readTelegramAccountSession,
  saveTelegramAccountSession,
  telegramAccountDir,
  writeTelegramAccountRecord,
} = await import("./sessionStore");

const SLOT_SESSION = "1BvWapzMBu4placeholder-not-a-real-session";
/* The reserved all-zero range: a fixture number, never a real one. */
const FIXTURE_PHONE = "+10000000000";

test("an account slot keeps its three files owner-only in an owner-only directory", () => {
  const stored = saveTelegramAccountSession("work", SLOT_SESSION);
  expect(stored.credentialRef).toMatch(/^[0-9a-f-]{36}$/);

  const dir = telegramAccountDir("work");
  expect(dir.endsWith(path.join("telegram", "accounts", "work"))).toBe(true);
  expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  expect(fs.statSync(path.dirname(dir)).mode & 0o777).toBe(0o700);
  for (const name of ["session.json", "connector-token"]) {
    expect(fs.statSync(path.join(dir, name)).mode & 0o777).toBe(0o600);
  }
  expect(fs.readdirSync(dir).filter((name) => name.includes(".tmp"))).toEqual([]);
  expect(readTelegramAccountSession("work")?.sessionString).toBe(SLOT_SESSION);
});

test("a slot leaves the legacy default slot exactly where it was", () => {
  const legacy = saveTelegramSession(PLACEHOLDER_SESSION);
  const legacyBytes = fs.readFileSync(telegramSessionPath());
  saveTelegramAccountSession("work", SLOT_SESSION);

  expect(fs.readFileSync(telegramSessionPath())).toEqual(legacyBytes);
  expect(readTelegramSession()?.credentialRef).toBe(legacy.credentialRef);
  expect(readTelegramSession()?.sessionString).toBe(PLACEHOLDER_SESSION);
});

test("two slots hold two different sessions", () => {
  saveTelegramAccountSession("work", SLOT_SESSION);
  saveTelegramAccountSession("private", SLOT_SESSION + "-2");
  expect(readTelegramAccountSession("work")?.sessionString).toBe(SLOT_SESSION);
  expect(readTelegramAccountSession("private")?.sessionString).toBe(SLOT_SESSION + "-2");
});

test("only a slug-shaped name is a slot", () => {
  for (const bad of ["", "a", "Work", "wo rk", "../escape", "work/sub", "w".repeat(33), "-lead"]) {
    expect(() => saveTelegramAccountSession(bad, SLOT_SESSION)).toThrow();
    expect(() => telegramAccountDir(bad)).toThrow();
  }
});

test("`default` is an alias for reading, never a slot to write into", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  expect(() => saveTelegramAccountSession(DEFAULT_TELEGRAM_SLUG, SLOT_SESSION)).toThrow();
  expect(() => deleteTelegramAccountSession(DEFAULT_TELEGRAM_SLUG)).toThrow();
  /* And the legacy files stayed where the connector reads them. */
  expect(readTelegramSession()?.sessionString).toBe(PLACEHOLDER_SESSION);
  expect(fs.existsSync(path.join(telegramAccountDir("work"), ".."))).toBe(false);
});

test("a slot's record carries the phone and the handle, never the session", () => {
  saveTelegramAccountSession("work", SLOT_SESSION);
  writeTelegramAccountRecord("work", {
    version: 1,
    slug: "work",
    phone: FIXTURE_PHONE,
    username: "example_handle",
    name: "Example",
    connectedAt: "2026-08-20T12:00:00.000Z",
    vaultId: "telegram_session_work",
    vaultReason: null,
  });

  const record = readTelegramAccountRecord("work");
  expect(record?.phone).toBe(FIXTURE_PHONE);
  expect(record?.username).toBe("example_handle");
  expect(record?.vaultId).toBe("telegram_session_work");
  const onDisk = fs.readFileSync(path.join(telegramAccountDir("work"), "connection.json"), "utf8");
  expect(onDisk).not.toContain(SLOT_SESSION);
  expect(fs.statSync(path.join(telegramAccountDir("work"), "connection.json")).mode & 0o777).toBe(0o600);
});

test("the listing reports every slot plus the legacy slot as `default`", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  writeTelegramConnection({
    version: 1,
    status: "connected",
    credentialRef: "ref-1",
    identity: { name: "Account A", username: "account_a", id: "770000001" },
    lastHealthCheckAt: "2026-08-20T10:00:00.000Z",
    errorCode: null,
    identityIdUpgradedAt: null,
  });
  saveTelegramAccountSession("work", SLOT_SESSION);
  writeTelegramAccountRecord("work", {
    version: 1, slug: "work", phone: FIXTURE_PHONE, username: "example_handle",
    name: "Example", connectedAt: "2026-08-20T12:00:00.000Z", vaultId: "telegram_session_work", vaultReason: null,
  });

  const accounts = listTelegramAccounts();
  expect(accounts.map((row) => row.slug).sort()).toEqual(["default", "work"]);
  const fallback = accounts.find((row) => row.slug === "default")!;
  expect(fallback.username).toBe("account_a");
  /* The legacy slot never recorded a number — saying so is better than inventing one. */
  expect(fallback.phone).toBeNull();
  const work = accounts.find((row) => row.slug === "work")!;
  expect(work.phone).toBe(FIXTURE_PHONE);
  expect(work.connectedAt).toBe("2026-08-20T12:00:00.000Z");
});

test("the listing is empty when nothing is enrolled, and skips a slot with no session", () => {
  expect(listTelegramAccounts()).toEqual([]);
  fs.mkdirSync(telegramAccountDir("halfway"), { recursive: true, mode: 0o700 });
  expect(listTelegramAccounts()).toEqual([]);
});

test("a slot with widened permissions is refused rather than read", () => {
  saveTelegramAccountSession("work", SLOT_SESSION);
  fs.chmodSync(path.join(telegramAccountDir("work"), "session.json"), 0o644);
  expect(() => readTelegramAccountSession("work")).toThrow(UnsafeTelegramSessionError);
});

test("deleting a slot removes it and leaves the others and the legacy slot alone", () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  saveTelegramAccountSession("work", SLOT_SESSION);
  saveTelegramAccountSession("private", SLOT_SESSION + "-2");

  deleteTelegramAccountSession("work");
  deleteTelegramAccountSession("work");

  expect(fs.existsSync(telegramAccountDir("work"))).toBe(false);
  expect(readTelegramAccountSession("private")?.sessionString).toBe(SLOT_SESSION + "-2");
  expect(readTelegramSession()?.sessionString).toBe(PLACEHOLDER_SESSION);
});
