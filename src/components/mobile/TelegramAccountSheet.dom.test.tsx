import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { translate } from "@/lib/i18n";

/*
 * Connecting a Telegram account from the phone, by number.
 *
 * The operator works from an iPhone: a QR code drawn on that screen has
 * nothing to scan it with, so the sheet asks for a number, then the code
 * Telegram sends to the device, then the 2FA password if there is one. What is
 * under test is the shape of what leaves the sheet — one POST per step, the
 * code and the password carried nowhere else — and that each refusal arrives
 * in the operator's own language rather than as a status code.
 *
 * The number is the reserved all-zero range; the password is not a password.
 */

const dom = new Window({ url: "http://localhost/", width: 390, height: 844 });
const G = globalThis as Record<string, unknown>;
const PHONE = "+10000000000";

type Post = { url: string; body: Record<string, unknown> };
let posts: Post[] = [];
/** What the route answers, one queued reply per POST. */
let replies: Array<{ ok: boolean; status: number; body: unknown }> = [];

const OVERRIDES: Record<string, unknown> = {
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  Node: dom.Node,
  HTMLElement: dom.HTMLElement,
  HTMLButtonElement: dom.HTMLButtonElement,
  Event: dom.Event,
  KeyboardEvent: dom.KeyboardEvent,
  MouseEvent: dom.MouseEvent,
  PointerEvent: dom.PointerEvent,
  sessionStorage: dom.sessionStorage,
  localStorage: dom.localStorage,
  matchMedia: (query: string) => ({ matches: true, media: String(query), onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } }),
  requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } },
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      const reply = replies.shift() ?? { ok: true, status: 200, body: { accounts: [], logins: [] } };
      return { ok: reply.ok, status: reply.status, json: async () => reply.body };
    }
    return { ok: true, status: 200, json: async () => ({ telegram: null, accounts: [], logins: [] }) };
  }) as unknown as typeof fetch,
};
const HAS: Record<string, boolean> = {};
const SAVED: Record<string, unknown> = {};
const settle = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

beforeAll(() => {
  for (const key of Object.keys(OVERRIDES)) { HAS[key] = key in G; SAVED[key] = G[key]; G[key] = OVERRIDES[key]; }
});
afterAll(async () => {
  await settle();
  for (const key of Object.keys(OVERRIDES)) { if (HAS[key]) G[key] = SAVED[key]; else delete G[key]; }
});

const { TelegramAccountSheet } = await import("./TelegramAccountSheet");
const { receipts } = await import("./MobileReceipt");

let roots: Root[] = [];
let closed = 0;
let connected = 0;

beforeEach(() => {
  roots = [];
  posts = [];
  replies = [];
  closed = 0;
  connected = 0;
  dom.document.body.replaceChildren();
  receipts.dismiss();
});
afterEach(async () => { for (const root of roots) flushSync(() => root.unmount()); roots = []; receipts.dismiss(); await settle(); });

async function mount(): Promise<HTMLElement> {
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(
    <TelegramAccountSheet onClose={() => { closed += 1; }} onConnected={() => { connected += 1; }} />,
  ));
  roots.push(root);
  await settle();
  posts = [];
  return dom.document.body as unknown as HTMLElement;
}

const q = <T extends Element>(root: HTMLElement, selector: string): T | null =>
  root.querySelector(selector) as unknown as T | null;

function props(field: HTMLElement): Record<string, unknown> | undefined {
  const key = Object.keys(field).find((name) => name.startsWith("__reactProps$"));
  return key ? (field as unknown as Record<string, Record<string, unknown>>)[key] : undefined;
}

/* A controlled field is typed through its own React props, the way the other
   phone sheets are tested here. The password field is uncontrolled by design,
   so setting the node IS the edit. */
function type(root: HTMLElement, selector: string, value: string) {
  const field = q<HTMLElement>(root, selector);
  expect(field).not.toBeNull();
  (field as unknown as { value: string }).value = value;
  const onChange = props(field!)?.onChange as ((event: unknown) => void) | undefined;
  if (onChange) flushSync(() => onChange({ target: field }));
}

function press(root: HTMLElement, selector: string) {
  const button = q<HTMLElement>(root, selector);
  expect(button).not.toBeNull();
  flushSync(() => { (button as unknown as { click(): void }).click(); });
}

const login = (over: Record<string, unknown> = {}) => ({
  operationId: "op-1", slug: "u10000000000", phase: "awaiting_code",
  codeError: false, passwordError: false, error: null, identity: null, ...over,
});

test("the number suggests an identifier, and the identifier stays editable", async () => {
  const root = await mount();
  type(root, "[data-tg-phone]", PHONE);
  expect(q<HTMLInputElement>(root, "[data-tg-slug]")!.value).toBe("u10000000000");

  type(root, "[data-tg-slug]", "work");
  type(root, "[data-tg-phone]", "+10000000001");
  /* Once she has named it herself, the suggestion stops overwriting her. */
  expect(q<HTMLInputElement>(root, "[data-tg-slug]")!.value).toBe("work");
});

test("number, code, connected: one POST per step and a receipt at the end", async () => {
  const root = await mount();
  type(root, "[data-tg-phone]", PHONE);
  type(root, "[data-tg-slug]", "work");

  replies.push({ ok: true, status: 202, body: { accounts: [], logins: [login({ slug: "work" })] } });
  press(root, "[data-tg-send]");
  await settle();

  expect(posts).toHaveLength(1);
  expect(posts[0].url).toBe("/api/telegram");
  expect(posts[0].body).toEqual({ action: "start_phone", slug: "work", phone: PHONE });

  const code = q<HTMLInputElement>(root, "[data-tg-code]")!;
  expect(code.getAttribute("inputmode")).toBe("numeric");
  expect(code.getAttribute("autocomplete")).toBe("one-time-code");

  replies.push({
    ok: true, status: 200,
    body: { accounts: [], logins: [login({ slug: "work", phase: "connected", identity: { name: "Example", username: "example_handle" } })] },
  });
  type(root, "[data-tg-code]", "12345");
  press(root, "[data-tg-submit-code]");
  await settle();

  expect(posts[1].body).toEqual({ action: "code", operationId: "op-1", code: "12345" });
  expect(receipts.getState()?.text).toBe(translate("en", "telegram.connected", { who: "@example_handle" }));
  expect(connected).toBe(1);
  expect(closed).toBe(1);
});

test("a wrong code says so and keeps the code step", async () => {
  const root = await mount();
  type(root, "[data-tg-phone]", PHONE);
  replies.push({ ok: true, status: 202, body: { accounts: [], logins: [login()] } });
  press(root, "[data-tg-send]");
  await settle();

  replies.push({ ok: true, status: 200, body: { accounts: [], logins: [login({ codeError: true })] } });
  type(root, "[data-tg-code]", "11111");
  press(root, "[data-tg-submit-code]");
  await settle();

  expect(q(root, "[data-tg-failure]")!.textContent).toContain(translate("en", "telegram.codeInvalid"));
  expect(q(root, "[data-tg-code]")).not.toBeNull();
  expect(closed).toBe(0);
});

test("a flood wait says how long, in seconds", async () => {
  const root = await mount();
  type(root, "[data-tg-phone]", PHONE);
  replies.push({
    ok: true, status: 202,
    body: { accounts: [], logins: [login({ phase: "failed", error: { code: "flood_wait", seconds: 86 } })] },
  });
  press(root, "[data-tg-send]");
  await settle();

  expect(q(root, "[data-tg-failure]")!.textContent).toBe(translate("en", "telegram.floodWait", { seconds: 86 }));
  expect(q(root, "[data-tg-code]")).toBeNull();
});

test("two-step verification asks for the password and sends it once", async () => {
  const root = await mount();
  type(root, "[data-tg-phone]", PHONE);
  replies.push({ ok: true, status: 202, body: { accounts: [], logins: [login()] } });
  press(root, "[data-tg-send]");
  await settle();

  replies.push({ ok: true, status: 200, body: { accounts: [], logins: [login({ phase: "awaiting_password" })] } });
  type(root, "[data-tg-code]", "12345");
  press(root, "[data-tg-submit-code]");
  await settle();

  const field = q<HTMLInputElement>(root, "[data-tg-password]")!;
  expect(field.getAttribute("type")).toBe("password");
  /* Uncontrolled: nothing in React ever holds it, so it is set on the node. */
  field.value = "fixture-2fa";

  replies.push({
    ok: true, status: 200,
    body: { accounts: [], logins: [login({ phase: "connected", identity: { name: "Example", username: null } })] },
  });
  press(root, "[data-tg-submit-password]");
  await settle();

  const sent = posts[posts.length - 1];
  expect(sent.body).toEqual({ action: "password", slug: "u10000000000", operationId: "op-1", password: "fixture-2fa" });
  /* No identity handle: the receipt falls back to the name it does have. */
  expect(receipts.getState()?.text).toBe(translate("en", "telegram.connected", { who: "Example" }));
});

test("a refusal from the route arrives in its own words", async () => {
  const root = await mount();
  type(root, "[data-tg-phone]", PHONE);
  replies.push({ ok: false, status: 409, body: { error: "a Telegram login operation is already running", code: "login_busy" } });
  press(root, "[data-tg-send]");
  await settle();

  expect(q(root, "[data-tg-failure]")!.textContent).toContain(translate("en", "telegram.err.login_busy"));
  expect(q(root, "[data-tg-code]")).toBeNull();
});

test("nothing is sent until both the number and the identifier are there", async () => {
  const root = await mount();
  press(root, "[data-tg-send]");
  await settle();
  expect(posts).toEqual([]);
  expect(q<HTMLButtonElement>(root, "[data-tg-send]")!.disabled).toBe(true);
});
