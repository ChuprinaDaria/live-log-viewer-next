import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { catalogRoleOf, loadRoleCatalog, type CatalogRole, type ConsoleRole, type RoleCatalog } from "@/lib/roles/catalog";
import { ROLE_OVERRIDES_SCHEMA_VERSION } from "@/lib/roles/store";
import { type RoleDefinition } from "@/lib/roles/types";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * The role catalog, read from the operator's console (`fleetctl`).
 *
 * `defaults.ts` is the SEED the console was filled from once, not the source:
 * a role's engine, model, effort and prompt are data the operator edits, and
 * the console is the one writer of that data — its CLI, its MCP server and
 * this route read the same catalog, through `lib/roles/catalog.ts`. Every
 * console role is editable here, additional ones included: the console edits
 * them all, and a page that showed a role it could not write was the whole
 * complaint (§1.1 of the audit).
 *
 * The route still answers when the console is absent: it falls back to the
 * built-in catalog and NAMES the degradation, so a machine without the console
 * keeps a working role picker while nothing pretends a write is available.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export interface RoleView extends RoleDefinition {
  editable: boolean;
  /** The name the draft pane reads. */
  promptPreview: string;
  /** The operator has changed this role away from its seed. */
  edited: boolean;
  updatedAt: string | null;
  /** What «повернути початковий» would restore; absent when unknown. */
  seedPromptScaffold?: string;
  /** A role the operator created in the console has no seed to return to. */
  origin: "seed" | "local";
  /** The launch path's own verdict: this config resolves at spawn time. */
  launchable: boolean;
  /** Why a launch would refuse it, in the launch validator's words. */
  blockedReason: string | null;
  /** Consumers that refuse this role before a launch (frozen seed contracts). */
  unsupported: readonly ("pipeline" | "mcp")[];
  /** A session in this role may create child agents. */
  canDelegate: boolean;
  grants?: { mcp: string[]; skills: string[] };
}

/** One catalog row in the shape every existing consumer already reads. */
function viewOf(role: CatalogRole): RoleView {
  return {
    ...role.definition,
    editable: role.editable,
    promptPreview: role.definition.promptScaffold,
    edited: role.edited,
    updatedAt: role.updatedAt,
    ...(role.seedPromptScaffold === null ? {} : { seedPromptScaffold: role.seedPromptScaffold }),
    origin: role.origin,
    launchable: role.launchable,
    blockedReason: role.blockedReason,
    unsupported: role.unsupported,
    canDelegate: role.canDelegate,
    grants: role.grants,
  };
}

function catalogBody(catalog: RoleCatalog): Record<string, unknown> {
  return {
    schemaVersion: ROLE_OVERRIDES_SCHEMA_VERSION,
    source: catalog.source === "fleetctl" ? "fleetctl" : "fallback",
    readAt: catalog.readAt,
    degraded: catalog.degraded,
    /** The pre-existing name for the same fact, kept so older clients still
        see that this answer is degraded. */
    warning: catalog.degraded?.reason ?? null,
    roles: catalog.roles.map(viewOf),
  };
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(catalogBody(await loadRoleCatalog()), { headers });
}

/**
 * Edit one role, or restore it to its seed. Both go through the console, so
 * the CLI, the MCP server and this page can never hold different answers.
 *
 * `{ role, reset: true }` restores; otherwise every present field is written
 * and every absent one is left alone.
 *
 * The write and the read-back are separate outcomes. A write that landed and a
 * read-back that failed is reported as exactly that — `written` with no
 * confirmed role — because telling the operator the save failed invites a
 * second blind write of the same text.
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
  const role = typeof body.role === "string" ? body.role.trim() : "";
  /* An id shape, not an id list: which roles are writable is the console's
     answer, because the console is the writer. A role it holds is a role it
     can edit, additional ones included. */
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(role)) {
    return NextResponse.json({ error: "role must be a role id" }, { status: 400, headers });
  }
  /* One `role_show` establishes three things before anything is written: that
     the console is reachable, that it holds this role, and whether the role has
     a seed to reset to. Its own refusal even names the ids it does hold. */
  let target: CatalogRole;
  try {
    target = catalogRoleOf(await fleetctl<ConsoleRole>({ fn: "role_show", params: { role } }));
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
  /* A role the console created has no seed; `role_reset` would refuse it, and
     refusing here keeps the button's absence and the API's answer aligned. */
  if (body.reset === true && target.seedPromptScaffold === null) {
    return NextResponse.json({ error: "this role has no seed to restore" }, { status: 400, headers });
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
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
  try {
    const updated = catalogRoleOf(await fleetctl<ConsoleRole>({ fn: "role_show", params: { role } }));
    return NextResponse.json({ written: true, role: viewOf(updated) }, { headers });
  } catch (error) {
    return NextResponse.json({ written: true, role: null, unconfirmed: fleetctlMessage(error) }, { headers });
  }
}
