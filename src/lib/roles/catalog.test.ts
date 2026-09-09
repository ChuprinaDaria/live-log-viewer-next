import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { PIPELINE_ROLE_IDS } from "@/lib/pipelines/roles";

import { ROLE_DEFAULTS } from "./defaults";
import { ROLE_IDS } from "./types";

/*
 * §1.1 of the audit, as a check: one catalog for reading, editing and LAUNCHING.
 *
 * The console is mocked — the real `roles_list`/`role_show` call a `load()` that
 * may WRITE the operator's store when it adds a seed role, so no test here goes
 * near it. The role under test is synthetic and additional: an id outside
 * `ROLE_IDS`, which is exactly the case the seed contracts cannot express.
 */

const client = await import("@/lib/fleetctl/client");

let installed = true;
let brokenConsole = false;
let prompt = "Review the form";
const custom = {
  id: "custom-reviewer",
  name: "Custom reviewer",
  description: "Reviews one form.",
  config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" },
  origin: "local",
  edited: true,
  seed_promptScaffold: null,
};

mock.module("@/lib/fleetctl/client", () => ({
  ...client,
  fleetctlInstalled: () => installed,
  fleetctl: async (call: { fn: string; params?: { role?: string } }) => {
    if (!installed) throw new client.FleetctlError("MISSING", "fleetctl is not installed on this machine");
    if (brokenConsole) throw new client.FleetctlError("FAILED", "console unavailable");
    if (call.fn === "roles_list") return { roles: [{ id: "builder" }, { id: custom.id }] };
    if (call.fn === "role_show") {
      if (call.params?.role === custom.id) return { ...custom, promptScaffold: prompt };
      return { id: "builder", promptScaffold: "Builder text" };
    }
    if (call.fn === "role_edit") { prompt = "Edited form review"; return { role: custom.id, changed: true }; }
    return { ok: true };
  },
}));
afterAll(() => {
  mock.module("@/lib/fleetctl/client", () => client);
  if (previousStateDir === undefined) delete process.env.LLV_STATE_DIR;
  else process.env.LLV_STATE_DIR = previousStateDir;
});
/* The legacy overrides file is the FALLBACK source and nothing else. It is
   pointed at a private temp dir rather than module-mocked: the operator's real
   `role-presets.json` must never be read, and a module mock of the store leaks
   into every other file bun runs in this process. */
const previousStateDir = process.env.LLV_STATE_DIR;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "llv-lane-e-catalog-"));
beforeEach(() => {
  installed = true; brokenConsole = false; prompt = "Review the form";
  process.env.LLV_STATE_DIR = stateDir;
  fs.rmSync(path.join(stateDir, "role-presets.json"), { force: true });
});

const { loadRoleCatalog, resolveSpawnRoleFromCatalog } = await import("./catalog");

const customRow = async () => {
  const catalog = await loadRoleCatalog();
  const row = catalog.roles.find((role) => role.definition.id === custom.id);
  if (!row) throw new Error("the synthetic role is missing from the catalog");
  return row;
};

test("an additional role reads, edits, re-reads and launches with one config and prompt", async () => {
  const first = await customRow();
  expect(first.definition.config).toEqual({ engine: "codex", model: "gpt-5.6-terra", effort: "high" });
  expect(first.definition.promptScaffold).toBe("Review the form");
  expect(first.editable).toBe(true);
  expect(first.launchable).toBe(true);

  const launchBefore = await resolveSpawnRoleFromCatalog({ role: custom.id });
  expect(launchBefore).toEqual({ ok: true, value: { role: custom.id, config: first.definition.config, scaffold: "Review the form" } });

  await client.fleetctl({ fn: "role_edit", params: { role: custom.id } });

  const second = await customRow();
  expect(second.definition.promptScaffold).toBe("Edited form review");
  const launchAfter = await resolveSpawnRoleFromCatalog({ role: custom.id });
  expect(launchAfter.ok && launchAfter.value?.scaffold).toBe(second.definition.promptScaffold);
  expect(launchAfter.ok && launchAfter.value?.config).toEqual(second.definition.config);
});

test("consumers frozen to the seed ids refuse an additional role before a launch", async () => {
  const row = await customRow();
  expect(row.unsupported).toEqual(["pipeline", "mcp"]);
  /* Not an opinion about those consumers — their own contracts: a pipeline
     stage and an MCP `role` argument are validated against these lists, so the
     refusal happens at validation time, never after something started. */
  expect((PIPELINE_ROLE_IDS as readonly string[]).includes(custom.id)).toBe(false);
  expect((ROLE_IDS as readonly string[]).includes(custom.id)).toBe(false);
});

test("a role whose runtime config the launch refuses is visible and says why", async () => {
  const catalog = await loadRoleCatalog();
  const builder = catalog.roles.find((role) => role.definition.id === "builder")!;
  expect(builder.launchable).toBe(true);
  /* The same validator the launch runs, asked of a config the board's model
     catalog does not hold. */
  const { roleConfigError } = await import("./registry");
  const refused = roleConfigError({ ...builder.definition, config: { engine: "claude", model: "gpt-6-astra", effort: "high" } });
  expect(refused).toContain("gpt-6-astra");
  expect(roleConfigError(builder.definition)).toBeNull();
});

test("a console that is down degrades by name and still launches a seed role", async () => {
  brokenConsole = true;
  const catalog = await loadRoleCatalog();
  expect(catalog.source).toBe("builtin");
  expect(catalog.degraded).toEqual({ reason: "console-unavailable", detail: "console unavailable" });
  expect(catalog.roles.every((role) => !role.editable)).toBe(true);
  /* The seat and the launch must never wait on the console to come back. */
  const launch = await resolveSpawnRoleFromCatalog({ role: "architect" });
  expect(launch.ok && launch.value?.role).toBe("architect");
  const additional = await resolveSpawnRoleFromCatalog({ role: custom.id });
  expect(additional.ok).toBe(false);
  expect(!additional.ok && additional.error).toContain("unknown role");
});

test("a missing console is named separately from a broken one", async () => {
  installed = false;
  const catalog = await loadRoleCatalog();
  expect(catalog.degraded).toEqual({ reason: "console-missing", detail: null });
  expect(catalog.roles).toHaveLength(ROLE_DEFAULTS.length);
});
