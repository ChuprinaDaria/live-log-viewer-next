import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

// Never call the machine's real console or read its live role overrides: the
// console is mocked, and the overrides file is a private temp dir.
const client = await import("@/lib/fleetctl/client");
const previousStateDir = process.env.LLV_STATE_DIR;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "llv-lane-e-roles-"));
const overridesFile = path.join(stateDir, "role-presets.json");
let installed = false;
let brokenConsole = false;
let readBackFails = false;
const calls: string[] = [];
/* A synthetic ADDITIONAL role: an id outside the seed list, created in the
   console, with no seed to reset to. It is the whole point of §1.1 — the board
   must read it, write it and launch it with one answer. */
const custom = {
  id: "custom-reviewer",
  name: "Custom reviewer",
  description: "Reviews one form.",
  config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" },
  promptScaffold: "Review the form",
  origin: "local",
  edited: true,
  seed_promptScaffold: null,
};
/* A console role whose runtime config the launch path refuses — a model that is
   not in this board's catalog at all. */
const broken = { id: "broken-role", name: "Broken", config: { engine: "claude", model: "gpt-6-astra", effort: "high" }, promptScaffold: "x" };
let consoleList = [{ id: "builder" }, { id: custom.id }];
mock.module("@/lib/fleetctl/client", () => ({
  ...client,
  fleetctlInstalled: () => installed,
  fleetctl: async (call: { fn: string; params?: { role?: string } }) => {
    if (!installed) throw new client.FleetctlError("MISSING", "fleetctl is not installed on this machine");
    calls.push(call.fn);
    if (brokenConsole) throw new client.FleetctlError("FAILED", "console unavailable");
    if (call.fn === "roles_list") return { roles: consoleList };
    if (call.fn === "role_show") {
      if (readBackFails && calls.filter((fn) => fn === "role_show").length > 1) throw new client.FleetctlError("FAILED", "store busy");
      if (call.params?.role === custom.id) return custom;
      if (call.params?.role === broken.id) return broken;
      if (call.params?.role === "builder") return { id: "builder", promptScaffold: "Read-back text", seed_promptScaffold: "Seed", edited: true };
      throw new client.FleetctlError("FAILED", `немає такої ролі: ${call.params?.role}`);
    }
    return { ok: true };
  },
}));
afterAll(() => {
  mock.module("@/lib/fleetctl/client", () => client);
  if (previousStateDir === undefined) delete process.env.LLV_STATE_DIR;
  else process.env.LLV_STATE_DIR = previousStateDir;
});
beforeEach(() => {
  installed = false; brokenConsole = false; readBackFails = false;
  calls.length = 0; consoleList = [{ id: "builder" }, { id: custom.id }];
  process.env.LLV_STATE_DIR = stateDir;
  fs.rmSync(overridesFile, { force: true });
});
/** Hand-break the overrides file the way a stale schema or a manual edit does. */
const breakOverrides = () => { fs.writeFileSync(overridesFile, "{ not json"); };
const { GET, POST } = await import("./route");
const request = (body: unknown) => new NextRequest("http://localhost/api/roles", { method: "POST", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) });

test("a missing console names the degradation instead of implying a live catalog", async () => {
  const body = await (await GET()).json();
  expect(body.schemaVersion).toBe(1);
  expect(body.roles).toHaveLength(8);
  expect(body.source).toBe("fallback");
  expect(body.degraded).toEqual({ reason: "console-missing", detail: null });
  expect(body.roles.every((role: { editable: boolean }) => !role.editable)).toBe(true);
  expect(body.roles.find((role: { id: string }) => role.id === "deployer")?.promptPreview).toContain("blue/green");
  expect(calls).toEqual([]);
});

test("a successful console read never opens the legacy overrides store", async () => {
  installed = true; breakOverrides();
  const body = await (await GET()).json();
  expect(body.source).toBe("fleetctl");
  expect(body.degraded).toBeNull();
  expect(body.roles).toHaveLength(2);
  expect(body.roles[0]).toMatchObject({ id: "builder", editable: true, launchable: true, promptPreview: "Read-back text" });
  /* The additional role is editable — the console writes it — and honest about
     the two consumers whose contracts still name the seed ids only. */
  expect(body.roles[1]).toMatchObject({
    id: custom.id, editable: true, launchable: true, origin: "local", unsupported: ["pipeline", "mcp"],
  });
  expect(body.roles[1].seedPromptScaffold).toBeUndefined();
});

test("one broken role is refused by name and does not hide the rest of the catalog", async () => {
  installed = true;
  consoleList = [{ id: "builder" }, { id: broken.id }];
  const body = await (await GET()).json();
  expect(body.source).toBe("fleetctl");
  expect(body.roles).toHaveLength(2);
  const refused = body.roles.find((role: { id: string }) => role.id === broken.id);
  expect(refused.launchable).toBe(false);
  expect(refused.blockedReason).toContain("gpt-6-astra");
  expect(body.roles.find((role: { id: string }) => role.id === "builder").launchable).toBe(true);
});

test("an unreadable console or override file produces a named fallback", async () => {
  installed = true; brokenConsole = true;
  const unavailable = await (await GET()).json();
  expect(unavailable.warning).toBe("console-unavailable");
  expect(unavailable.degraded.detail).toBe("console unavailable");
  breakOverrides();
  const body = await (await GET()).json();
  expect(body.degraded.reason).toBe("invalid-overrides");
  expect(body.roles).toHaveLength(8);
  expect(body.roles.every((role: { editable: boolean }) => !role.editable)).toBe(true);
});

test("saving an additional role reads it back through the same catalog", async () => {
  installed = true; breakOverrides();
  const response = await POST(request({ role: custom.id, prompt: "Edited\ntext" }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.written).toBe(true);
  expect(body.role).toMatchObject({ id: custom.id, editable: true, launchable: true, origin: "local" });
  expect(calls).toEqual(["role_show", "role_edit", "role_show"]);
});

test("a write that landed with an unconfirmed read-back says exactly that", async () => {
  installed = true; readBackFails = true;
  const body = await (await POST(request({ role: "builder", prompt: "Edited" }))).json();
  expect(body).toMatchObject({ written: true, role: null, unconfirmed: "store busy" });
});

test("reset is refused for a role with no seed, before the console is asked", async () => {
  installed = true;
  const response = await POST(request({ role: custom.id, reset: true }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("no seed");
  expect(calls).toEqual(["role_show"]);
});

test("an unknown role is refused with the console's own answer, and nothing is written", async () => {
  installed = true;
  const response = await POST(request({ role: "no-such-role", prompt: "Changed" }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("немає такої ролі");
  expect(calls).toEqual(["role_show"]);
});

test("a write is refused without touching the console when there is none", async () => {
  const response = await POST(request({ role: "builder", prompt: "Changed" }));
  expect(response.status).toBe(501);
  expect(calls).toEqual([]);
});
