import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlInstalled, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * MCP servers and skills as the operator's console holds them — NOT the
 * Viewer's own MCP server, which lives in `src/lib/mcp` and answers agents.
 * The two share a word and nothing else, hence the route name.
 *
 * The console reads the registry the agent CLIs actually load, reports whether
 * each server is reachable, and says who each one is granted to: a firm, a
 * project, an agent role, or the fleet's own seats. Granting is the same verb
 * for servers and skills, so one route covers both and the UI does not grow
 * two nearly-identical pages.
 *
 * Values never travel. The console masks `env` and `headers` down to their key
 * names before anything leaves it, so a server can be shown, probed and
 * granted without its token being readable here or on the wire.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const KINDS = ["mcp", "skills"] as const;
type Kind = (typeof KINDS)[number];

const isKind = (value: unknown): value is Kind =>
  typeof value === "string" && (KINDS as readonly string[]).includes(value);

/** firm:<id> | project:<id> | agent:<role> | fleet:hq | fleet:worker */
const TARGET = /^((firm|project|agent):[a-z0-9][a-z0-9_-]{0,63}|fleet:(hq|worker))$/;

function noConsole(): NextResponse {
  return NextResponse.json(
    { error: "the operator console is not installed on this machine" },
    { status: 501, headers },
  );
}

/**
 * GET /api/mcp-registry            servers and skills, with who holds each
 * GET /api/mcp-registry?probe=0    skip the reachability check
 *
 * Probing is on by default because «is it up» is the question this page is
 * opened to answer; it is cheap by design — a binary that exists, a socket
 * that opens — and sends no authorization anywhere.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!fleetctlInstalled()) return noConsole();
  const probe = request.nextUrl.searchParams.get("probe") !== "0";
  try {
    const [servers, skills] = await Promise.all([
      fleetctl<Record<string, unknown>>({ fn: "mcp_list", params: { probe } }),
      fleetctl<Record<string, unknown>>({ fn: "skills_list" }),
    ]);
    return NextResponse.json({ ...servers, ...skills }, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}

/**
 * POST /api/mcp-registry
 *
 *   { kind, item, target }                 grant it
 *   { kind, item, target, revoke: true }   take it back
 *
 * `kind` is "mcp" or "skills"; `item` is a server name or a skill id. A skill
 * cannot be granted to `fleet:*` — those two targets are environment variables
 * the fleet server reads at startup and they carry MCP grants only. The console
 * enforces that; this route passes the refusal through rather than pre-judging
 * it, so there is one place that decides and not two.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rejection = rejectCrossOrigin(request);
  if (rejection) { rejection.headers.set("Cache-Control", "no-store"); return rejection; }
  if (!fleetctlInstalled()) return noConsole();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers });
  }

  if (!isKind(body.kind)) {
    return NextResponse.json({ error: "kind must be mcp or skills" }, { status: 400, headers });
  }
  const item = typeof body.item === "string" ? body.item.trim() : "";
  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (!item) return NextResponse.json({ error: "item is required" }, { status: 400, headers });
  if (!TARGET.test(target)) {
    return NextResponse.json(
      { error: "target must be firm:<id>, project:<id>, agent:<role>, fleet:hq or fleet:worker" },
      { status: 400, headers },
    );
  }

  const verb = body.revoke === true
    ? (body.kind === "mcp" ? "mcp_revoke" : "skill_revoke")
    : (body.kind === "mcp" ? "mcp_grant" : "skill_grant");

  try {
    const result = await fleetctl({ fn: verb, params: { target, item } });
    // Answer with the list the page should now render, so a grant and the view
    // of it cannot disagree. The probe is skipped here: nothing about a grant
    // changes whether a server is up, and the page already has that answer.
    const [servers, skills] = await Promise.all([
      fleetctl<Record<string, unknown>>({ fn: "mcp_list", params: { probe: false } }),
      fleetctl<Record<string, unknown>>({ fn: "skills_list" }),
    ]);
    return NextResponse.json({ result, ...servers, ...skills }, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}
