import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import { translate } from "@/lib/i18n";

/*
 * The Secrets screen's one write affordance: «+ Секрет».
 *
 * It has to be there when the vault is EMPTY. That is the state a fresh
 * machine starts in, and it is the only state in which the button is the
 * whole point of the page — a list with nothing in it and no way to put
 * anything in it is a dead end. The button used to hang off the key count,
 * so exactly the operator who needed it could not see it.
 */

const dom = new Window({ url: "http://localhost/", width: 390, height: 844 });
const G = globalThis as Record<string, unknown>;

let inventory: unknown = { generatedAt: null, secrets: [], accounts: [], clis: [] };

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
  fetch: (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.includes("/api/firms") ? { firms: [] } : url.includes("/api/projects") ? { projects: [] } : inventory;
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch,
};
const HAS: Record<string, boolean> = {};
const SAVED: Record<string, unknown> = {};
const settle = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

beforeAll(() => { for (const key of Object.keys(OVERRIDES)) { HAS[key] = key in G; SAVED[key] = G[key]; G[key] = OVERRIDES[key]; } });
afterAll(async () => {
  await settle();
  for (const key of Object.keys(OVERRIDES)) { if (HAS[key]) G[key] = SAVED[key]; else delete G[key]; }
});

const { MobileSecretsScreen } = await import("./MobileSecretsScreen");

let roots: Root[] = [];
beforeEach(() => {
  roots = [];
  inventory = { generatedAt: null, secrets: [], accounts: [], clis: [] };
  dom.document.body.replaceChildren();
});
afterEach(async () => { for (const root of roots) flushSync(() => root.unmount()); roots = []; await settle(); });

async function mount(): Promise<HTMLElement> {
  const container = dom.document.createElement("div");
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  flushSync(() => root.render(<MobileSecretsScreen host={null} />));
  roots.push(root);
  await settle();
  return dom.document.body as unknown as HTMLElement;
}

const q = (root: HTMLElement, selector: string) => root.querySelector(selector) as unknown as HTMLElement | null;

test("an empty vault still offers the one thing that can fix it", async () => {
  const root = await mount();
  expect(q(root, '[data-mobile2-secrets-empty="none"]')).not.toBeNull();
  const add = q(root, "[data-secret-add-open]");
  expect(add).not.toBeNull();
  expect(add!.textContent).toBe(translate("en", "secrets.add"));
  /* A phone target, like every other control on this page. */
  expect(add!.className).toContain("min-h-11");
});

test("the button opens the add sheet, from the empty state too", async () => {
  const root = await mount();
  flushSync(() => q(root, "[data-secret-add-open]")!.click());
  await settle();
  expect(q(root, '[data-mobile2-sheet="secretAdd"]')).not.toBeNull();
});

test("a vault with keys keeps the button beside the section it heads", async () => {
  inventory = {
    generatedAt: null,
    secrets: [{ name: "cohere_mcp", provider: "cohere", state: "unchecked" }],
    accounts: [], clis: [],
  };
  const root = await mount();
  expect(q(root, '[data-mobile2-secrets-group="cohere"]')).not.toBeNull();
  expect(q(root, "[data-secret-add-open]")).not.toBeNull();
});
