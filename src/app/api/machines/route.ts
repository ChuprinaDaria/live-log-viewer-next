import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlInstalled, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * The machines an agent can be started on, and starting one there.
 *
 * Not to be confused with `/api/runtime/hosts`, which kills a local PROCESS.
 * A machine here is a box: walter, the desktop, whatever else is in the
 * console's registry. Until now the Viewer had no such concept at all — the
 * only mention of another machine anywhere was a sentence in the orchestrator's
 * prompt telling it that ssh exists.
 *
 * Spawning goes through the console rather than being reimplemented here,
 * because the hard parts are not in the HTTP layer: finding the engine's real
 * path when a login shell's PATH does not carry it, isolating the account into
 * its own CLAUDE_CONFIG_DIR so the machine's other agents keep their
 * credentials, and refusing when the project's directory does not exist on
 * that machine instead of cloning something blind.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/* tmux session names are not slugs: they routinely carry dots and capitals. */
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENGINES = ["claude", "codex"] as const;

function noConsole(): NextResponse {
  return NextResponse.json(
    { error: "the operator console is not installed on this machine" },
    { status: 501, headers },
  );
}

/**
 * GET /api/machines                    the registry, each machine probed
 * GET /api/machines?probe=0            the list without reaching for anything
 * GET /api/machines?host=x&accounts=1  which accounts exist on that machine
 * GET /api/machines?host=x&sessions=1  which tmux sessions run there now
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!fleetctlInstalled()) return noConsole();
  const params = request.nextUrl.searchParams;
  const host = params.get("host")?.trim();

  if (host && !SLUG.test(host)) {
    return NextResponse.json({ error: "host must be a slug" }, { status: 400, headers });
  }

  try {
    if (host && params.get("accounts")) {
      return NextResponse.json(await fleetctl({ fn: "session_accounts", params: { host } }), { headers });
    }
    if (host && params.get("sessions")) {
      return NextResponse.json(await fleetctl({ fn: "sessions_on", params: { host } }), { headers });
    }
    if (host) {
      return NextResponse.json(await fleetctl({ fn: "host_check", params: { host } }), { headers });
    }
    /* Probing costs an ssh round trip per machine, and a sleeping desktop
       spends the full timeout. The list is still useful without it, so the
       caller can ask for the cheap answer. */
    const probe = params.get("probe") !== "0";
    return NextResponse.json(
      await fleetctl({ fn: "hosts_list", params: { probe, engines: probe } }),
      { headers },
    );
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}

/**
 * POST /api/machines
 *
 *   { host, project, engine?, account?, model?, prompt?, name?, cwd? }
 *       start a session on that machine
 *
 *   { session, host, project, from_host?, ... }
 *       move an existing session to that machine — `host` is the destination
 *
 * The two are one route because they are one intent with one difference: a
 * transfer carries a brief from where the work already happened. Splitting
 * them would have duplicated every field for the sake of the verb.
 *
 * The prompt travels over stdin: a first prompt is routinely longer than an
 * argument list should carry, and the console documents that trap itself.
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

  const host = typeof body.host === "string" ? body.host.trim() : "";
  const project = typeof body.project === "string" ? body.project.trim() : "";
  if (!SLUG.test(host)) return NextResponse.json({ error: "host is required" }, { status: 400, headers });
  if (!SLUG.test(project)) return NextResponse.json({ error: "project is required" }, { status: 400, headers });

  const engine = typeof body.engine === "string" && (ENGINES as readonly string[]).includes(body.engine)
    ? body.engine
    : "claude";
  const text = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const params = {
    host, project, engine,
    account: text(body.account),
    model: text(body.model),
    name: text(body.name),
    cwd: text(body.cwd),
  };
  const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt : undefined;

  /* Moving a session rather than starting one. The console reads the brief on
     the source machine and starts the work on the target; nothing here tries
     to move a running process, because a process is not what is worth moving. */
  const session = typeof body.session === "string" ? body.session.trim() : "";
  if (body.session !== undefined && !SESSION.test(session)) {
    return NextResponse.json({ error: "session must be a tmux session name" }, { status: 400, headers });
  }
  const fromHost = text(body.from_host);
  if (fromHost !== undefined && !SLUG.test(fromHost)) {
    return NextResponse.json({ error: "from_host must be a machine name" }, { status: 400, headers });
  }

  try {
    if (session) {
      /* The console names the destination `to_host`; passing `host` as well
         would be a field it does not know. */
      const { host: _destination, ...rest } = params;
      const moved = await fleetctl({
        fn: "session_transfer",
        params: { ...rest, session, to_host: host, from_host: fromHost },
      });
      return NextResponse.json(moved, { headers });
    }
    const result = await fleetctl(prompt === undefined
      ? { fn: "session_spawn", params }
      : { fn: "session_spawn", params, stdinParam: "prompt", stdinValue: prompt });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}
