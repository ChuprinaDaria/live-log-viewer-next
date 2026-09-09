import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

import { PIPELINE_ROLE_IDS } from "@/lib/pipelines/roles";

import { ROLE_DEFAULTS } from "./defaults";
import { ROLE_IDS } from "./types";

/*
 * §1.1 of the audit, as a check: one catalog for reading, editing and LAUNCHING.
 *
 * The console here is a STATEFUL stand-in, not a fixed answer: `role_edit`
 * applies what it is sent the way the real console does, and `role_show`
 * returns what was stored. That is what makes the chain below a chain — a mock
 * that ignored the payload would let a "read → edit → read → launch" test pass
 * while the edit went nowhere.
 *
 * The real console is never touched: its `roles_list`/`role_show` run a
 * `load()` that may WRITE the operator's store when it adds a seed role. The
 * role under test is synthetic and additional — an id outside `ROLE_IDS`, the
 * case the seed contracts cannot express.
 */

const client = await import("@/lib/fleetctl/client");

interface Entry {
  id: string;
  name?: string;
  description?: string;
  config: { engine?: string; model?: string; effort?: string };
  promptScaffold?: string;
  origin?: string;
  seed?: string | null;
  updated_at?: string | null;
}

const SEED_BUILDER = "Builder seed prompt";
let store: Map<string, Entry>;
let installed = true;
let brokenConsole = false;
/** Roles whose `role_show` fails, by id — one unreadable role among healthy ones. */
let unreadable = new Set<string>();

function freshStore(): Map<string, Entry> {
  return new Map<string, Entry>([
    ["builder", { id: "builder", name: "Builder", config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" }, promptScaffold: SEED_BUILDER, origin: "seed", seed: SEED_BUILDER }],
    ["custom-reviewer", {
      id: "custom-reviewer",
      name: "Custom reviewer",
      description: "Reviews one form.",
      config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" },
      promptScaffold: "Review the form",
      origin: "local",
      seed: null,
    }],
  ]);
}

mock.module("@/lib/fleetctl/client", () => ({
  ...client,
  fleetctlInstalled: () => installed,
  fleetctl: async (call: { fn: string; params?: Record<string, unknown>; stdinParam?: string; stdinValue?: string }) => {
    if (!installed) throw new client.FleetctlError("MISSING", "fleetctl is not installed on this machine");
    if (brokenConsole) throw new client.FleetctlError("FAILED", "console unavailable");
    const id = typeof call.params?.role === "string" ? call.params.role : "";
    if (call.fn === "roles_list") return { roles: [...store.keys()].map((role) => ({ id: role })) };
    const entry = store.get(id);
    if (call.fn === "role_show") {
      if (unreadable.has(id)) throw new client.FleetctlError("FAILED", `сховище зайняте: ${id}`);
      if (!entry) throw new client.FleetctlError("FAILED", `немає такої ролі: ${id}`);
      return {
        ...entry,
        edited: entry.promptScaffold !== entry.seed,
        seed_promptScaffold: entry.seed ?? null,
      };
    }
    if (call.fn === "role_edit") {
      if (!entry) throw new client.FleetctlError("FAILED", `немає такої ролі: ${id}`);
      /* Exactly what the console writes: the prompt arrives over stdin, the
         runtime fields as flags, and absent fields are left alone. */
      if (call.stdinParam === "prompt" && typeof call.stdinValue === "string") entry.promptScaffold = call.stdinValue;
      for (const field of ["engine", "model", "effort"] as const) {
        if (typeof call.params?.[field] === "string") entry.config[field] = call.params[field] as string;
      }
      entry.updated_at = "2026-09-09T09:00:00.000Z";
      return { role: id, changed: true };
    }
    if (call.fn === "role_reset") {
      if (!entry || entry.seed == null) throw new client.FleetctlError("FAILED", `немає такої ролі в насінні: ${id}`);
      entry.promptScaffold = entry.seed;
      return { role: id, changed: true };
    }
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
  installed = true;
  brokenConsole = false;
  unreadable = new Set();
  store = freshStore();
  process.env.LLV_STATE_DIR = stateDir;
  fs.rmSync(path.join(stateDir, "role-presets.json"), { force: true });
});

const { loadRoleCatalog, resolveSpawnRoleFromCatalog } = await import("./catalog");
const { GET, POST } = await import("@/app/api/roles/route");

const CUSTOM = "custom-reviewer";

/** The page's own read, through the route the page calls. */
async function pageRead(): Promise<{ source: string; degraded: unknown; roles: Record<string, unknown>[] }> {
  return (await (await GET()).json()) as { source: string; degraded: unknown; roles: Record<string, unknown>[] };
}

async function pageWrite(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await POST(new NextRequest("http://localhost/api/roles", {
    method: "POST",
    headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const row = (roles: Record<string, unknown>[], id: string) => roles.find((role) => role.id === id)!;

test("an additional role reads, edits, re-reads and launches with one config and prompt", async () => {
  const first = row((await pageRead()).roles, CUSTOM);
  expect(first).toMatchObject({ editable: true, launchable: true, origin: "local", promptScaffold: "Review the form" });

  const before = await resolveSpawnRoleFromCatalog({ role: CUSTOM });
  expect(before).toEqual({ ok: true, value: { role: CUSTOM, config: first.config as never, scaffold: "Review the form" } });

  /* The edit goes through the page's own write, not past it. */
  const written = await pageWrite({ role: CUSTOM, prompt: "Edited form review", effort: "low" });
  expect(written.status).toBe(200);
  expect(written.body).toMatchObject({ written: true });

  const second = row((await pageRead()).roles, CUSTOM);
  expect(second.promptScaffold).toBe("Edited form review");
  expect(second.config).toEqual({ engine: "codex", model: "gpt-5.6-terra", effort: "low" });

  /* And the launch resolves the SAME two values the page just showed. */
  const after = await resolveSpawnRoleFromCatalog({ role: CUSTOM });
  expect(after.ok && after.value?.scaffold).toBe(second.promptScaffold as string);
  expect(after.ok && after.value?.config).toEqual(second.config as never);
  /* The write really did move: the chain would pass on a mock that ignored it
     only if nothing had changed at all. */
  expect(after).not.toEqual(before);
});

test("consumers frozen to the seed ids refuse an additional role before a launch", async () => {
  const catalog = await loadRoleCatalog();
  const custom = catalog.roles.find((role) => role.definition.id === CUSTOM)!;
  expect(custom.unsupported).toEqual(["pipeline", "mcp"]);
  /* Not an opinion about those consumers — their own contracts: a pipeline
     stage and an MCP `role` argument are validated against these lists, so the
     refusal happens at validation time, never after something started. */
  expect((PIPELINE_ROLE_IDS as readonly string[]).includes(CUSTOM)).toBe(false);
  expect((ROLE_IDS as readonly string[]).includes(CUSTOM)).toBe(false);
  /* And the board has no delegation policy for it, so it creates no children. */
  expect(custom.canDelegate).toBe(false);
  expect(catalog.roles.find((role) => role.definition.id === "builder")!.canDelegate).toBe(true);
});

test("a broken role is refused with the console's own values, never with substituted ones", async () => {
  /* An engine the union does not contain, and an empty model: both used to be
     quietly replaced by the seed's values, so the row claimed a launch would
     work using a configuration that exists nowhere. */
  store.set("broken-engine", { id: "broken-engine", config: { engine: "kettle", model: "opus", effort: "high" }, promptScaffold: "x", origin: "local", seed: null });
  store.get("builder")!.config.model = "";
  const roles = (await pageRead()).roles;

  const brokenEngine = row(roles, "broken-engine");
  expect(brokenEngine.launchable).toBe(false);
  expect((brokenEngine.config as { engine: string }).engine).toBe("kettle");
  expect(brokenEngine.blockedReason).toContain("engine");

  /* A seed role whose console entry lost its model is refused by name and
     still visible — the seed's own model is NOT silently substituted. */
  const builder = row(roles, "builder");
  expect(builder.launchable).toBe(false);
  expect((builder.config as { model: string }).model).toBe("");
  expect(builder.blockedReason).toContain("model");

  /* The healthy one is untouched by its neighbours. */
  expect(row(roles, CUSTOM).launchable).toBe(true);
});

test("one unreadable role does not replace the whole catalog with the built-in one", async () => {
  unreadable = new Set(["builder"]);
  const answer = await pageRead();
  /* Still the console's catalog: the source, the additional role, and its
     editability all survive one failed `role_show`. */
  expect(answer.source).toBe("fleetctl");
  expect(answer.degraded).toBeNull();
  expect(answer.roles).toHaveLength(2);
  expect(row(answer.roles, CUSTOM)).toMatchObject({ editable: true, launchable: true });
  const broken = row(answer.roles, "builder");
  expect(broken.launchable).toBe(false);
  expect(broken.editable).toBe(false);
  expect(broken.blockedReason).toContain("сховище зайняте");
});

test("a catalog whose every role is broken is still the console's, not an empty one", async () => {
  for (const entry of store.values()) entry.config = { engine: "kettle", model: "", effort: "" };
  const answer = await pageRead();
  expect(answer.source).toBe("fleetctl");
  /* «console-empty» would say the console holds no roles. It holds two, and
     both are refused: the operator has to see which. */
  expect(answer.degraded).toBeNull();
  expect(answer.roles).toHaveLength(2);
  expect(answer.roles.every((role) => role.launchable === false)).toBe(true);
  /* And a console that genuinely lists nothing still degrades, with a reason. */
  store.clear();
  const empty = await pageRead();
  expect(empty.source).toBe("fallback");
  expect(empty.degraded).toMatchObject({ reason: "console-empty" });
});

test("a row the catalog refused does not launch from the seed behind its own verdict", async () => {
  /* The reviewer's reproduction: a seed role the console cannot show, next to a
     healthy additional one. */
  store.set("architect", { id: "architect", config: { engine: "claude", model: "opus", effort: "high" }, promptScaffold: "console architect", origin: "seed", seed: null });
  store.delete("builder");
  store.set("custom-scribe", { id: "custom-scribe", config: { engine: "codex", model: "gpt-5.6-terra", effort: "low" }, promptScaffold: "Write the note", origin: "local", seed: null });
  unreadable = new Set(["architect"]);

  const roles = (await pageRead()).roles;
  expect(row(roles, "architect").launchable).toBe(false);

  /* The row's verdict has to survive into the launch: the definition behind an
     unreadable row is a display stand-in built from the seed, and resolving it
     would start an agent on the built-in scaffold the console never served. */
  const refused = await resolveSpawnRoleFromCatalog({ role: "architect" });
  expect(refused.ok).toBe(false);
  expect(!refused.ok && refused.error).toContain("cannot launch");
  /* The SAME reason the page shows, not a second opinion. */
  expect(!refused.ok && refused.error).toContain(String(row(roles, "architect").blockedReason));

  /* And the healthy neighbour resolves with its own console values. */
  const healthy = await resolveSpawnRoleFromCatalog({ role: "custom-scribe" });
  expect(healthy).toEqual({ ok: true, value: { role: "custom-scribe", config: { engine: "codex", model: "gpt-5.6-terra", effort: "low" }, scaffold: "Write the note" } });
});

test("a role blocked by its own configuration is refused at launch with that reason", async () => {
  store.get("builder")!.config.engine = "kettle";
  const roles = (await pageRead()).roles;
  expect(row(roles, "builder").launchable).toBe(false);
  const refused = await resolveSpawnRoleFromCatalog({ role: "builder" });
  expect(refused.ok).toBe(false);
  /* The page's own reason, repeated verbatim: the launch does not re-derive a
     verdict, and it certainly does not repair the role by falling back to the
     seed's engine. */
  expect(!refused.ok && refused.error).toContain(String(row(roles, "builder").blockedReason));
});

test("a said value that is not a value blocks its own row and leaves its neighbours exact", async () => {
  /* `null` is something the console SAID. Read as an omission it becomes the
     seed's engine and the row launches on a configuration that exists nowhere. */
  store.get("builder")!.config.engine = null as unknown as string;
  store.set("wrong-type", { id: "wrong-type", config: { engine: "codex", model: 7 as unknown as string, effort: "high" }, promptScaffold: "x", origin: "local", seed: null });
  store.set("bad-parameters", {
    id: "bad-parameters",
    config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" },
    promptScaffold: "x",
    origin: "local",
    seed: null,
  });
  (store.get("bad-parameters") as unknown as { parameters: unknown }).parameters = [null];

  const answer = await pageRead();
  /* Nothing degraded, nothing vanished: three broken rows and one healthy one. */
  expect(answer.source).toBe("fleetctl");
  expect(answer.degraded).toBeNull();
  expect(answer.roles).toHaveLength(4);

  expect(row(answer.roles, "builder")).toMatchObject({ launchable: false });
  expect(String(row(answer.roles, "builder").blockedReason)).toContain("null for engine");
  expect(String(row(answer.roles, "wrong-type").blockedReason)).toContain("number for model");
  expect(String(row(answer.roles, "bad-parameters").blockedReason)).toContain("null for parameter 1");

  /* Neither the launch nor the neighbour is touched by any of it. */
  for (const id of ["builder", "wrong-type", "bad-parameters"]) {
    expect((await resolveSpawnRoleFromCatalog({ role: id })).ok).toBe(false);
  }
  const healthy = row(answer.roles, CUSTOM);
  expect(healthy).toMatchObject({ launchable: true, promptScaffold: "Review the form" });
  expect(healthy.config).toEqual({ engine: "codex", model: "gpt-5.6-terra", effort: "high" });
  const launch = await resolveSpawnRoleFromCatalog({ role: CUSTOM });
  expect(launch).toEqual({ ok: true, value: { role: CUSTOM, config: healthy.config as never, scaffold: "Review the form" } });
});

test("a prompt or a config the console said but could not have meant blocks its own row", async () => {
  /* `role_show` returns whatever the store holds, so a null prompt is a real
     row, not a probe's invention. Read as an omission it becomes the built-in
     scaffold — the role is then shown, and launched, carrying text the console
     never served. */
  store.get("builder")!.promptScaffold = null as unknown as string;
  store.set("no-config", { id: "no-config", promptScaffold: "x", origin: "local", seed: null, config: null as unknown as { engine?: string } });
  store.set("prompt-object", { id: "prompt-object", config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" }, promptScaffold: {} as unknown as string, origin: "local", seed: null });

  const answer = await pageRead();
  expect(answer.source).toBe("fleetctl");
  expect(answer.degraded).toBeNull();

  const builder = row(answer.roles, "builder");
  expect(builder.launchable).toBe(false);
  expect(String(builder.blockedReason)).toContain("null for promptScaffold");
  /* And nothing of the seed leaked into what is shown. */
  expect(builder.promptScaffold).toBe("");
  expect(builder.promptPreview).toBe("");

  const noConfig = row(answer.roles, "no-config");
  expect(noConfig.launchable).toBe(false);
  expect(String(noConfig.blockedReason)).toContain("null for config");
  /* A rejected config object does not let the seed supply the runtime either. */
  expect(noConfig.config).toEqual({ engine: "", model: "", effort: "" });

  expect(String(row(answer.roles, "prompt-object").blockedReason)).toContain("for promptScaffold");

  for (const id of ["builder", "no-config", "prompt-object"]) {
    const refused = await resolveSpawnRoleFromCatalog({ role: id });
    expect(refused.ok, id).toBe(false);
  }
});

test("a parameter shape the resolver would choke on blocks its row instead of throwing at launch", async () => {
  /* `validateRoleParams` calls `options.includes` and compares integer bounds.
     A `select` whose options is an object passes a "looks like an object with a
     key" check and then throws where it is USED — after the adapter has run,
     so no per-row catch is in the way. */
  const choking: Record<string, unknown[]> = {
    "select-options-object": [{ key: "pick", kind: "select", options: {} }],
    "select-options-mixed": [{ key: "pick", kind: "select", options: ["a", 7] }],
    "integer-bounds": [{ key: "count", kind: "integer", min: "1" }],
    "unknown-kind": [{ key: "pick", kind: "colour" }],
    "text-default": [{ key: "note", kind: "text", default: 5 }],
  };
  for (const [id, parameters] of Object.entries(choking)) {
    store.set(id, { id, config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" }, promptScaffold: "x", origin: "local", seed: null });
    (store.get(id) as unknown as { parameters: unknown }).parameters = parameters;
  }

  const answer = await pageRead();
  expect(answer.degraded).toBeNull();
  for (const id of Object.keys(choking)) {
    const blocked = row(answer.roles, id);
    expect(blocked.launchable, id).toBe(false);
    /* The reason names the parameter it is about, not just "invalid". */
    expect(String(blocked.blockedReason), id).toContain(String((choking[id]![0] as { key: string }).key));
    /* The launch refuses with that reason rather than throwing on the way. */
    const refused = await resolveSpawnRoleFromCatalog({ role: id, roleParams: { pick: "x", count: 2, note: "n" } });
    expect(refused.ok, id).toBe(false);
    expect(!refused.ok && refused.error, id).toContain("cannot launch");
  }

  /* A well-formed select still resolves — the guard checks the shapes the
     resolver consumes, it does not refuse parameters as such. */
  store.set("good-select", { id: "good-select", config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" }, promptScaffold: "Pick {{pick}}", origin: "local", seed: null });
  (store.get("good-select") as unknown as { parameters: unknown }).parameters = [{ key: "pick", label: "Pick", description: "which", kind: "select", options: ["a", "b"] }];
  const good = await resolveSpawnRoleFromCatalog({ role: "good-select", roleParams: { pick: "b" } });
  expect(good).toEqual({ ok: true, value: { role: "good-select", config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" }, scaffold: "Pick b" } });
});

test("a role whose runtime config the launch refuses is visible and says why", async () => {
  const catalog = await loadRoleCatalog();
  const builder = catalog.roles.find((role) => role.definition.id === "builder")!;
  expect(builder.launchable).toBe(true);
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
  const additional = await resolveSpawnRoleFromCatalog({ role: CUSTOM });
  expect(additional.ok).toBe(false);
  expect(!additional.ok && additional.error).toContain("unknown role");
});

test("a missing console is named separately from a broken one", async () => {
  installed = false;
  const catalog = await loadRoleCatalog();
  expect(catalog.degraded).toEqual({ reason: "console-missing", detail: null });
  expect(catalog.roles).toHaveLength(ROLE_DEFAULTS.length);
});
