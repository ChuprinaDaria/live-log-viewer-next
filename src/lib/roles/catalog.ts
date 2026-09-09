import { isDelegationDeniedRole } from "@/lib/agent/spawnAdmission";
import { fleetctl, fleetctlInstalled, fleetctlMessage } from "@/lib/fleetctl/client";

import { ROLE_DEFAULTS } from "./defaults";
import { roleConfigError, resolveSpawnRole, type SpawnRoleResolution } from "./registry";
import { loadRoleDefinitions } from "./store";
import { ROLE_IDS, type RoleDefinition } from "./types";

/*
 * The one role catalog: what the roles page reads, what a save writes back, and
 * what a launch resolves against.
 *
 * The console (`fleetctl`) is the single writer of role data, so it is the
 * single source here too. A successful console read NEVER touches the legacy
 * `role-presets.json` overrides store: that file is the console's own mirror of
 * its seed roles, and reading it after the console already answered is what let
 * one hand-broken override break an otherwise healthy catalog (§1.1 of the
 * audit). The overrides store is now only the fallback, and a fallback says so.
 *
 * Every role carries the two verdicts the operator actually needs before
 * touching anything:
 *
 *   `editable`  — the console can write this role, so Save/Reset are real.
 *   `launchable` — the LAUNCH path's own validator accepts this config. Not a
 *                  second opinion: `roleConfigError` is the same check
 *                  `resolveRole` runs at spawn time, so «доступна для запуску»
 *                  cannot disagree with what the launch does a second later.
 *
 * `unsupported` names the consumers that refuse a role BEFORE a launch — the
 * pipeline stage schema and the MCP `role` enum are frozen to the seed IDs — so
 * a console-only role is never shown as launchable everywhere while a pipeline
 * would reject it.
 */

export type RoleCatalogSource = "fleetctl" | "builtin";

/** Why the catalog is not the console's own answer. `detail` is the console's
    or the store's own message, which is operator-facing text about the
    operator's own config. */
export type RoleCatalogDegradation = {
  reason: "console-missing" | "console-unavailable" | "console-empty" | "invalid-overrides";
  detail: string | null;
};

/** A consumer that refuses a role before anything is launched. */
export type RoleConsumer = "pipeline" | "mcp";

export type CatalogRole = {
  definition: RoleDefinition;
  /** The console can write this role (its CLI, its MCP server and this board
      all edit the same entry). */
  editable: boolean;
  /** `role_reset` needs a seed; a console-created role has none. */
  seedPromptScaffold: string | null;
  /** The operator has changed this role away from its seed. */
  edited: boolean;
  /** `local` for a role the operator created in the console. */
  origin: "seed" | "local";
  updatedAt: string | null;
  /** The launch path accepts this role's runtime configuration. */
  launchable: boolean;
  /** Why a launch would refuse it, in the launch validator's own words. */
  blockedReason: string | null;
  unsupported: readonly RoleConsumer[];
  /** Whether a session in this role may create child agents at all. A role the
      board cannot classify delegates nothing (`isDelegationDeniedRole`), and
      the page says so rather than letting the limit be discovered at spawn. */
  canDelegate: boolean;
  grants: { mcp: string[]; skills: string[] };
};

export type RoleCatalog = {
  source: RoleCatalogSource;
  degraded: RoleCatalogDegradation | null;
  /** When this answer was read, so a stale view can date itself. */
  readAt: string;
  roles: CatalogRole[];
};

export interface ConsoleRole {
  id: string;
  name?: string;
  description?: string;
  config?: { engine?: string; model?: string; effort?: string };
  parameters?: unknown;
  promptScaffold?: string;
  safetyFences?: unknown;
  capabilities?: unknown;
  edited?: boolean;
  origin?: string;
  updated_at?: string | null;
  seed_promptScaffold?: string | null;
  grants?: { mcp?: string[]; skills?: string[] };
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

const isSeedId = (id: string): boolean => (ROLE_IDS as readonly string[]).includes(id);

/** Consumers whose contract is still frozen to the seed IDs. They refuse an
    additional role at validation time — before a launch — and the catalog says
    so rather than letting the page imply the role runs everywhere. */
function unsupportedConsumers(id: string): RoleConsumer[] {
  return isSeedId(id) ? [] : ["pipeline", "mcp"];
}

/**
 * One runtime field as the console said it.
 *
 * A string travels verbatim, nonsense included: substituting the seed's engine
 * for a console `engine: "kettle"` would hand the launch validator a value the
 * console does not hold, and the row would read «доступна для запуску» about a
 * config that exists nowhere. An ABSENT key is an omission, and only then does
 * the seed fill it. Anything else — `null`, a number, an object — is a said
 * value that is not a value: it is neither usable nor an omission, so it
 * blocks its own row and says which field and what arrived.
 */
function saidField(
  said: Record<string, unknown>,
  key: "engine" | "model" | "effort",
  seed: string | undefined,
): { value: string; complaint: string | null } {
  if (!(key in said) || said[key] === undefined) {
    return seed === undefined
      ? { value: "", complaint: `the console gave this role no ${key}` }
      : { value: seed, complaint: null };
  }
  const value = said[key];
  if (typeof value === "string") return { value, complaint: null };
  return { value: "", complaint: `the console gave this role ${value === null ? "null" : `a ${typeof value}`} for ${key}` };
}

/** Role parameters the launch path can actually walk: every element an object
    with a string `key`. One malformed element blocks its own row rather than
    throwing out of the adapter and taking the whole catalog with it. */
function saidParameters(
  value: unknown,
  seed: RoleDefinition["parameters"] | undefined,
): { value: RoleDefinition["parameters"]; complaint: string | null } {
  if (value === undefined) return { value: seed ?? [], complaint: null };
  if (!Array.isArray(value)) return { value: [], complaint: `the console gave this role a ${value === null ? "null" : typeof value} for parameters` };
  const usable = value.every((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item) && typeof (item as { key?: unknown }).key === "string");
  return usable
    ? { value: value as RoleDefinition["parameters"], complaint: null }
    : { value: [], complaint: "the console gave this role a parameter without a key" };
}

const saidText = (value: unknown, ...fallbacks: (string | undefined)[]): string =>
  (typeof value === "string" ? value : fallbacks.find((candidate) => typeof candidate === "string") ?? "");

/**
 * One console role in the shape every existing consumer already reads, plus
 * every complaint the adapter collected on the way. Whatever is unusable stays
 * out of the definition AND is named, so no consumer downstream meets a value
 * that would throw where it is used.
 */
function definitionOf(role: ConsoleRole, fallback: RoleDefinition | undefined): { definition: RoleDefinition; complaints: string[] } {
  const said = (role.config ?? {}) as Record<string, unknown>;
  const engine = saidField(said, "engine", fallback?.config.engine);
  const model = saidField(said, "model", fallback?.config.model);
  const effort = saidField(said, "effort", fallback?.config.effort);
  const parameters = saidParameters(role.parameters, fallback?.parameters);
  return {
    definition: {
      id: role.id,
      name: saidText(role.name, fallback?.name, role.id),
      description: saidText(role.description, fallback?.description, ""),
      /* An engine outside the union is exactly what the validator must see. */
      config: { engine: engine.value as RoleDefinition["config"]["engine"], model: model.value, effort: effort.value },
      parameters: parameters.value,
      promptScaffold: saidText(role.promptScaffold, fallback?.promptScaffold, ""),
      safetyFences: (Array.isArray(role.safetyFences) ? strings(role.safetyFences) : fallback?.safetyFences ?? []) as RoleDefinition["safetyFences"],
      capabilities: (Array.isArray(role.capabilities) ? strings(role.capabilities) : fallback?.capabilities ?? []) as RoleDefinition["capabilities"],
    },
    complaints: [engine, model, effort, parameters].map((field) => field.complaint).filter((complaint): complaint is string => complaint !== null),
  };
}

/** Why a launch would refuse this role: what the console said that cannot be
    used, else the launch validator's own verdict. */
function launchComplaint(definition: RoleDefinition, complaints: readonly string[]): string | null {
  if (complaints.length) return complaints.join("; ");
  const missing = (["engine", "model", "effort"] as const).filter((field) => !definition.config[field]);
  if (missing.length) return `the console gave this role no ${missing.join(", ")}`;
  return roleConfigError(definition);
}

/** A console entry as one catalog row: its definition plus the verdicts, with
    launchability asked of the launch validator itself.

    A row is never dropped. A role the console cannot describe is a role the
    operator must SEE refused — dropping it silently is the same lie as
    launching it, told the other way round. */
export function catalogRoleOf(role: ConsoleRole, fallback = ROLE_DEFAULTS.find((seed) => seed.id === role.id)): CatalogRole {
  const { definition, complaints } = definitionOf(role, fallback);
  const blockedReason = launchComplaint(definition, complaints);
  return {
    definition,
    editable: true,
    seedPromptScaffold: typeof role.seed_promptScaffold === "string" ? role.seed_promptScaffold : null,
    edited: role.edited === true,
    origin: role.origin === "local" ? "local" : "seed",
    updatedAt: typeof role.updated_at === "string" ? role.updated_at : null,
    launchable: blockedReason === null,
    blockedReason,
    unsupported: unsupportedConsumers(definition.id),
    canDelegate: !isDelegationDeniedRole(definition.id),
    grants: { mcp: strings(role.grants?.mcp), skills: strings(role.grants?.skills) },
  };
}

/** The row for a role whose own `role_show` failed: it exists in the catalog,
    it is not launchable, and it says which read failed. One unreadable role
    does not get to replace every readable one. */
function unreadableRole(id: string, detail: string): CatalogRole {
  const fallback = ROLE_DEFAULTS.find((seed) => seed.id === id);
  return {
    definition: definitionOf({ id }, fallback).definition,
    editable: false,
    seedPromptScaffold: null,
    edited: false,
    origin: "seed",
    updatedAt: null,
    launchable: false,
    blockedReason: `the console could not read this role: ${detail}`,
    unsupported: unsupportedConsumers(id),
    canDelegate: !isDelegationDeniedRole(id),
    grants: { mcp: [], skills: [] },
  };
}

/** The console holds the prompt only in `role_show`, so the catalog is one
    list call plus one show per role, run together rather than in sequence. */
async function consoleRoles(): Promise<CatalogRole[]> {
  const listed = await fleetctl<{ roles: { id: string }[] }>({ fn: "roles_list" });
  /* Settled, not all-or-nothing: one role the console cannot show is one
     broken row, not a reason to answer with a stale built-in catalog and let
     the other fifteen read as if they came from the console. The list call
     failing IS whole-catalog, and it throws to the degraded path above. */
  const shown = await Promise.allSettled(listed.roles.map((role) => fleetctl<ConsoleRole>({ fn: "role_show", params: { role: role.id } })));
  return shown.map((answer, index) => {
    const id = listed.roles[index]!.id;
    if (answer.status !== "fulfilled") return unreadableRole(id, fleetctlMessage(answer.reason));
    /* Per row, not per catalog: an answer this adapter cannot read at all is
       still one broken row. Whatever slips past the field guards above dies
       here, next to the role it came from. */
    try {
      return catalogRoleOf(answer.value);
    } catch (error) {
      return unreadableRole(id, fleetctlMessage(error));
    }
  });
}

/** The built-in catalog, merged with the console's overrides mirror — the
    answer when the console cannot be reached at all. Never editable: a write
    that cannot go through the console must not look available. */
function builtinCatalog(degraded: RoleCatalogDegradation): RoleCatalog {
  let definitions: readonly RoleDefinition[];
  let reason = degraded;
  try {
    definitions = loadRoleDefinitions();
  } catch (error) {
    definitions = ROLE_DEFAULTS;
    reason = { reason: "invalid-overrides", detail: fleetctlMessage(error) };
  }
  return {
    source: "builtin",
    degraded: reason,
    readAt: new Date().toISOString(),
    roles: definitions.map((definition) => {
      const blockedReason = launchComplaint(definition, []);
      return {
        definition,
        editable: false,
        seedPromptScaffold: null,
        edited: false,
        origin: "seed" as const,
        updatedAt: null,
        launchable: blockedReason === null,
        blockedReason,
        unsupported: unsupportedConsumers(definition.id),
        canDelegate: !isDelegationDeniedRole(definition.id),
        grants: { mcp: [], skills: [] },
      };
    }),
  };
}

/**
 * Read the catalog. It always answers: a missing or failing console degrades to
 * the built-in roles WITH a stated reason, because a role picker that answers
 * is worth more than a page that fails — and a silent fallback is what made
 * «збережено» stop meaning anything.
 */
export async function loadRoleCatalog(): Promise<RoleCatalog> {
  if (!fleetctlInstalled()) return builtinCatalog({ reason: "console-missing", detail: null });
  try {
    const roles = await consoleRoles();
    if (!roles.length) return builtinCatalog({ reason: "console-empty", detail: null });
    return { source: "fleetctl", degraded: null, readAt: new Date().toISOString(), roles };
  } catch (error) {
    return builtinCatalog({ reason: "console-unavailable", detail: fleetctlMessage(error) });
  }
}

/**
 * The definitions a launch may use: the rows the catalog itself called
 * launchable, and no others.
 *
 * A blocked row's definition is a DISPLAY shape — for an unreadable role it is
 * a seed-filled stand-in built so the page can name what failed. Handing it to
 * the resolver would let a row that says «не можна запустити: пульт не зміг
 * прочитати цю роль» start an agent on the built-in scaffold, which is the
 * display stand-in becoming the launch configuration.
 */
export function catalogDefinitions(catalog: RoleCatalog): RoleDefinition[] {
  return catalog.roles.filter((role) => role.launchable).map((role) => role.definition);
}

/**
 * The launch resolution against the catalog the roles page shows — so a role
 * read there launches with the config and prompt it displayed, additional
 * console roles included.
 *
 * A role the catalog refused is refused here too, with the SAME reason, before
 * any receipt exists and before anything runs. The console is only consulted
 * for a role-shaped launch, and a console that is down degrades to the built-in
 * definitions rather than blocking the launch: the seat and the handoff keep
 * their synchronous `resolveSpawnRole`, so no orchestrator rotation can ever
 * wait on `fleetctl`.
 */
export async function resolveSpawnRoleFromCatalog(
  body: Parameters<typeof resolveSpawnRole>[0],
): Promise<SpawnRoleResolution> {
  if (body.role === undefined || body.role === null || body.role === "") return resolveSpawnRole(body);
  const catalog = await loadRoleCatalog();
  const blocked = catalog.roles.find((role) => role.definition.id === body.role && !role.launchable);
  if (blocked) return { ok: false, error: `role ${blocked.definition.id} cannot launch: ${blocked.blockedReason}` };
  return resolveSpawnRole(body, catalogDefinitions(catalog));
}
