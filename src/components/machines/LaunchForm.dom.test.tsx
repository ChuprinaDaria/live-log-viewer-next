import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dom = new Window({ url: "http://localhost/" });
const matchMedia = (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
});
Object.assign(globalThis, {
  window: dom, document: dom.document, navigator: dom.navigator, location: dom.location, history: dom.history,
  localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
  Node: dom.Node, HTMLElement: dom.HTMLElement, Element: dom.Element, Event: dom.Event, CustomEvent: dom.CustomEvent,
  KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  matchMedia,
});
Object.assign(dom, { matchMedia });

let root: Root | null = null;
let container: HTMLElement | null = null;
function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
});

import { setLocale } from "@/lib/i18n";
import { LaunchForm } from "./LaunchForm";

const realFetch = globalThis.fetch;
let lastPostBody: Record<string, unknown> | null = null;

function get(url: string): unknown {
  if (url.startsWith("/api/machines") && url.includes("accounts=1")) {
    return { profiles: ["account-a", "account-b"] };
  }
  if (url.startsWith("/api/machines") && url.includes("sessions=1")) {
    return { sessions: [] };
  }
  if (url.startsWith("/api/machines")) {
    return {
      hosts: [
        { id: "walter", ssh: null, engines: ["claude", "codex"], is_local: true, status: { reachable: true, detail: "" } },
        { id: "ryzen", ssh: "ryzen", engines: ["claude"], status: { reachable: false, detail: "спить" } },
      ],
    };
  }
  if (url.startsWith("/api/firms")) {
    return { firms: [{ id: "noologic", name: "Noologic", projects: ["bot", "money"], people: [], grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
  }
  if (url.startsWith("/api/projects")) {
    return { projects: [
      { id: "bot", name: "bot", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
      { id: "money", name: "money", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
      { id: "eva", name: "eva-repro", firm: "noologic", parent: "bot", grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
    ] };
  }
  return {};
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "POST") {
    lastPostBody = JSON.parse(String(init.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      host: "walter", project: "bot", engine: "claude", tmux: "fc-bot-1", cwd: "/w/bot", attach: "", code: { action: "pulled" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify(get(url)), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
afterEach(() => { globalThis.fetch = realFetch; lastPostBody = null; });

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(times = 3) {
  for (let i = 0; i < times; i += 1) await act(flush);
}

function findButton(el: HTMLElement, text: string, scope?: string): HTMLButtonElement {
  const root = scope ? el.querySelector(scope) : el;
  const found = Array.from(root?.querySelectorAll("button") ?? []).find((b) => b.textContent?.trim() === text);
  if (!found) throw new Error(`button ${JSON.stringify(text)} not found`);
  return found as HTMLButtonElement;
}

test("launch form: firm-grouped projects, machine picker, model default, fresh flag", async () => {
  setLocale("uk");
  const el = mount(<LaunchForm initialProject="money" />);
  await settle();

  /* projects grouped by firm, initialProject preselected */
  const projectSelect = el.querySelector('[aria-label="Проєкт"]') as HTMLSelectElement;
  expect(projectSelect).not.toBeNull();
  expect(projectSelect.value).toBe("money");
  expect(el.querySelector("optgroup")?.getAttribute("label")).toBe("Noologic");

  /* the ryzen button is disabled with title "спить" */
  const machineGroup = '[role="group"][aria-label="Машина"]';
  const ryzenBtn = Array.from(el.querySelectorAll(`${machineGroup} button`))
    .find((b) => b.textContent?.includes("ryzen")) as HTMLButtonElement;
  expect(ryzenBtn.disabled).toBe(true);
  expect(ryzenBtn.title).toBe("спить");

  /* picking walter loads accounts; picking account-b */
  const walterBtn = Array.from(el.querySelectorAll(`${machineGroup} button`))
    .find((b) => b.textContent?.includes("walter")) as HTMLButtonElement;
  act(() => { walterBtn.click(); });
  await settle();
  const accountBBtn = findButton(el, "account-b", '[role="group"][aria-label="Акаунт"]');
  act(() => { accountBBtn.click(); });

  /* model select defaults to opus; switching LLM to Codex changes it */
  const modelSelect = el.querySelector('[aria-label="Модель"]') as HTMLSelectElement;
  expect(modelSelect.value).toBe("opus");
  const codexBtn = findButton(el, "codex", '[role="group"][aria-label="Рушій"]');
  act(() => { codexBtn.click(); });
  expect(modelSelect.value).toBe("gpt-6-astra");

  /* clicking «Запустити» POSTs the expected body and shows the result */
  const startBtn = findButton(el, "Запустити");
  expect(startBtn.disabled).toBe(false);
  act(() => { startBtn.click(); });
  await settle();

  expect(lastPostBody).toEqual({
    host: "walter", project: "money", engine: "codex", model: "gpt-6-astra", account: "account-b", fresh: true,
  });
  expect(el.textContent).toContain("pulled");
});
