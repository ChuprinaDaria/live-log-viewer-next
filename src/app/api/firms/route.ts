import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * Firms, from the operator's console (`fleetctl`), which owns the org store.
 *
 * A firm holds rules, docs, its own credentials, and the MCP servers and
 * skills granted to it; its projects inherit downward. PEOPLE are a field on
 * the firm — Даша, Костя — and are NOT a level of the hierarchy and NOT
 * projects, which is the one thing this layer keeps getting wrong.
 *
 * GET lists firms, or shows one with `?firm=<id>`. POST creates or edits,
 * always through the console, so the CLI, the MCP server and this page write
 * the same store the same way, with the same validation and audit line.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** A comma list from the browser, as the console's CLI expects it. Absent
    means "leave alone"; an empty array clears the field. */
function list(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const firm = request.nextUrl.searchParams.get("firm")?.trim();
  try {
    if (firm) {
      if (!SLUG.test(firm)) return NextResponse.json({ error: "firm id is invalid" }, { status: 400, headers });
      return NextResponse.json(await fleetctl({ fn: "firm_show", params: { firm } }), { headers });
    }
    return NextResponse.json(await fleetctl({ fn: "firms_list" }), { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rejection = rejectCrossOrigin(request);
  if (rejection) { rejection.headers.set("Cache-Control", "no-store"); return rejection; }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers });
  }
  const firm = text(body.firm);
  if (!firm || !SLUG.test(firm)) return NextResponse.json({ error: "firm id is invalid" }, { status: 400, headers });
  const create = body.create === true;
  const params = {
    firm,
    name: text(body.name),
    note: text(body.note),
    people: list(body.people),
    ...(create ? {} : { rules: list(body.rules), docs: list(body.docs), secrets: list(body.secrets) }),
  };
  try {
    await fleetctl({ fn: create ? "firm_create" : "firm_edit", params });
    return NextResponse.json(await fleetctl({ fn: "firm_show", params: { firm } }), { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}
