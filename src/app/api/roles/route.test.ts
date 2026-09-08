import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { ROLE_DEFAULTS } from "@/lib/roles/defaults";

// Never call the machine's real console or read its live role overrides.
const client = await import("@/lib/fleetctl/client");
const registry = await import("@/lib/roles/registry");
let installed = false;
let brokenOverrides = false;
let brokenConsole = false;
const calls: string[] = [];
const custom = { id: "custom-reviewer", name: "Custom reviewer", config: { engine: "codex", model: "model-a", effort: "high" }, promptScaffold: "Review the form" };
mock.module("@/lib/fleetctl/client", () => ({
  ...client,
  fleetctlInstalled: () => installed,
  fleetctl: async (call: { fn: string; params?: { role?: string } }) => {
    calls.push(call.fn);
    if (brokenConsole) throw new Error("console unavailable");
    if (call.fn === "roles_list") return { roles: [{ id: "builder" }, { id: custom.id }] };
    if (call.fn === "role_show") return call.params?.role === custom.id ? custom : { id: "builder", promptScaffold: "Read-back text", seed_promptScaffold: "Seed", edited: true };
    return { ok: true };
  },
}));
mock.module("@/lib/roles/registry", () => ({
  ...registry,
  listRoles: () => { if (brokenOverrides) throw new Error("unknown role id"); return ROLE_DEFAULTS; },
}));
afterAll(() => {
  mock.module("@/lib/fleetctl/client", () => client);
  mock.module("@/lib/roles/registry", () => registry);
});
beforeEach(() => { installed = false; brokenOverrides = false; brokenConsole = false; calls.length = 0; });
const { GET, POST } = await import("./route");
const request = (body: unknown) => new NextRequest("http://localhost/api/roles", { method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) });

test("fallback catalog answers without offering unavailable edits", async () => {
  const body = await (await GET()).json();
  expect(body.schemaVersion).toBe(1);
  expect(body.roles).toHaveLength(8);
  expect(body.roles.every((role: { editable: boolean }) => !role.editable)).toBe(true);
  expect(body.roles.find((role: { id: string }) => role.id === "deployer")?.promptPreview).toContain("blue/green");
  expect(calls).toEqual([]);
});

test("extra console roles stay visible and explicitly read-only even when local overrides reject them", async () => {
  installed = true; brokenOverrides = true;
  const body = await (await GET()).json();
  expect(body.source).toBe("fleetctl");
  expect(body.roles).toHaveLength(2);
  expect(body.roles[0]).toMatchObject({ id: "builder", editable: true, promptPreview: "Read-back text" });
  expect(body.roles[1]).toMatchObject({ id: custom.id, editable: false, promptPreview: custom.promptScaffold });
});

test("an unreadable console or override file produces a visible fallback warning", async () => {
  installed = true; brokenConsole = true;
  expect((await (await GET()).json()).warning).toBe("console-unavailable");
  brokenOverrides = true;
  const body = await (await GET()).json();
  expect(body.warning).toBe("invalid-overrides");
  expect(body.roles).toHaveLength(8);
});

test("save reads back the supported role without opening an invalid local registry", async () => {
  installed = true; brokenOverrides = true;
  const response = await POST(request({ role: "builder", prompt: "Edited\ntext" }));
  expect(response.status).toBe(200);
  expect((await response.json()).role).toMatchObject({ id: "builder", editable: true, promptScaffold: "Read-back text" });
  expect(calls).toEqual(["role_edit", "role_show"]);
});

test("unsupported role writes are rejected before calling the console", async () => {
  installed = true;
  expect((await POST(request({ role: custom.id, prompt: "Changed" }))).status).toBe(400);
  expect(calls).toEqual([]);
});
