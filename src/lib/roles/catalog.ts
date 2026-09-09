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
 * One console role in the shape every existing consumer already reads.
 *
 * The seed fills only what the console did NOT say. A value the console DID
 * say travels verbatim, even when it is nonsense: substituting the seed's
 * engine for a console `engine: "kettle"` would hand the launch validator a
 * value the console does not hold, and the row would read «доступна для
 * запуску» about a config that does not exist anywhere. Whatever is left
 * missing stays empty and the complaint below names it.
 */
function definitionOf(role: ConsoleRole, fallback: RoleDefinition | undefined): RoleDefinition {
  const said = role.config ?? {};
  const engine = said.engine ?? fallback?.config.engine ?? "";
  const model = said.model ?? fallback?.config.model ?? "";
  const effort = said.effort ?? fallback?.config.effort ?? "";
  return {
    id: role.id,
    name: role.name ?? fallback?.name ?? role.id,
    description: role.description ?? fallback?.description ?? "",
    /* An engine outside the union is exactly what the validator must see. */
    config: { engine: engine as RoleDefinition["config"]["engine"], model, effort },
    parameters: (Array.isArray(role.parameters) ? role.parameters : fallback?.parameters ?? []) as RoleDefinition["parameters"],
    promptScaffold: typeof role.promptScaffold === "string" ? role.promptScaffold : fallback?.promptScaffold ?? "",
    safetyFences: (Array.isArray(role.safetyFences) ? strings(role.safetyFences) : fallback?.safetyFences ?? []) as RoleDefinition["safetyFences"],
    capabilities: (Array.isArray(role.capabilities) ? strings(role.capabilities) : fallback?.capabilities ?? []) as RoleDefinition["capabilities"],
  };
}

/** Why a launch would refuse this role: an absent runtime field named as
    absent, else the launch validator's own verdict. */
function launchComplaint(definition: RoleDefinition): string | null {
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
  const definition = definitionOf(role, fallback);
  const blockedReason = launchComplaint(definition);
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
    definition: definitionOf({ id }, fallback),
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
  return shown.map((answer, index) => (answer.status === "fulfilled"
    ? catalogRoleOf(answer.value)
    : unreadableRole(listed.roles[index]!.id, fleetctlMessage(answer.reason))));
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
      const blockedReason = launchComplaint(definition);
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

export function catalogDefinitions(catalog: RoleCatalog): RoleDefinition[] {
  return catalog.roles.map((role) => role.definition);
}

/**
 * The launch resolution against the catalog the roles page shows — so a role
 * read there launches with the config and prompt it displayed, additional
 * console roles included.
 *
 * The console is only consulted for a role-shaped launch, and a console that is
 * down degrades to the built-in definitions rather than blocking the launch:
 * the seat and the handoff keep their synchronous `resolveSpawnRole`, so no
 * orchestrator rotation can ever wait on `fleetctl`.
 */
export async function resolveSpawnRoleFromCatalog(
  body: Parameters<typeof resolveSpawnRole>[0],
): Promise<SpawnRoleResolution> {
  if (body.role === undefined || body.role === null || body.role === "") return resolveSpawnRole(body);
  const catalog = await loadRoleCatalog();
  return resolveSpawnRole(body, catalogDefinitions(catalog));
}
