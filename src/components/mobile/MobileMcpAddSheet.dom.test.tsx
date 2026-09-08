import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { translate } from "@/lib/i18n";

/*
 * Adding an MCP server from the phone, and taking one away.
 *
 * Two promises are under test. First, that what the operator types reaches the
 * route as the body it describes — a command, its arguments one per line, and
 * environment values that leave the page in the POST and nowhere else. Second,
 * that the value fields are password fields: this page is opened in public,
 * and a token standing in plain text on a phone screen is the cheapest leak
 * there is.
 *
 * Removing follows the design rule the rest of the phone follows (README §2
 * rule 9): no confirmation, the tap acts, the receipt answers.
 */

const dom = new Window({ url: "http://localhost/", width: 390, height: 844 });
const G = globalThis as Record<string, unknown>;
const TOKEN = "not-for-the-command-line";

let posts: Array<{ url: string; body: Record<string, unknown> }> = [];
let answer: { ok: boolean; status: number; body: unknown } = { ok: true, status: 200, body: { servers: [], skills: [] } };

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
    if (init?.method === "POST") posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return { ok: answer.ok, status: answer.status, json: async () => answer.body, text: async () => JSON.stringify(answer.body) };
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

const { MobileMcpAddSheet } = await import("./MobileMcpAddSheet");
const { McpGrantSheet } = await import("./MobileMcpScreen");
const { useMcpRegistry } = await import("./mcpModel");
const { receipts } = await import("./MobileReceipt");

let roots: Root[] = [];
let closed = 0;

beforeEach(() => {
  roots = [];
  posts = [];
  closed = 0;
  answer = { ok: true, status: 200, body: { servers: [], skills: [] } };
  dom.document.body.replaceChildren();
  receipts.dismiss();
});
afterEach(async () => { for (const root of roots) flushSync(() => root.unmount()); roots = []; receipts.dismiss(); await settle(); });

function AddHarness() {
  const registry = useMcpRegistry();
  return <MobileMcpAddSheet onClose={() => { closed += 1; }} onSubmit={registry.addServer} />;
}

function RemoveHarness() {
  const registry = useMcpRegistry();
  return (
    <McpGrantSheet
      subject={{ kind: "mcp", item: "cohere" }}
      onClose={() => { closed += 1; }}
      onApply={async () => {}}
      onRemove={() => registry.removeServer("cohere")}
    />
  );
}

async function mount(what: "add" | "remove"): Promise<HTMLElement> {
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(what === "add" ? <AddHarness /> : <RemoveHarness />));
  roots.push(root);
  await settle();
  posts = [];
  return dom.document.body as unknown as HTMLElement;
}

const q = (root: HTMLElement, selector: string) => root.querySelector(selector) as unknown as HTMLElement | null;
const click = (el: HTMLElement | null) => { expect(el).not.toBeNull(); flushSync(() => el!.click()); };

/* A controlled field, typed through its own React props — the suite's usual. */
function type(field: HTMLElement | null, value: string): void {
  expect(field).not.toBeNull();
  (field as unknown as { value: string }).value = value;
  const key = Object.keys(field!).find((name) => name.startsWith("__reactProps$"))!;
  const props = (field as unknown as Record<string, { onChange?(event: unknown): void }>)[key]!;
  /* A value field is uncontrolled by design — React never holds a token — so
     setting the node is the whole edit and there is no onChange to fire. */
  if (props.onChange) flushSync(() => props.onChange!({ target: field }));
}

test("a stdio server leaves the phone as the body the route documents", async () => {
  const root = await mount("add");
  type(q(root, '[data-mcp-field="name"]'), "cohere");
  type(q(root, '[data-mcp-field="command"]'), "/opt/venv/bin/cohere-mcp");
  type(q(root, '[data-mcp-field="args"]'), "--stdio\nserve,now\n");
  type(q(root, '[data-mcp-field="cwd"]'), "/opt/venv");
  type(q(root, '[data-mcp-env-key="0"]'), "COHERE_API_KEY");
  type(q(root, '[data-mcp-env-value="0"]'), TOKEN);
  click(q(root, "[data-mcp-replace]"));
  click(q(root, "[data-mcp-submit]"));
  await settle();

  expect(posts).toHaveLength(1);
  expect(posts[0]!.url).toBe("/api/mcp-registry");
  expect(posts[0]!.body).toEqual({
    action: "add", name: "cohere", type: "stdio",
    command: "/opt/venv/bin/cohere-mcp",
    args: ["--stdio", "serve,now"],
    cwd: "/opt/venv",
    env: { COHERE_API_KEY: TOKEN },
    replace: true,
  });
  expect(closed).toBe(1);
  expect(receipts.getState()?.text).toBe(translate("en", "mcp.added", { name: "cohere" }));
});

test("value fields are password fields, and the key beside them is not", async () => {
  const root = await mount("add");
  click(q(root, '[data-mcp-type="http"]'));
  const envValue = q(root, '[data-mcp-env-value="0"]');
  const headerValue = q(root, '[data-mcp-header-value="0"]');
  expect(envValue ?? headerValue).not.toBeNull();
  for (const field of [envValue, headerValue]) {
    if (field) expect(field.getAttribute("type")).toBe("password");
  }
  expect(q(root, '[data-mcp-header-key="0"]')!.getAttribute("type")).not.toBe("password");
});

test("an http server asks for a url and headers, never for a command", async () => {
  const root = await mount("add");
  click(q(root, '[data-mcp-type="http"]'));
  expect(q(root, '[data-mcp-field="command"]')).toBeNull();
  expect(q(root, '[data-mcp-field="args"]')).toBeNull();
  type(q(root, '[data-mcp-field="name"]'), "obsidian");
  type(q(root, '[data-mcp-field="url"]'), "https://127.0.0.1:27124/mcp/");
  type(q(root, '[data-mcp-header-key="0"]'), "Authorization");
  type(q(root, '[data-mcp-header-value="0"]'), `Bearer ${TOKEN}`);
  click(q(root, "[data-mcp-submit]"));
  await settle();
  expect(posts[0]!.body).toEqual({
    action: "add", name: "obsidian", type: "http",
    url: "https://127.0.0.1:27124/mcp/",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
});

test("«+ row» grows the pair list rather than capping it at one", async () => {
  const root = await mount("add");
  expect(q(root, '[data-mcp-env-key="1"]')).toBeNull();
  click(q(root, "[data-mcp-add-env]"));
  expect(q(root, '[data-mcp-env-key="1"]')).not.toBeNull();
});

test("a refusal from the console stands on the form, and nothing is closed", async () => {
  answer = { ok: false, status: 400, body: { error: "MCP cohere уже є; додай replace=true щоб замінити", code: "name" } };
  const root = await mount("add");
  type(q(root, '[data-mcp-field="name"]'), "cohere");
  type(q(root, '[data-mcp-field="command"]'), "x");
  click(q(root, "[data-mcp-submit]"));
  await settle();
  expect(closed).toBe(0);
  expect(q(root, "[data-mcp-failure]")!.textContent).toContain("replace=true");
  expect(receipts.getState()).toBeNull();
});

test("removing a server acts on the tap that names it, and answers with a receipt", async () => {
  const root = await mount("remove");
  const remove = q(root, '[data-mcp-remove="cohere"]')!;
  expect(remove).not.toBeNull();
  expect(remove.textContent).toContain(translate("en", "mcp.removeServer"));
  /* Danger tone and a 44 px target — it is the one destructive control here. */
  expect(remove.className).toContain("text-danger");
  expect(remove.className).toContain("min-h-11");
  click(remove);
  await settle();
  expect(posts).toEqual([{ url: "/api/mcp-registry", body: { action: "remove", name: "cohere" } }]);
  expect(closed).toBe(1);
  expect(receipts.getState()?.text).toBe(translate("en", "mcp.removed", { name: "cohere" }));
});
