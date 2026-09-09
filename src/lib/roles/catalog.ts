import { isDelegationDeniedRole } from "@/lib/agent/spawnAdmission";
import { fleetctl, fleetctlInstalled, fleetctlMessage } from "@/lib/fleetctl/client";

import { ROLE_DEFAULTS } from "./defaults";
import { defaultRoleParameterValues } from "./parameters";
import { roleConfigError, resolveSpawnRole, validateRoleParams, type SpawnRoleResolution } from "./registry";
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

/** How a value the console said, but could not have meant, is named. */
const saidType = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "an array" : `a ${typeof value}`);

type Said<T> = { value: T; complaint: string | null };

/**
 * One field as the console said it.
 *
 * A usable value travels verbatim, nonsense included: substituting the seed's
 * engine for a console `engine: "kettle"` would hand the launch validator a
 * value the console does not hold, and the row would read «доступна для
 * запуску» about a config that exists nowhere. An ABSENT key is an omission,
 * and only then does the seed fill it. Anything else — `null`, a number, an
 * object — is a said value that is not a value: neither usable nor an
 * omission, so it blocks its own row and names the field and what arrived.
 */
function saidValue<T>(
  present: boolean,
  value: unknown,
  usable: (candidate: unknown) => candidate is T,
  empty: T,
  seed: T | undefined,
  field: string,
): Said<T> {
  if (!present || value === undefined) {
    return seed === undefined
      ? { value: empty, complaint: `the console gave this role no ${field}` }
      : { value: seed, complaint: null };
  }
  if (usable(value)) return { value, complaint: null };
  return { value: empty, complaint: `the console gave this role ${saidType(value)} for ${field}` };
}

const isString = (value: unknown): value is string => typeof value === "string";
const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

/**
 * A role parameter in the shapes the RESOLVER consumes, not merely in the shape
 * that survives a cast: `validateRoleParams` calls `options.includes`, compares
 * integer bounds, and reads declared defaults, so a `select` whose `options` is
 * an object throws where it is used — after this adapter has run, and therefore
 * past the per-row catch. What the launch will walk is checked here.
 */
function parameterComplaint(item: unknown, index: number): string | null {
  const at = `parameter ${index + 1}`;
  if (!item || typeof item !== "object" || Array.isArray(item)) return `the console gave this role ${saidType(item)} for ${at}`;
  const parameter = item as Record<string, unknown>;
  if (!isString(parameter.key) || !parameter.key.trim()) return `the console gave this role ${at} without a key`;
  const named = `parameter ${JSON.stringify(parameter.key)}`;
  const kind = parameter.kind;
  if (kind !== "text" && kind !== "integer" && kind !== "select") return `the console gave this role ${saidType(kind)} for the kind of ${named}`;
  if (parameter.required !== undefined && typeof parameter.required !== "boolean") return `the console gave this role ${saidType(parameter.required)} for the required flag of ${named}`;
  if (kind === "integer") {
    for (const bound of ["default", "min", "max"] as const) {
      if (parameter[bound] !== undefined && typeof parameter[bound] !== "number") return `the console gave this role ${saidType(parameter[bound])} for the ${bound} of ${named}`;
    }
    return null;
  }
  if (parameter.default !== undefined && !isString(parameter.default)) return `the console gave this role ${saidType(parameter.default)} for the default of ${named}`;
  /* The one the resolver calls `.includes` on. */
  if (kind === "select" && parameter.options !== undefined && !isStringList(parameter.options)) {
    return `the console gave this role ${saidType(parameter.options)} for the options of ${named}`;
  }
  return null;
}

function saidParameters(present: boolean, value: unknown, seed: RoleDefinition["parameters"] | undefined): Said<RoleDefinition["parameters"]> {
  if (!present || value === undefined) return { value: seed ?? [], complaint: null };
  if (!Array.isArray(value)) return { value: [], complaint: `the console gave this role ${saidType(value)} for parameters` };
  const complaint = value.map((item, index) => parameterComplaint(item, index)).find((found) => found !== null) ?? null;
  return complaint === null ? { value: value as RoleDefinition["parameters"], complaint: null } : { value: [], complaint };
}

/**
 * One console role in the shape every existing consumer already reads, plus
 * every complaint the adapter collected on the way. Whatever is unusable stays
 * out of the definition AND is named, so no consumer downstream meets a value
 * that would throw where it is used.
 */
function definitionOf(role: ConsoleRole, fallback: RoleDefinition | undefined): { definition: RoleDefinition; complaints: string[] } {
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(role, key);
  /* `config: null` is a said value too. Read as `{}` it becomes three
     omissions, and the seed quietly supplies the whole runtime. */
  const configSaid = saidValue<Record<string, unknown>>(
    has("config"),
    role.config,
    (candidate): candidate is Record<string, unknown> => Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate),
    {},
    fallback ? {} : undefined,
    "config",
  );
  const said = configSaid.value;
  const runtimeSaid = configSaid.complaint !== null;
  /* A rejected `config` object has no fields to read; the seed does not get to
     stand in for the runtime of a role whose runtime the console mis-stated. */
  const field = (key: "engine" | "model" | "effort") => (runtimeSaid
    ? { value: "", complaint: null }
    : saidValue<string>(Object.prototype.hasOwnProperty.call(said, key), said[key], isString, "", fallback?.config[key], key));
  const engine = field("engine");
  const model = field("model");
  const effort = field("effort");
  const parameters = saidParameters(has("parameters"), role.parameters, fallback?.parameters);
  /* The prompt IS the launch. A non-string one read as an omission is how a
     role could be shown, and launched, carrying the built-in scaffold the
     console never served. Fences travel with it into the same prompt. */
  const promptScaffold = saidValue<string>(has("promptScaffold"), role.promptScaffold, isString, "", fallback?.promptScaffold, "promptScaffold");
  /* An absent list is an empty list — a console role may legitimately declare
     no fences and no capabilities. Only a list the console SAID and this
     adapter cannot use is a complaint. */
  const safetyFences = saidValue<string[]>(has("safetyFences"), role.safetyFences, isStringList, [], [...fallback?.safetyFences ?? []], "safetyFences");
  const capabilities = saidValue<string[]>(has("capabilities"), role.capabilities, isStringList, [], [...fallback?.capabilities ?? []], "capabilities");
  return {
    definition: {
      id: role.id,
      /* A display name is not the launch: a nonsense one falls back and does
         not block a role that is otherwise runnable. */
      name: isString(role.name) ? role.name : fallback?.name ?? role.id,
      description: isString(role.description) ? role.description : fallback?.description ?? "",
      /* An engine outside the union is exactly what the validator must see. */
      config: { engine: engine.value as RoleDefinition["config"]["engine"], model: model.value, effort: effort.value },
      parameters: parameters.value,
      promptScaffold: promptScaffold.value,
      safetyFences: safetyFences.value as RoleDefinition["safetyFences"],
      capabilities: capabilities.value as RoleDefinition["capabilities"],
    },
    complaints: [configSaid, engine, model, effort, parameters, promptScaffold, safetyFences, capabilities]
      .map((said_) => said_.complaint)
      .filter((complaint): complaint is string => complaint !== null),
  };
}

/** Why a launch would refuse this role: what the console said that cannot be
    used, else the launch validator's own verdict — on the values a launch would
    actually run with. */
function launchComplaint(definition: RoleDefinition, complaints: readonly string[]): string | null {
  if (complaints.length) return complaints.join("; ");
  const missing = (["engine", "model", "effort"] as const).filter((field) => !definition.config[field]);
  if (missing.length) return `the console gave this role no ${missing.join(", ")}`;
  const config = roleConfigError(definition);
  if (config) return config;
  /* The EFFECTIVE parameters, not the declared ones. `validateRoleParams`
     checks a value the caller supplies, but resolves an omitted one to the
     declared default and moves on — so a `default` outside its own `min`/`max`,
     outside its own `options`, or under contradictory bounds reaches the
     scaffold unchecked, and a launch that supplies nothing renders it. Handing
     the defaults in as values runs them through the SAME checks, which is also
     what makes `launchable` mean «this launches», not «this parses». */
  const params = validateRoleParams(definition, defaultRoleParameterValues(definition), { requireRequired: false });
  return params.ok ? null : params.error;
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
