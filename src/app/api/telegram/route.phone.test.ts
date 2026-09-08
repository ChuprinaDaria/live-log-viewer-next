import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "llv-telegram-phone-route-"));
const OLD_STATE = process.env.LLV_STATE_DIR;
process.env.LLV_STATE_DIR = path.join(SANDBOX, "state");

/*
 * The two new doors on /api/telegram, and what may leave through them.
 *
 * The console is mocked, not installed, so the one assertion that matters most
 * can be made directly: when a phone login finishes, the session string is
 * handed to `secret_add` over STDIN and appears nowhere else — not in the
 * flags, not in the response body, not in the account listing. argv is public
 * to every process on this machine; a session string in it is a session string
 * anyone can read with `ps`.
 *
 * The number below is the reserved all-zero range, and the session strings are
 * placeholders with the right shape and no authorization behind them.
 */

type FleetctlCall = {
  fn: string;
  params?: Record<string, unknown>;
  stdinParam?: string;
  stdinValue?: string;
};

let fleetctlCalls: FleetctlCall[] = [];
let consoleInstalled = true;
let fleetctlThrows: Error | null = null;

mock.module("@/lib/fleetctl/client", () => ({
  fleetctlInstalled: () => consoleInstalled,
  fleetctl: async (call: FleetctlCall) => {
    fleetctlCalls.push(call);
    if (fleetctlThrows) throw fleetctlThrows;
    return {};
  },
  fleetctlMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  fleetctlStatus: () => 400,
  FLEETCTL_DIR: "/nowhere",
  FLEETCTL_ACTOR: "fleet-dashboard",
}));

const { GET, POST } = await import("./route");
const { TelegramConnectionService, registerAccountSecret, setTelegramServiceForTests } = await import("@/lib/telegram/service");
const { readTelegramAccountSession } = await import("@/lib/telegram/sessionStore");

import type { TelegramAdapter, TelegramEnrollmentEvent, TelegramEnrollmentHandle, TelegramPhoneEnrollmentHandle, TelegramPhoneStart } from "@/lib/telegram/adapter";

const PHONE = "+10000000000";
const SLOT_SESSION = "1BvWapzMBu4placeholder-not-a-real-session";
/** The console record a "work" account is registered as. */
const RECORD = "telegram_session_work";

class FakeAdapter implements TelegramAdapter {
  starts: TelegramPhoneStart[] = [];
  emit: ((event: TelegramEnrollmentEvent) => void) | null = null;
  codes: string[] = [];
  passwords: string[] = [];
  canceled = 0;
  unavailableReason() { return null; }
  startEnrollment(): TelegramEnrollmentHandle { throw new Error("the QR flow is not under test here"); }
  checkSession() { return Promise.resolve({ status: "expired" } as const); }
  logout() { return Promise.resolve({ ok: true, code: null }); }
  startPhoneEnrollment(input: TelegramPhoneStart, onEvent: (event: TelegramEnrollmentEvent) => void): TelegramPhoneEnrollmentHandle {
    this.starts.push(input);
    this.emit = onEvent;
    return {
      submitCode: (code) => { this.codes.push(code); },
      submitPassword: (password) => { this.passwords.push(password); },
      cancel: () => { this.canceled += 1; },
    };
  }
}

let adapter = new FakeAdapter();

function installService() {
  adapter = new FakeAdapter();
  setTelegramServiceForTests(new TelegramConnectionService({
    adapter,
    ensureConnector: async () => ({ ok: true, url: "http://127.0.0.1:8809/mcp" }),
    readConnectorIdentity: async () => null,
    stopConnector: () => {},
    registerHosts: () => ({ ok: true, claude: { registered: 0, conflict: 0, unwritable: 0 }, codex: { registered: 0, failed: 0 } }),
    unregisterHosts: () => {},
    now: () => Date.parse("2026-08-20T12:00:00.000Z"),
    credentialsConfigured: () => true,
    /* The real registration path, so the console call under test is the one
       production makes rather than a stand-in for it. */
    registerAccountSecret,
  }));
}

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://127.0.0.1/api/telegram", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(): NextRequest {
  return new NextRequest("http://127.0.0.1/api/telegram", { headers: { host: "127.0.0.1" } });
}

async function payload(response: Response): Promise<Record<string, never>> {
  return await response.json() as Record<string, never>;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fs.rmSync(process.env.LLV_STATE_DIR!, { recursive: true, force: true });
  fleetctlCalls = [];
  fleetctlThrows = null;
  consoleInstalled = true;
  installService();
});
afterAll(() => {
  setTelegramServiceForTests(null);
  if (OLD_STATE === undefined) delete process.env.LLV_STATE_DIR;
  else process.env.LLV_STATE_DIR = OLD_STATE;
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

/** number → code → connected, through the route, exactly as the sheet does it. */
async function connectThroughRoute(slug = "work"): Promise<string> {
  const started = await POST(postRequest({ action: "start_phone", slug, phone: PHONE }));
  const body = await payload(started) as unknown as { logins: Array<{ operationId: string }> };
  const operationId = body.logins[0].operationId;
  adapter.emit!({ type: "code_required" });
  await settle();
  await POST(postRequest({ action: "code", operationId, code: "12345" }));
  adapter.emit!({ type: "authorized", sessionString: SLOT_SESSION, identity: { name: "Example", username: "example_handle", id: "770000002" } });
  await settle();
  return operationId;
}

test("start_phone answers 202 with a live login and passes the number to the bridge", async () => {
  const response = await POST(postRequest({ action: "start_phone", slug: "work", phone: PHONE }));
  expect(response.status).toBe(202);
  const body = await payload(response) as unknown as { logins: Array<{ slug: string; phase: string }> };
  expect(body.logins[0]).toMatchObject({ slug: "work", phase: "starting" });
  expect(adapter.starts).toEqual([{ phone: PHONE, apiId: undefined, apiHash: undefined }]);
});

test("the session string reaches the console over stdin and nowhere else", async () => {
  await connectThroughRoute();

  const add = fleetctlCalls.find((call) => call.fn === "secret_add");
  expect(add).toBeDefined();
  expect(add!.stdinParam).toBe("value");
  expect(add!.stdinValue).toBe(SLOT_SESSION);
  /* Not in a flag — argv is readable by every process on this machine. */
  expect(JSON.stringify(add!.params)).not.toContain(SLOT_SESSION);
  expect(add!.params).toMatchObject({
    secret: RECORD,
    provider: "telegram",
    kind: "session",
    envName: "TELEGRAM_SESSION_WORK",
    owner: "dashboard",
    replace: true,
  });
  /* The label is what `channel_accounts` reads to tell a user session from a
     bot token, so the word «сесія» is load-bearing. */
  expect(String(add!.params!.label)).toContain("сесія");
  expect(String(add!.params!.label)).toContain("@example_handle");
});

test("no response body ever carries the session string", async () => {
  await connectThroughRoute();

  const listed = await GET(getRequest());
  const body = JSON.stringify(await payload(listed));
  expect(body).not.toContain(SLOT_SESSION);
  expect(readTelegramAccountSession("work")?.sessionString).toBe(SLOT_SESSION);
});

test("GET lists the connected account with its number and vault record", async () => {
  await connectThroughRoute();

  const listed = await GET(getRequest());
  const body = await payload(listed) as unknown as {
    telegram: { phase: string };
    accounts: Array<{ slug: string; phone: string; username: string; vaultId: string }>;
  };
  expect(body.telegram.phase).toBe("disconnected");
  expect(body.accounts).toHaveLength(1);
  expect(body.accounts[0]).toMatchObject({
    slug: "work", phone: PHONE, username: "example_handle", vaultId: "telegram_session_work",
  });
});

test("a console that refuses keeps the account and reports its words", async () => {
  fleetctlThrows = new Error("невідомий вид секрету");
  await connectThroughRoute();

  const body = await payload(await GET(getRequest())) as unknown as {
    accounts: Array<{ vaultId: string | null; vaultReason: string | null }>;
  };
  expect(body.accounts[0].vaultId).toBeNull();
  expect(body.accounts[0].vaultReason).toBe("невідомий вид секрету");
  expect(readTelegramAccountSession("work")?.sessionString).toBe(SLOT_SESSION);
});

test("no console at all is still an honest account, not a lost login", async () => {
  consoleInstalled = false;
  await connectThroughRoute();

  const body = await payload(await GET(getRequest())) as unknown as {
    accounts: Array<{ vaultId: string | null; vaultReason: string | null }>;
  };
  expect(fleetctlCalls).toEqual([]);
  expect(body.accounts[0].vaultReason).toBe("console_missing");
  expect(readTelegramAccountSession("work")?.sessionString).toBe(SLOT_SESSION);
});

test("the code action forwards the digits and refuses anything else", async () => {
  const started = await POST(postRequest({ action: "start_phone", slug: "work", phone: PHONE }));
  const body = await payload(started) as unknown as { logins: Array<{ operationId: string }> };
  const operationId = body.logins[0].operationId;
  adapter.emit!({ type: "code_required" });
  await settle();

  expect((await POST(postRequest({ action: "code", operationId, code: "abcd" }))).status).toBe(400);
  expect((await POST(postRequest({ action: "code", operationId }))).status).toBe(400);
  expect((await POST(postRequest({ action: "code", operationId: "nope", code: "12345" }))).status).toBe(404);
  expect((await POST(postRequest({ action: "code", operationId, code: "12345" }))).status).toBe(200);
  expect(adapter.codes).toEqual(["12345"]);
});

test("a bad slug or a bad number is refused before anything is spawned", async () => {
  for (const body of [
    { action: "start_phone", slug: "default", phone: PHONE },
    { action: "start_phone", slug: "Nope", phone: PHONE },
    { action: "start_phone", slug: "work", phone: "0000" },
    { action: "start_phone", slug: "work" },
  ]) {
    expect((await POST(postRequest(body))).status).toBe(400);
  }
  expect(adapter.starts).toEqual([]);
});

test("a second start for a live slug is refused as busy", async () => {
  await POST(postRequest({ action: "start_phone", slug: "work", phone: PHONE }));
  const again = await POST(postRequest({ action: "start_phone", slug: "work", phone: PHONE }));
  expect(again.status).toBe(409);
  expect((await payload(again) as unknown as { code: string }).code).toBe("login_busy");
});

test("the password action routes to the phone login when a slug names one", async () => {
  const started = await POST(postRequest({ action: "start_phone", slug: "work", phone: PHONE }));
  const body = await payload(started) as unknown as { logins: Array<{ operationId: string }> };
  const operationId = body.logins[0].operationId;
  adapter.emit!({ type: "code_required" });
  await settle();
  await POST(postRequest({ action: "code", operationId, code: "12345" }));
  adapter.emit!({ type: "password_required" });
  await settle();

  const answered = await POST(postRequest({ action: "password", slug: "work", operationId, password: "fixture-2fa" }));
  expect(answered.status).toBe(200);
  expect(adapter.passwords).toEqual(["fixture-2fa"]);
});

test("cancel, logout and delete take the slug and leave the default slot alone", async () => {
  await connectThroughRoute();
  const removed = await POST(postRequest({ action: "logout", slug: "work" }));
  expect(removed.status).toBe(200);
  expect((await payload(removed) as unknown as { accounts: unknown[] }).accounts).toEqual([]);

  await connectThroughRoute("private");
  const deleted = await POST(postRequest({ action: "delete", slug: "private" }));
  expect((await payload(deleted) as unknown as { accounts: unknown[] }).accounts).toEqual([]);

  /* Without a slug these are the default slot's own actions, unchanged. */
  const defaultLogout = await POST(postRequest({ action: "logout" }));
  expect((await payload(defaultLogout) as unknown as { telegram: unknown }).telegram).toBeDefined();
});

test("cross-origin POSTs are refused as they always were", async () => {
  const request = new NextRequest("http://127.0.0.1/api/telegram", {
    method: "POST",
    headers: { host: "127.0.0.1", origin: "http://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ action: "start_phone", slug: "work", phone: PHONE }),
  });
  expect((await POST(request)).status).toBeGreaterThanOrEqual(400);
  expect(adapter.starts).toEqual([]);
});
