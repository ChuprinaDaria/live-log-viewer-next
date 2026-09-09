import { afterAll, afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { flushSync } from "react-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { emptyStore, type ConnectionState } from "@/components/runtime/runtimeModel";
import { translate, type MessageKey } from "@/lib/i18n";

/*
 * §1.1 and §1.2 of the audit, on the screen: what the roles page SAYS must be
 * what the server established.
 *
 * The three claims that were previously guessed here — that the catalog is
 * fresh, that a shown role can be launched, and that a Save was confirmed —
 * each get a case. A degraded read keeps the last list visible, dated, with the
 * reason and one Retry; a role the launch validator refuses says so with the
 * validator's own words; a write whose read-back failed neither rewrites the
 * textarea nor claims success.
 */

const actualRuntimeHooks = await import("@/hooks/useRuntime");
const runtime = {
  enabled: false,
  connection: "live" as ConnectionState,
  lastEventAt: null as number | null,
  resyncedAt: null,
  store: emptyStore(),
  structuredHostsEnabled: false,
};
mock.module("@/hooks/useRuntime", () => ({
  ...actualRuntimeHooks,
  useRuntimeBusState: () => runtime,
  useRuntime: () => runtime,
  useRuntimeSelector: (selector: (state: typeof runtime) => unknown) => selector(runtime),
  useRuntimeSession: () => null,
}));

const { MobileRolesScreen } = await import("./MobileRolesScreen");
const { createMobileNav, MobileNavContext } = await import("./mobileNav");

const dom = new Window({ url: "http://localhost/", width: 390, height: 844 });
const G = globalThis as Record<string, unknown>;

const seedRole = {
  id: "builder", name: "Builder", description: "Builds", editable: true,
  config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" },
  promptScaffold: "Seed prompt", edited: true, updatedAt: null,
  seedPromptScaffold: "Original prompt", origin: "seed", launchable: true, blockedReason: null, unsupported: [],
};
const ownRole = {
  id: "custom-reviewer", name: "Custom reviewer", description: "Reviews one form", editable: true,
  config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" },
  promptScaffold: "Own prompt", edited: true, updatedAt: null,
  origin: "local", launchable: true, blockedReason: null, unsupported: ["pipeline", "mcp"],
};
const brokenRole = {
  ...ownRole, id: "broken-role", name: "Broken", promptScaffold: "Broken prompt",
  launchable: false, blockedReason: "invalid claude model id \"gpt-6-astra\"",
};

/** Every request the screen made, each answered by the test when it chooses. */
interface Pending { method: string; body: unknown; answer: (value: unknown, status?: number) => void }
let pending: Pending[] = [];
const queueingFetch = ((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve) => {
  void input;
  pending.push({
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : null,
    answer: (value, status = 200) => resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })),
  });
})) as unknown as typeof fetch;

const OVERRIDES: Record<string, unknown> = {
  window: dom, document: dom.document, navigator: dom.navigator, Node: dom.Node, HTMLElement: dom.HTMLElement,
  HTMLButtonElement: dom.HTMLButtonElement, Event: dom.Event, KeyboardEvent: dom.KeyboardEvent,
  MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent,
  sessionStorage: dom.sessionStorage, localStorage: dom.localStorage,
  requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  fetch: queueingFetch,
  IS_REACT_ACT_ENVIRONMENT: true,
};
const HAS: Record<string, boolean> = {};
const SAVED: Record<string, unknown> = {};
beforeAll(() => { for (const key of Object.keys(OVERRIDES)) { HAS[key] = key in G; SAVED[key] = G[key]; G[key] = OVERRIDES[key]; } });
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 0));
  for (const key of Object.keys(OVERRIDES)) { if (HAS[key]) G[key] = SAVED[key]; else delete G[key]; }
  mock.module("@/hooks/useRuntime", () => actualRuntimeHooks);
});

let roots: Root[] = [];
beforeEach(() => { dom.document.body.replaceChildren(); roots = []; pending = []; });
afterEach(() => { for (const root of roots) flushSync(() => root.unmount()); roots = []; });

function nav() {
  const entries: { state: unknown; url: string }[] = [{ state: null, url: "http://localhost/#screen=roles" }];
  let index = 0;
  return createMobileNav({
    history: {
      get state() { return entries[index]!.state; },
      pushState(state, _unused, url) { entries.splice(index + 1); entries.push({ state, url: url ?? entries[index]!.url }); index += 1; },
      replaceState(state, _unused, url) { entries[index] = { state, url: url ?? entries[index]!.url }; },
      back() { if (index > 0) index -= 1; },
    },
    href: () => entries[index]!.url,
    onPopstate: () => () => {},
  });
}

const flush = async (fn: () => void) => { await act(async () => { fn(); await new Promise((r) => setTimeout(r, 0)); }); };

async function mount(): Promise<HTMLElement> {
  const host = dom.document.createElement("div");
  dom.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await flush(() => root.render(
    <MobileNavContext.Provider value={nav()}>
      <MobileRolesScreen host={null} />
    </MobileNavContext.Provider>,
  ));
  return host as unknown as HTMLElement;
}

const q = (host: HTMLElement, selector: string) => host.querySelector(selector) as unknown as HTMLElement | null;
const click = async (el: Element | null) => {
  if (!el) throw new Error("nothing to click");
  await flush(() => { (el as unknown as { click: () => void }).click(); });
};
/* The screen renders in the default locale here; the uk/en pair itself is
   checked in `src/lib/i18n`. */
const uk = (key: MessageKey, params?: Record<string, string | number>) => translate("en", key, params);
/* A keystroke in the prompt field. happy-dom's synthetic `input` event does not
   reach React's controlled-value tracker here, so the field's own handler is
   called with the value the browser would have put there — the pattern this
   repo already uses for composer paste. */
const typeInto = async (area: HTMLElement | null, text: string) => {
  if (!area) throw new Error("no textarea");
  const setter = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")?.set;
  const propsKey = Object.keys(area).find((key) => key.startsWith("__reactProps$"));
  if (!propsKey) throw new Error("the textarea is not mounted by React");
  const props = (area as unknown as Record<string, { onChange(event: unknown): void }>)[propsKey]!;
  await flush(() => {
    setter?.call(area, text);
    props.onChange({ target: area, currentTarget: area });
  });
};

test("a degraded read names its reason above the list it is still showing, with one Retry", async () => {
  const host = await mount();
  await flush(() => pending[0].answer({
    source: "fleetctl", readAt: "2026-09-09T07:00:00.000Z", degraded: null, roles: [seedRole],
  }));
  expect(q(host, "[data-mobile2-roles-error]")).toBeNull();
  expect(q(host, "[data-mobile2-roles-source]")?.textContent).toContain("1");

  await click(host.querySelector("[data-mobile2-roles] button"));
  await flush(() => pending[1].answer({
    source: "fallback", readAt: "2026-09-09T07:05:00.000Z",
    degraded: { reason: "console-unavailable", detail: "fleetctl failed" }, roles: [seedRole],
  }));
  const alert = q(host, "[data-mobile2-roles-error]");
  expect(alert?.textContent).toContain(uk("roles.degradedUnavailable", { detail: "fleetctl failed" }));
  expect(q(host, "[data-mobile2-roles-retry]")).not.toBeNull();
  /* The list itself is still there: a failed read must not blank the catalog. */
  expect(q(host, "[data-mobile2-role='builder']")).not.toBeNull();
  /* And nothing is editable while the console is unreachable. */
  expect(q(host, "[data-mobile2-roles-source]")?.textContent).toContain(uk("roles.sourceFallback", { count: 1, at: "" }).split("·")[0].trim());
});

test("a role the launch path refuses says why, and its neighbour stays launchable", async () => {
  const host = await mount();
  await flush(() => pending[0].answer({ source: "fleetctl", readAt: null, degraded: null, roles: [brokenRole, seedRole] }));
  expect(q(host, "[data-mobile2-role-blocked='broken-role']")?.textContent).toBe(uk("roles.blockedBadge"));
  await click(host.querySelector("[data-mobile2-role='broken-role'] button"));
  expect(q(host, "[data-mobile2-role-reason]")?.textContent).toBe(uk("roles.blocked", { reason: brokenRole.blockedReason }));
  expect(q(host, "[data-mobile2-role-unsupported]")?.textContent).toBe(uk("roles.unsupportedConsumers"));
  expect(q(host, "[data-mobile2-role-blocked='builder']")).toBeNull();
});

test("an own role offers no Reset, and a seed role does", async () => {
  const host = await mount();
  await flush(() => pending[0].answer({ source: "fleetctl", readAt: null, degraded: null, roles: [ownRole, seedRole] }));
  await click(host.querySelector("[data-mobile2-role='custom-reviewer'] button"));
  expect(q(host, "[data-mobile2-role-own]")?.textContent).toBe(uk("roles.own"));
  expect(q(host, "[data-mobile2-role-reset='custom-reviewer']")).toBeNull();
  await click(host.querySelector("[data-mobile2-role='builder'] button"));
  expect(q(host, "[data-mobile2-role-reset='builder']")).not.toBeNull();
});

test("Reset shows the restored text in the open editor at once", async () => {
  const host = await mount();
  await flush(() => pending[0].answer({ source: "fleetctl", readAt: null, degraded: null, roles: [seedRole] }));
  await click(host.querySelector("[data-mobile2-role='builder'] button"));
  const area = () => q(host, "textarea") as unknown as { value: string } | null;
  expect(area()?.value).toBe("Seed prompt");
  await click(q(host, "[data-mobile2-role-reset='builder']"));
  await flush(() => pending[1].answer({ written: true, role: { ...seedRole, promptScaffold: "Original prompt", edited: false } }));
  expect(area()?.value).toBe("Original prompt");
  expect(q(host, "[data-mobile2-role-unconfirmed]")).toBeNull();
});

test("a write that landed unconfirmed keeps the text it sent and says it is unconfirmed", async () => {
  const host = await mount();
  await flush(() => pending[0].answer({ source: "fleetctl", readAt: null, degraded: null, roles: [seedRole] }));
  await click(host.querySelector("[data-mobile2-role='builder'] button"));
  await typeInto(q(host, "textarea"), "Edited prompt");
  await click(q(host, "[data-mobile2-role-save='builder']"));
  expect(pending[1].body).toEqual({ role: "builder", prompt: "Edited prompt" });
  await flush(() => pending[1].answer({ written: true, role: null, unconfirmed: "store busy" }));
  expect(q(host, "[data-mobile2-role-unconfirmed]")?.textContent).toBe(uk("roles.savedUnconfirmed", { detail: "store busy" }));
  expect(q(host, "[data-mobile2-role-failure]")).toBeNull();
  /* Nothing was confirmed, so nothing overwrites what the operator wrote. */
  expect((q(host, "textarea") as unknown as { value: string }).value).toBe("Edited prompt");
});

test("an external refresh keeps an unsaved draft and does not pass it off as saved", async () => {
  const host = await mount();
  await flush(() => pending[0].answer({ source: "fleetctl", readAt: null, degraded: null, roles: [seedRole] }));
  await click(host.querySelector("[data-mobile2-role='builder'] button"));
  await typeInto(q(host, "textarea"), "My unsaved draft");
  await click(host.querySelector("[data-mobile2-roles] button"));
  await flush(() => pending[1].answer({
    source: "fleetctl", readAt: null, degraded: null,
    roles: [{ ...seedRole, promptScaffold: "Console changed it" }],
  }));
  expect((q(host, "textarea") as unknown as { value: string }).value).toBe("My unsaved draft");
  /* Save is still offered: the draft is still unsaved, and the row now differs
     from the console's newer text. */
  expect((q(host, "[data-mobile2-role-save='builder']") as unknown as { disabled: boolean }).disabled).toBe(false);
});
