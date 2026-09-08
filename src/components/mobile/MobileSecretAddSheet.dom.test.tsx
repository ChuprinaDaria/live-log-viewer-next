import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { translate } from "@/lib/i18n";

/*
 * Adding a secret from the phone.
 *
 * Two promises are under test. First, that what the operator types reaches the
 * route as the body it documents — the address half as ordinary fields, the
 * value exactly once, in the POST and nowhere else. Second, that the value
 * field is a password field that React never holds: the value stays in the DOM
 * node until submit reads it once, so no render, no state tree and no re-open
 * of the sheet can produce it again.
 *
 * The fixture value is deliberately not key-shaped — a test file is public.
 */

const dom = new Window({ url: "http://localhost/", width: 390, height: 844 });
const G = globalThis as Record<string, unknown>;
const VALUE = "example-value-1";

let posts: Array<{ url: string; body: Record<string, unknown> }> = [];
let answer: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: { secret: { name: "cohere_mcp" } } };

const FIRMS = { firms: [{ id: "bluebird", name: "Bluebird", projects: ["money"], people: [], grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
const PROJECTS = { projects: [{ id: "money", name: "Money", firm: "bluebird", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };

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
      return { ok: answer.ok, status: answer.status, json: async () => answer.body };
    }
    const body = url.includes("/api/firms") ? FIRMS : url.includes("/api/projects") ? PROJECTS : { secrets: [], accounts: [], clis: [], generatedAt: null };
    return { ok: true, status: 200, json: async () => body };
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

const { MobileSecretAddSheet } = await import("./MobileSecretAddSheet");
const { addSecret } = await import("./secretsModel");
const { receipts } = await import("./MobileReceipt");

let roots: Root[] = [];
let closed = 0;

beforeEach(() => {
  roots = [];
  posts = [];
  closed = 0;
  answer = { ok: true, status: 200, body: { secret: { name: "cohere_mcp" } } };
  dom.document.body.replaceChildren();
  receipts.dismiss();
});
afterEach(async () => { for (const root of roots) flushSync(() => root.unmount()); roots = []; receipts.dismiss(); await settle(); });

async function mount(): Promise<HTMLElement> {
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(
    <MobileSecretAddSheet providers={["cohere", "openai"]} onClose={() => { closed += 1; }} onSubmit={addSecret} />,
  ));
  roots.push(root);
  await settle();
  posts = [];
  return dom.document.body as unknown as HTMLElement;
}

const q = (root: HTMLElement, selector: string) => root.querySelector(selector) as unknown as HTMLElement | null;
const click = (el: HTMLElement | null) => { expect(el).not.toBeNull(); flushSync(() => el!.click()); };

function props(field: HTMLElement): Record<string, unknown> | undefined {
  const key = Object.keys(field).find((name) => name.startsWith("__reactProps$"));
  return key ? (field as unknown as Record<string, Record<string, unknown>>)[key] : undefined;
}

/* A controlled field is typed through its own React props. Two exceptions:
   the value field is uncontrolled by design — React never holds it, so setting
   the node is the whole edit — and a <select>, which React does not decorate
   with props, so it is driven by the change event React actually listens for. */
function type(field: HTMLElement | null, value: string): void {
  expect(field).not.toBeNull();
  (field as unknown as { value: string }).value = value;
  const onChange = props(field!)?.onChange as ((event: unknown) => void) | undefined;
  if (onChange) { flushSync(() => onChange({ target: field })); return; }
  if (field!.tagName === "SELECT") {
    flushSync(() => { field!.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event); });
  }
}

test("the form leaves the phone as the body the route documents, value included once", async () => {
  const root = await mount();
  type(q(root, '[data-secret-field="label"]'), "Cohere · RAG");
  type(q(root, '[data-secret-field="provider"]'), "cohere");
  type(q(root, '[data-secret-field="purpose"]'), "ембединги");
  type(q(root, "[data-secret-value]"), VALUE);
  click(q(root, "[data-secret-submit]"));
  await settle();

  expect(posts).toHaveLength(1);
  expect(posts[0]!.url).toBe("/api/secrets");
  expect(posts[0]!.body).toEqual({
    action: "add",
    secret: "cohere_rag",
    value: VALUE,
    provider: "cohere",
    label: "Cohere · RAG",
    purpose: "ембединги",
    envName: "COHERE_RAG",
  });
  /* Exactly once: a value duplicated into a second field is a value in a
     second place to forget about. */
  expect(JSON.stringify(posts[0]!.body).split(VALUE).length - 1).toBe(1);
  expect(closed).toBe(1);
  expect(receipts.getState()?.text).toBe(translate("en", "secrets.added", { name: "cohere_rag" }));
});

test("the value field is a password field that React does not hold", async () => {
  const root = await mount();
  const field = q(root, "[data-secret-value]")!;
  expect(field).not.toBeNull();
  expect(field.getAttribute("type")).toBe("password");
  expect(field.getAttribute("autocomplete")).toBe("off");
  /* Uncontrolled: no `value` prop and no `onChange`, so nothing in the React
     tree ever sees what was typed. */
  expect(props(field)!.value).toBeUndefined();
  expect(props(field)!.onChange).toBeUndefined();
  /* The identifier beside it is an ordinary field, so this is a choice about
     the value and not about every input on the form. */
  expect(q(root, '[data-secret-field="id"]')!.getAttribute("type")).not.toBe("password");
});

test("the identifier and the variable name are derived, and both stay editable", async () => {
  const root = await mount();
  type(q(root, '[data-secret-field="label"]'), "Telegram Bot");
  expect((q(root, '[data-secret-field="id"]') as unknown as { value: string }).value).toBe("telegram_bot");
  expect((q(root, '[data-secret-field="envName"]') as unknown as { value: string }).value).toBe("TELEGRAM_BOT");

  type(q(root, '[data-secret-field="id"]'), "tg_session");
  expect((q(root, '[data-secret-field="envName"]') as unknown as { value: string }).value).toBe("TG_SESSION");
  type(q(root, '[data-secret-field="envName"]'), "TELEGRAM_SESSION");
  /* Once she has said what the variable is called, the slug stops renaming it. */
  type(q(root, '[data-secret-field="id"]'), "tg_session_2");
  expect((q(root, '[data-secret-field="envName"]') as unknown as { value: string }).value).toBe("TELEGRAM_SESSION");
});

test("a scope of firm or project comes from the org tree, and none is the default", async () => {
  const root = await mount();
  expect(q(root, "[data-secret-scope-target]")).toBeNull();
  click(q(root, '[data-secret-scope="project"]'));
  type(q(root, "[data-secret-scope-target]"), "money");
  type(q(root, '[data-secret-field="provider"]'), "cohere");
  type(q(root, '[data-secret-field="id"]'), "cohere_mcp");
  type(q(root, "[data-secret-value]"), VALUE);
  click(q(root, "[data-secret-submit]"));
  await settle();
  /* The firm travels with the project: the console refuses a project bound to
     a different firm, so the page sends the one the tree already knows. */
  expect(posts[0]!.body.project).toBe("money");
  expect(posts[0]!.body.firm).toBe("bluebird");
});

test("a refusal stands on the form, the sheet stays, and the value field is emptied", async () => {
  answer = { ok: false, status: 400, body: { error: "фірми bluebird немає — спершу firm_create" } };
  const root = await mount();
  type(q(root, '[data-secret-field="id"]'), "cohere_mcp");
  type(q(root, '[data-secret-field="provider"]'), "cohere");
  type(q(root, "[data-secret-value]"), VALUE);
  click(q(root, "[data-secret-submit]"));
  await settle();

  expect(closed).toBe(0);
  expect(q(root, "[data-secret-failure]")!.textContent).toContain("firm_create");
  /* Retyping it is cheaper than wondering whether the field still holds it. */
  expect((q(root, "[data-secret-value]") as unknown as { value: string }).value).toBe("");
  expect(receipts.getState()).toBeNull();
});

test("submit stays disabled until there is an id, a provider and a value", async () => {
  const root = await mount();
  const submit = q(root, "[data-secret-submit]")!;
  expect(submit.hasAttribute("disabled")).toBe(true);
  type(q(root, '[data-secret-field="id"]'), "cohere_mcp");
  type(q(root, '[data-secret-field="provider"]'), "cohere");
  /* The value lives outside React, so the button cannot watch it: it enables
     on the address half and the route refuses an empty value by name. */
  expect(q(root, "[data-secret-submit]")!.hasAttribute("disabled")).toBe(false);
  expect(posts).toEqual([]);
});

test("a duplicate is answered in the page's own words, not with a CLI flag", async () => {
  /* The console says «додайте --replace». The operator is holding a phone and
     has a checkbox two rows up; quoting a command-line flag at her is the form
     failing to answer its own question. */
  answer = { ok: false, status: 400, body: { error: "секрет cohere_mcp уже є — додайте --replace, щоб перезаписати", code: "secret_exists" } };
  const root = await mount();
  type(q(root, '[data-secret-field="id"]'), "cohere_mcp");
  type(q(root, '[data-secret-field="provider"]'), "cohere");
  type(q(root, "[data-secret-value]"), VALUE);
  click(q(root, "[data-secret-submit]"));
  await settle();
  expect(q(root, "[data-secret-failure]")!.textContent).toBe(translate("en", "secrets.exists"));
  expect(closed).toBe(0);
});

test("«Перезаписати наявний» is what fixes a typo from the phone", async () => {
  const root = await mount();
  type(q(root, '[data-secret-field="id"]'), "cohere_mcp");
  type(q(root, '[data-secret-field="provider"]'), "cohere");
  type(q(root, "[data-secret-value]"), VALUE);
  const replace = q(root, "[data-secret-replace]")!;
  expect(replace).not.toBeNull();
  expect(replace.getAttribute("aria-checked")).toBe("false");
  click(replace);
  expect(q(root, "[data-secret-replace]")!.getAttribute("aria-checked")).toBe("true");
  click(q(root, "[data-secret-submit]"));
  await settle();
  expect(posts[0]!.body.replace).toBe(true);
});

test("replace is absent, not false, when it was not asked for", async () => {
  const root = await mount();
  type(q(root, '[data-secret-field="id"]'), "cohere_mcp");
  type(q(root, '[data-secret-field="provider"]'), "cohere");
  type(q(root, "[data-secret-value]"), VALUE);
  click(q(root, "[data-secret-submit]"));
  await settle();
  expect("replace" in posts[0]!.body).toBe(false);
});

test("a slug that starts with a digit still derives a legal variable name", async () => {
  /* `2FA_TOKEN` is not an environment variable name, and the console refuses
     it. The form must not hand her a name that cannot work — and it must SHOW
     what it did, because the derived name is what ends up in the ref. */
  const root = await mount();
  type(q(root, '[data-secret-field="id"]'), "2fa_token");
  const derived = (q(root, '[data-secret-field="envName"]') as unknown as { value: string }).value;
  expect(derived).toBe("K_2FA_TOKEN");
  expect(/^[A-Z][A-Z0-9_]*$/.test(derived)).toBe(true);
  type(q(root, '[data-secret-field="provider"]'), "test");
  type(q(root, "[data-secret-value]"), VALUE);
  click(q(root, "[data-secret-submit]"));
  await settle();
  expect(posts[0]!.body.envName).toBe("K_2FA_TOKEN");
});
