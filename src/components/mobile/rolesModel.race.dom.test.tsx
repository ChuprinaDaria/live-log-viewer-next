import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";
import { installActEnv } from "@/test-helpers/actEnv";
import { useRoles, type RolesRead, type RoleRow } from "./rolesModel";

const dom = new Window();
installActEnv();
Object.assign(globalThis, { window: dom, document: dom.document, navigator: dom.navigator, Node: dom.Node, HTMLElement: dom.HTMLElement });
const realFetch = globalThis.fetch;
let root: Root | null = null;
let model: RolesRead;
const requests: { method: string; answer: (value: unknown, status?: number) => void }[] = [];
const original: RoleRow = { id: "builder", name: "Builder", editable: true, description: "", config: { engine: "codex", model: "model-a", effort: "high" }, promptScaffold: "Old prompt", edited: true, updatedAt: null };
const flush = async (fn: () => void) => act(async () => { fn(); await new Promise((r) => setTimeout(r, 0)); });

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  globalThis.fetch = realFetch;
  document.body.replaceChildren();
  requests.length = 0;
});

async function mount() {
  globalThis.fetch = ((_url: unknown, options?: RequestInit) => new Promise<Response>((resolve) => {
    requests.push({ method: options?.method ?? "GET", answer: (value, status = 200) => resolve(new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })) });
  })) as typeof fetch;
  function Probe() { model = useRoles(); return <output>{model.roles?.[0].promptScaffold}</output>; }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await flush(() => root!.render(<Probe />));
  await flush(() => requests[0].answer({ source: "fleetctl", roles: [original] }));
}

for (const reset of [false, true]) {
  test(`a slow Refresh cannot overwrite ${reset ? "Reset" : "Save"} read-back`, async () => {
    await mount();
    await flush(() => { void model.refresh(); });
    const updated = { ...original, promptScaffold: reset ? "Seed prompt" : "New prompt" };
    let saved!: Promise<Awaited<ReturnType<RolesRead["save"]>>>;
    await flush(() => { saved = model.save(original.id, reset ? { reset: true } : { prompt: updated.promptScaffold }); });
    expect(model.loading).toBe(true);
    expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST"]);
    await flush(() => requests[2].answer({ role: updated }));
    expect((await saved).role?.promptScaffold).toBe(updated.promptScaffold);
    await flush(() => requests[1].answer({ source: "fleetctl", roles: [original] }));
    expect(model.roles?.[0].promptScaffold).toBe(updated.promptScaffold);
    expect(document.querySelector("output")?.textContent).toBe(updated.promptScaffold);
    expect(model.loading).toBe(false);
    // A genuinely newer refresh still has authority after the write.
    await flush(() => { void model.refresh(); });
    await flush(() => requests[3].answer({ source: "fleetctl", roles: [{ ...updated, promptScaffold: "External edit" }] }));
    expect(model.roles?.[0].promptScaffold).toBe("External edit");
  });
}

test("Refresh during a write does not introduce another stale read, and old errors stay discarded", async () => {
  await mount();
  await flush(() => { void model.refresh(); });
  await flush(() => { void model.save(original.id, { prompt: "New prompt" }); });
  await flush(() => { void model.refresh(); });
  expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST"]);
  await flush(() => requests[2].answer({ role: { ...original, promptScaffold: "New prompt" } }));
  await flush(() => requests[1].answer({ error: "Old request failed" }, 503));
  expect(model.error).toBeNull();
  expect(model.roles?.[0].promptScaffold).toBe("New prompt");
});

test("an older GET completing during Save has no authority over the catalog", async () => {
  await mount();
  await flush(() => { void model.refresh(); });
  await flush(() => { void model.save(original.id, { prompt: "New prompt" }); });
  await flush(() => requests[1].answer({ source: "fallback", roles: [{ ...original, promptScaffold: "Stale fallback" }], warning: "stale" }));
  expect(model.source).toBe("fleetctl");
  expect(model.warning).toBeNull();
  expect(model.roles?.[0].promptScaffold).toBe("Old prompt");
  await flush(() => requests[2].answer({ role: { ...original, promptScaffold: "New prompt" } }));
  expect(model.roles?.[0].promptScaffold).toBe("New prompt");
});
