import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlInstalled, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { ROLE_DEFAULTS } from "@/lib/roles/defaults";
import { listRoles } from "@/lib/roles/registry";
import { ROLE_OVERRIDES_SCHEMA_VERSION } from "@/lib/roles/store";
import { ROLE_IDS, type RoleDefinition } from "@/lib/roles/types";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * The role catalog, read from the operator's console (`fleetctl`).
 *
 * `defaults.ts` is the SEED the console was filled from once, not the source:
 * a role's engine, model, effort and prompt are data the operator edits, and
 * the console is the one writer of that data — its CLI, its MCP server and
 * this route read the same catalog. The board still edits only its supported
 * seed IDs; additional console roles are explicitly read-only here.
 *
 * The route still answers when the console is absent: it falls back to the
 * built-in catalog merged with the overrides file and says so in `source`, so
 * a machine without the console keeps a working draft pane instead of an empty
 * role picker.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

interface ConsoleRole {
  id: string;
  name?: string;
  description?: string;
  config?: { engine?: string; model?: string; effort?: string };
  parameters?: unknown;
  promptScaffold?: string;
  safetyFences?: unknown;
  capabilities?: unknown;
  edited?: boolean;
  updated_at?: string | null;
  seed_promptScaffold?: string;
  grants?: { mcp?: string[]; skills?: string[] };
}

export interface RoleView extends RoleDefinition {
  editable: boolean;
  /** The name the draft pane reads. */
  promptPreview: string;
  /** The operator has changed this role away from its seed. */
  edited: boolean;
  updatedAt: string | null;
  /** What «повернути початковий» would restore; absent when unknown. */
  seedPromptScaffold?: string;
  grants?: { mcp: string[]; skills: string[] };
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** One console role in the shape every existing consumer already reads, so
    switching the source changes where the values come from and nothing else. */
function viewOf(role: ConsoleRole, fallback: RoleDefinition | undefined): RoleView | null {
  const base = fallback ?? null;
  const engine = role.config?.engine === "codex" ? "codex" : role.config?.engine === "claude" ? "claude" : base?.config.engine;
  const model = role.config?.model ?? base?.config.model;
  const effort = role.config?.effort ?? base?.config.effort;
  if (!engine || !model || !effort) return null;
  const prompt = typeof role.promptScaffold === "string" ? role.promptScaffold : base?.promptScaffold ?? "";
  return {
    id: role.id as RoleDefinition["id"],
    editable: (ROLE_IDS as readonly string[]).includes(role.id),
    name: role.name ?? base?.name ?? role.id,
    description: role.description ?? base?.description ?? "",
    config: { engine, model, effort },
    parameters: (Array.isArray(role.parameters) ? role.parameters : base?.parameters ?? []) as RoleDefinition["parameters"],
    promptScaffold: prompt,
    safetyFences: (Array.isArray(role.safetyFences) ? strings(role.safetyFences) : base?.safetyFences ?? []) as RoleDefinition["safetyFences"],
    capabilities: (Array.isArray(role.capabilities) ? strings(role.capabilities) : base?.capabilities ?? []) as RoleDefinition["capabilities"],
    promptPreview: prompt,
    edited: role.edited === true,
    updatedAt: typeof role.updated_at === "string" ? role.updated_at : null,
    ...(typeof role.seed_promptScaffold === "string" ? { seedPromptScaffold: role.seed_promptScaffold } : {}),
    grants: { mcp: strings(role.grants?.mcp), skills: strings(role.grants?.skills) },
  };
}

/** The console holds the prompt only in `role_show`, so the catalog is one
    list call plus one show per role, run together rather than in sequence. */
async function consoleRoles(): Promise<RoleView[]> {
  const listed = await fleetctl<{ roles: { id: string }[] }>({ fn: "roles_list" });
  const ids = listed.roles.map((role) => role.id);
  const shown = await Promise.all(ids.map((id) => fleetctl<ConsoleRole>({ fn: "role_show", params: { role: id } })));
  const defaults = new Map(ROLE_DEFAULTS.map((role) => [role.id as string, role]));
  return shown.flatMap((role) => {
    const view = viewOf(role, defaults.get(role.id));
    return view ? [view] : [];
  });
}

export async function GET(): Promise<NextResponse> {
  let warning: "console-unavailable" | "invalid-overrides" | null = null;
  if (fleetctlInstalled()) {
    try {
      const roles = await consoleRoles();
      if (roles.length) {
        return NextResponse.json({ schemaVersion: ROLE_OVERRIDES_SCHEMA_VERSION, source: "fleetctl", roles }, { headers });
      }
    } catch {
      warning = "console-unavailable";
      /* Fall through to the built-in catalog: a role picker that answers is
         worth more than a page that fails because the console is busy. */
    }
  }
  let fallback: readonly RoleDefinition[];
  try { fallback = listRoles(); }
  catch { fallback = ROLE_DEFAULTS; warning = "invalid-overrides"; }
  return NextResponse.json({
    warning,
    schemaVersion: ROLE_OVERRIDES_SCHEMA_VERSION,
    source: "fallback",
    roles: fallback.map((role) => ({ ...role, editable: false, promptPreview: role.promptScaffold, edited: false, updatedAt: null })),
  }, { headers });
}

/**
 * Edit one role, or restore it to its seed. Both go through the console, so
 * the CLI, the MCP server and this page can never hold different answers.
 *
 * `{ role, reset: true }` restores; otherwise every present field is written
 * and every absent one is left alone.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rejection = rejectCrossOrigin(request);
  if (rejection) { rejection.headers.set("Cache-Control", "no-store"); return rejection; }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers });
  }
  const role = typeof body.role === "string" ? body.role : "";
  if (!(ROLE_IDS as readonly string[]).includes(role)) {
    return NextResponse.json({ error: "role must be one of the known role ids" }, { status: 400, headers });
  }
  const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  try {
    if (body.reset === true) {
      await fleetctl({ fn: "role_reset", params: { role } });
    } else {
      const prompt = typeof body.prompt === "string" ? body.prompt : undefined;
      const params = { role, engine: text(body.engine), model: text(body.model), effort: text(body.effort) };
      if (prompt === undefined && !params.engine && !params.model && !params.effort) {
        return NextResponse.json({ error: "nothing to change" }, { status: 400, headers });
      }
      /* The prompt travels over stdin: it is up to 12 000 characters and an
         argument that long is the console's own documented trap. */
      await fleetctl(prompt === undefined
        ? { fn: "role_edit", params }
        : { fn: "role_edit", params, stdinParam: "prompt", stdinValue: prompt });
    }
    const updated = await fleetctl<ConsoleRole>({ fn: "role_show", params: { role } });
    const defaults = ROLE_DEFAULTS.find((definition) => definition.id === role);
    return NextResponse.json({ role: viewOf(updated, defaults) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}
