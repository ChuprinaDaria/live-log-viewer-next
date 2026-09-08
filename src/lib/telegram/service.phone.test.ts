import { afterAll, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "llv-telegram-phone-"));
const OLD_STATE = process.env.LLV_STATE_DIR;
process.env.LLV_STATE_DIR = path.join(SANDBOX, "state");

const { TelegramConnectionService } = await import("./service");
const {
  listTelegramAccounts,
  readTelegramAccountRecord,
  readTelegramAccountSession,
  readTelegramSession,
  saveTelegramSession,
  telegramAccountDir,
} = await import("./sessionStore");

import type { TelegramAdapter, TelegramEnrollmentEvent, TelegramEnrollmentHandle, TelegramPhoneEnrollmentHandle, TelegramPhoneStart } from "./adapter";
import type { TelegramServicePorts, VaultRegistration } from "./service";

/*
 * Connecting a Telegram USER account from a phone, by number.
 *
 * The operator works from an iPhone, and a QR code drawn on that same phone
 * cannot be scanned by it. So the same enrolment reaches the same credential
 * store through a different door: number → code → optional 2FA password. What
 * these tests hold to is that the door is the only thing that differs — the
 * session still lands in an owner-only slot, the slot the HQ connector reads
 * is never touched, the session string reaches the console's vault and nothing
 * else, and every refusal keeps its own word instead of collapsing to "failed".
 *
 * Nothing here reaches Telegram: the adapter is a fake, and the number is the
 * reserved all-zero range.
 */

const PLACEHOLDER_SESSION = "1ApWapzMBu4placeholder-not-a-real-session";
const SLOT_SESSION = "1BvWapzMBu4placeholder-not-a-real-session";
const PHONE = "+10000000000";

class FakeAdapter implements TelegramAdapter {
  starts: TelegramPhoneStart[] = [];
  emit: ((event: TelegramEnrollmentEvent) => void) | null = null;
  codes: string[] = [];
  passwords: string[] = [];
  canceled = 0;
  logoutSessions: string[] = [];
  logoutResult: { ok: boolean; code: null | "logout_failed" } = { ok: true, code: null };

  unavailableReason() { return null; }
  startEnrollment(): TelegramEnrollmentHandle { throw new Error("the QR flow is not under test here"); }
  checkSession() { return Promise.resolve({ status: "expired" } as const); }
  logout(sessionString: string) {
    this.logoutSessions.push(sessionString);
    return Promise.resolve(this.logoutResult);
  }
  startPhoneEnrollment(input: TelegramPhoneStart, onEvent: (event: TelegramEnrollmentEvent) => void): TelegramPhoneEnrollmentHandle {
    this.starts.push(input);
    this.emit = onEvent;
    return {
      submitCode: (code: string) => { this.codes.push(code); },
      submitPassword: (password: string) => { this.passwords.push(password); },
      cancel: () => { this.canceled += 1; },
    };
  }
}

function harness(vault?: (input: { slug: string; phone: string; username: string | null; sessionString: string }) => Promise<VaultRegistration>) {
  const adapter = new FakeAdapter();
  const vaultCalls: Array<{ slug: string; phone: string; username: string | null; sessionString: string }> = [];
  const ports: Partial<TelegramServicePorts> & { adapter: TelegramAdapter } = {
    adapter,
    ensureConnector: async () => ({ ok: true, url: "http://127.0.0.1:8809/mcp" }),
    readConnectorIdentity: async () => null,
    stopConnector: () => {},
    registerHosts: () => ({ ok: true, claude: { registered: 0, conflict: 0, unwritable: 0 }, codex: { registered: 0, failed: 0 } }),
    unregisterHosts: () => {},
    now: () => Date.parse("2026-08-20T12:00:00.000Z"),
    credentialsConfigured: () => true,
    registerAccountSecret: async (input) => {
      vaultCalls.push(input);
      return vault ? await vault(input) : { id: `telegram_session_${input.slug}`, reason: null };
    },
  };
  return { adapter, vaultCalls, service: new TelegramConnectionService(ports as TelegramServicePorts) };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Drives one slot all the way from a number to a stored session. */
async function connect(service: ReturnType<typeof harness>["service"], adapter: FakeAdapter, slug = "work") {
  const started = await service.startPhoneLogin({ slug, phone: PHONE });
  const operationId = started.logins[0].operationId;
  adapter.emit!({ type: "code_required" });
  await settle();
  await service.submitCode(operationId, "12345");
  adapter.emit!({ type: "authorized", sessionString: SLOT_SESSION, identity: { name: "Example", username: "example_handle", id: "770000002" } });
  await settle();
  return operationId;
}

beforeEach(() => {
  fs.rmSync(process.env.LLV_STATE_DIR!, { recursive: true, force: true });
});
afterAll(() => {
  if (OLD_STATE === undefined) delete process.env.LLV_STATE_DIR;
  else process.env.LLV_STATE_DIR = OLD_STATE;
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test("number, code, connected: the session lands in its own slot and the vault", async () => {
  const { adapter, vaultCalls, service } = harness();

  const started = await service.startPhoneLogin({ slug: "work", phone: PHONE });
  expect(started.logins[0].phase).toBe("starting");
  expect(started.logins[0].slug).toBe("work");
  expect(adapter.starts).toEqual([{ phone: PHONE }]);

  adapter.emit!({ type: "code_required" });
  await settle();
  expect(service.accounts().logins[0].phase).toBe("awaiting_code");

  await service.submitCode(started.logins[0].operationId, "12345");
  expect(adapter.codes).toEqual(["12345"]);

  adapter.emit!({ type: "authorized", sessionString: SLOT_SESSION, identity: { name: "Example", username: "example_handle", id: "770000002" } });
  await settle();

  const after = service.accounts();
  expect(after.logins[0].phase).toBe("connected");
  expect(after.logins[0].identity?.username).toBe("example_handle");
  expect(readTelegramAccountSession("work")?.sessionString).toBe(SLOT_SESSION);
  /* The vault got the session string, and it is the only place outside the
     slot that ever sees it. */
  expect(vaultCalls).toEqual([{ slug: "work", phone: PHONE, username: "example_handle", sessionString: SLOT_SESSION }]);
  expect(readTelegramAccountRecord("work")?.vaultId).toBe("telegram_session_work");
  expect(after.accounts.map((row) => row.slug)).toEqual(["work"]);
  expect(after.accounts[0].phone).toBe(PHONE);
});

test("the slot's record names the account and never holds the session", async () => {
  const { adapter, service } = harness();
  await connect(service, adapter);

  const onDisk = fs.readFileSync(path.join(telegramAccountDir("work"), "connection.json"), "utf8");
  expect(onDisk).toContain(PHONE);
  expect(onDisk).not.toContain(SLOT_SESSION);
});

test("the HQ's default slot is untouched by a phone login", async () => {
  const legacy = saveTelegramSession(PLACEHOLDER_SESSION);
  const { adapter, service } = harness();
  await connect(service, adapter);

  expect(readTelegramSession()?.credentialRef).toBe(legacy.credentialRef);
  expect(readTelegramSession()?.sessionString).toBe(PLACEHOLDER_SESSION);
  expect(listTelegramAccounts().map((row) => row.slug).sort()).toEqual(["default", "work"]);
});

test("a console that cannot take the session keeps the slot and says why", async () => {
  const { adapter, service } = harness(async () => ({ id: null, reason: "console_missing" }));
  await connect(service, adapter);

  expect(readTelegramAccountSession("work")?.sessionString).toBe(SLOT_SESSION);
  const record = readTelegramAccountRecord("work");
  expect(record?.vaultId).toBeNull();
  expect(record?.vaultReason).toBe("console_missing");
  expect(service.accounts().accounts[0].vaultReason).toBe("console_missing");
});

test("a wrong code stays on the code step and says so", async () => {
  const { adapter, service } = harness();
  const started = await service.startPhoneLogin({ slug: "work", phone: PHONE });
  adapter.emit!({ type: "code_required" });
  await settle();
  await service.submitCode(started.logins[0].operationId, "11111");
  adapter.emit!({ type: "code_invalid" });
  await settle();

  const view = service.accounts().logins[0];
  expect(view.phase).toBe("awaiting_code");
  expect(view.codeError).toBe(true);
  expect(view.error).toBeNull();

  /* A second attempt clears the mark before it is sent. */
  await service.submitCode(started.logins[0].operationId, "22222");
  expect(service.accounts().logins[0].codeError).toBe(false);
  expect(adapter.codes).toEqual(["11111", "22222"]);
});

test("a flood wait ends the attempt and carries the seconds", async () => {
  const { adapter, service } = harness();
  await service.startPhoneLogin({ slug: "work", phone: PHONE });
  adapter.emit!({ type: "flood_wait", seconds: 86 });
  await settle();

  const view = service.accounts().logins[0];
  expect(view.phase).toBe("failed");
  expect(view.error).toEqual({ code: "flood_wait", seconds: 86 });
  expect(service.accounts().accounts).toEqual([]);
});

test("two-step verification asks for the password on the same operation", async () => {
  const { adapter, service } = harness();
  const started = await service.startPhoneLogin({ slug: "work", phone: PHONE });
  const operationId = started.logins[0].operationId;
  adapter.emit!({ type: "code_required" });
  await settle();
  await service.submitCode(operationId, "12345");
  adapter.emit!({ type: "password_required" });
  await settle();
  expect(service.accounts().logins[0].phase).toBe("awaiting_password");

  adapter.emit!({ type: "password_invalid" });
  await settle();
  expect(service.accounts().logins[0].passwordError).toBe(true);

  await service.submitPhonePassword(operationId, "fixture-2fa");
  expect(adapter.passwords).toEqual(["fixture-2fa"]);
  expect(service.accounts().logins[0].passwordError).toBe(false);
});

test("one login in flight per slug, and slugs do not block each other", async () => {
  const { service } = harness();
  await service.startPhoneLogin({ slug: "work", phone: PHONE });
  await expect(service.startPhoneLogin({ slug: "work", phone: PHONE })).rejects.toThrow(/already running/);
  await service.startPhoneLogin({ slug: "private", phone: PHONE });
  expect(service.accounts().logins.map((row) => row.slug).sort()).toEqual(["private", "work"]);
});

test("the default slot cannot be enrolled by phone", async () => {
  const { service } = harness();
  await expect(service.startPhoneLogin({ slug: "default", phone: PHONE })).rejects.toThrow();
  await expect(service.startPhoneLogin({ slug: "Nope", phone: PHONE })).rejects.toThrow();
  await expect(service.startPhoneLogin({ slug: "work", phone: "not a number" })).rejects.toThrow();
});

test("an adapter with no phone door fails the login instead of hanging", async () => {
  const { adapter, service } = harness();
  /* Shadowed on the instance: the method lives on the prototype, so `delete`
     would leave it reachable and the test would prove nothing. */
  (adapter as { startPhoneEnrollment?: unknown }).startPhoneEnrollment = undefined;
  await service.startPhoneLogin({ slug: "work", phone: PHONE });
  await settle();
  expect(service.accounts().logins[0].error?.code).toBe("start_failed");
});

test("cancelling a phone login leaves no slot behind", async () => {
  const { adapter, service } = harness();
  const started = await service.startPhoneLogin({ slug: "work", phone: PHONE });
  await service.cancelPhoneLogin(started.logins[0].operationId);
  expect(adapter.canceled).toBe(1);
  expect(service.accounts().logins).toEqual([]);
  expect(fs.existsSync(telegramAccountDir("work"))).toBe(false);
});

test("signing out of an account revokes it remotely and removes the slot", async () => {
  const { adapter, service } = harness();
  await connect(service, adapter);

  const after = await service.logoutAccount("work");
  expect(adapter.logoutSessions).toEqual([SLOT_SESSION]);
  expect(after.accounts).toEqual([]);
  expect(fs.existsSync(telegramAccountDir("work"))).toBe(false);
});

test("a refused remote logout keeps the credential and says why", async () => {
  const { adapter, service } = harness();
  await connect(service, adapter);
  adapter.logoutResult = { ok: false, code: "logout_failed" };

  const after = await service.logoutAccount("work");
  expect(after.accounts.map((row) => row.slug)).toEqual(["work"]);
  expect(readTelegramAccountSession("work")?.sessionString).toBe(SLOT_SESSION);
  expect(after.logins.find((row) => row.slug === "work")?.error?.code).toBe("logout_failed");
});

test("deleting an account is local only and asks Telegram nothing", async () => {
  const { adapter, service } = harness();
  await connect(service, adapter);

  const after = await service.deleteAccount("work");
  expect(adapter.logoutSessions).toEqual([]);
  expect(after.accounts).toEqual([]);
  expect(fs.existsSync(telegramAccountDir("work"))).toBe(false);
});

test("neither logout nor delete will touch the default slot", async () => {
  saveTelegramSession(PLACEHOLDER_SESSION);
  const { service } = harness();
  await expect(service.logoutAccount("default")).rejects.toThrow();
  await expect(service.deleteAccount("default")).rejects.toThrow();
  expect(readTelegramSession()?.sessionString).toBe(PLACEHOLDER_SESSION);
});
