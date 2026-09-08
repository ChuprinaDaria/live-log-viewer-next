import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlInstalled, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * Claude's permission rules, read and written through the operator's console.
 *
 * Permissions are the one thing standing between an agent and the machine, so
 * they are not edited as raw JSON on a phone: the console owns the write, and
 * it is the console that refuses to put `Bash(sudo:*)` into allow without an
 * explicit confirm, refuses to lift a protective deny without force, and
 * records every change in its audit log with the actor's name.
 *
 * Three levels, inherited: firm → project → machine. `perms_show` on a project
 * answers with provenance, so the page can say WHERE a rule came from instead
 * of leaving the operator to guess why an agent may run something.
 *
 * There is no fallback here, unlike the role catalog. A permission page that
 * invents an answer when the console is missing would be worse than one that
 * says it cannot reach it: the operator would act on a picture of rules that
 * are not the rules in force.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const BUCKETS = ["allow", "deny", "ask"] as const;
const TARGET = /^(machine|(firm|project):[a-z0-9][a-z0-9_-]{0,63})$/;

type Bucket = (typeof BUCKETS)[number];

const isBucket = (value: unknown): value is Bucket =>
  typeof value === "string" && (BUCKETS as readonly string[]).includes(value);

function noConsole(): NextResponse {
  return NextResponse.json(
    { error: "the operator console is not installed on this machine" },
    { status: 501, headers },
  );
}

/** GET /api/permissions?target=machine|firm:<id>|project:<id> */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!fleetctlInstalled()) return noConsole();
  const target = request.nextUrl.searchParams.get("target")?.trim() || "machine";
  if (!TARGET.test(target)) {
    return NextResponse.json(
      { error: "target must be machine, firm:<id> or project:<id>" },
      { status: 400, headers },
    );
  }
  try {
    return NextResponse.json(await fleetctl({ fn: "perms_show", params: { target } }), { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}

/**
 * POST /api/permissions
 *
 *   { target, bucket, rule }                 add a rule
 *   { target, bucket, rule, remove: true }   take one away
 *   { mode }                                 the machine's default mode
 *   { applyProject }                         write a project's effective set
 *
 * `confirm` and `force` are passed through rather than interpreted: the console
 * decides what is dangerous, and duplicating that judgement here would give two
 * places to keep in step and one of them would drift.
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

  try {
    if (typeof body.mode === "string") {
      return NextResponse.json(
        await fleetctl({ fn: "perm_mode", params: { mode: body.mode.trim() } }),
        { headers },
      );
    }

    if (typeof body.applyProject === "string") {
      return NextResponse.json(
        await fleetctl({ fn: "perms_apply", params: { project: body.applyProject.trim() } }),
        { headers },
      );
    }

    const target = typeof body.target === "string" ? body.target.trim() : "";
    const rule = typeof body.rule === "string" ? body.rule.trim() : "";
    if (!TARGET.test(target)) {
      return NextResponse.json(
        { error: "target must be machine, firm:<id> or project:<id>" },
        { status: 400, headers },
      );
    }
    if (!isBucket(body.bucket)) {
      return NextResponse.json({ error: "bucket must be allow, deny or ask" }, { status: 400, headers });
    }
    if (!rule) {
      return NextResponse.json({ error: "rule is required" }, { status: 400, headers });
    }

    const result = body.remove === true
      ? await fleetctl({
          fn: "perm_remove",
          params: { target, bucket: body.bucket, rule, force: body.force === true ? true : undefined },
        })
      : await fleetctl({
          fn: "perm_add",
          params: { target, bucket: body.bucket, rule, confirm: body.confirm === true ? true : undefined },
        });

    // Answer with the state the page should now render, not just the delta:
    // one round trip, and no chance of the view disagreeing with the store.
    const shown = await fleetctl({ fn: "perms_show", params: { target } });
    return NextResponse.json({ result, permissions: shown }, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}
