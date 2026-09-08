import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * Projects and subfolders, from the operator's console (`fleetctl`).
 *
 * A project belongs to a firm and may have a parent project — that is what a
 * subfolder is. `project_show` answers with the `effective` block: what MCP,
 * skills and rules apply here and WHERE each came from, so an inherited grant
 * is never presented as the project's own.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

function list(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const project = request.nextUrl.searchParams.get("project")?.trim();
  const firm = request.nextUrl.searchParams.get("firm")?.trim();
  try {
    if (project) {
      if (!SLUG.test(project)) return NextResponse.json({ error: "project id is invalid" }, { status: 400, headers });
      return NextResponse.json(await fleetctl({ fn: "project_show", params: { project } }), { headers });
    }
    return NextResponse.json(await fleetctl({ fn: "projects_list", params: firm && SLUG.test(firm) ? { firm } : {} }), { headers });
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
  const project = text(body.project);
  if (!project || !SLUG.test(project)) return NextResponse.json({ error: "project id is invalid" }, { status: 400, headers });
  const create = body.create === true;
  const firm = text(body.firm);
  if (create && (!firm || !SLUG.test(firm))) return NextResponse.json({ error: "a new project needs a firm" }, { status: 400, headers });
  const params = {
    project,
    ...(create ? { firm } : {}),
    name: text(body.name),
    note: text(body.note),
    path: text(body.path),
    /* An empty string is the console's own "unbind from the parent"; undefined
       leaves the parent alone. */
    ...(typeof body.parent === "string" ? { parent: body.parent.trim() } : {}),
    ...(create ? {} : { rules: list(body.rules), docs: list(body.docs), secrets: list(body.secrets) }),
  };
  try {
    await fleetctl({ fn: create ? "project_create" : "project_edit", params });
    return NextResponse.json(await fleetctl({ fn: "project_show", params: { project } }), { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}
