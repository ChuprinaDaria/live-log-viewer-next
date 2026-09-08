import { NextRequest, NextResponse } from "next/server";

import { countArchive, readArchive, sessionmemInstalled } from "@/lib/archive/sessionmemArchive";
import { fleetctl, fleetctlMessage } from "@/lib/fleetctl/client";

/*
 * The session archive (task 9): sessionmem's summaries, read-only.
 *
 * `?count=1` answers how many sessions the archive holds — the console tree
 * shows that one number instead of listing them. `?project=<id>` narrows to a
 * console project by the checkout paths the console knows for it; a project
 * whose path the console cannot name gets an empty archive rather than
 * everybody else's sessions.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** The checkout paths the console knows for a project: `path` and, where the
    console records several, `paths`. Anything else is ignored rather than
    guessed at. */
function prefixesFrom(detail: unknown): string[] {
  if (typeof detail !== "object" || detail === null) return [];
  const record = detail as { path?: unknown; paths?: unknown };
  const found: string[] = [];
  const take = (value: unknown): void => {
    if (typeof value === "string" && value.trim().startsWith("/")) found.push(value.trim());
    else if (typeof value === "object" && value !== null) take((value as { path?: unknown }).path);
  };
  take(record.path);
  if (Array.isArray(record.paths)) for (const entry of record.paths) take(entry);
  return [...new Set(found)];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!sessionmemInstalled()) {
    return NextResponse.json({ error: "NOT_INSTALLED" }, { status: 503, headers });
  }
  const project = request.nextUrl.searchParams.get("project")?.trim() ?? "";
  const count = request.nextUrl.searchParams.get("count") === "1";
  if (project && !SLUG.test(project)) {
    return NextResponse.json({ error: "project id is invalid" }, { status: 400, headers });
  }

  let cwdPrefixes: string[] = [];
  if (project) {
    try {
      cwdPrefixes = prefixesFrom(await fleetctl({ fn: "project_show", params: { project } }));
    } catch (error) {
      return NextResponse.json({ error: fleetctlMessage(error) }, { status: 502, headers });
    }
    /* No path, no honest filter: an unbound project owns no sessions here. */
    if (cwdPrefixes.length === 0) {
      return NextResponse.json(count ? { count: 0 } : { cards: [], total: 0 }, { headers });
    }
  }

  try {
    /* A list answer carries how many sessions the filter matched as well as the
       page itself: the page is capped, and a screen that only knew its own
       length would silently drop the rest. */
    return NextResponse.json(
      count ? { count: await countArchive({ cwdPrefixes }) } : await readArchive({ cwdPrefixes }),
      { headers },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502, headers });
  }
}
