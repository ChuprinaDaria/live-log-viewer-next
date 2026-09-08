import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlInstalled, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * The chats a project listens to.
 *
 * The operator picks an account from the ones already enrolled and pastes a
 * link — never a chat id. The console stores that intent; the collector fills
 * in the chat id, title and kind later, when it first reaches the chat. That
 * split is deliberate: resolving a link needs a live MTProto client, and the
 * console is standard-library-only, which is what lets it run anywhere.
 *
 * `?accounts=1` answers with what can actually read a chat. A bot token cannot:
 * a bot sees no history in a group it was not made admin of and cannot join a
 * stranger's channel from a link. The console splits the vault into usable and
 * not-usable with a reason, and this route passes that through rather than
 * offering a picker full of tokens that would silently collect nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const TARGET = /^(firm|project):[a-z0-9][a-z0-9_-]{0,63}$/;
const KINDS = ["telegram", "slack", "signal"] as const;

const isKind = (value: unknown): value is (typeof KINDS)[number] =>
  typeof value === "string" && (KINDS as readonly string[]).includes(value);

function noConsole(): NextResponse {
  return NextResponse.json(
    { error: "the operator console is not installed on this machine" },
    { status: 501, headers },
  );
}

/**
 * GET /api/channels                     every channel in the system
 * GET /api/channels?target=project:x    that node's own plus inherited
 * GET /api/channels?accounts=1          accounts that can read a chat
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!fleetctlInstalled()) return noConsole();
  const params = request.nextUrl.searchParams;

  try {
    if (params.get("accounts")) {
      const kind = params.get("kind")?.trim() || "telegram";
      if (!isKind(kind)) {
        return NextResponse.json({ error: "kind must be telegram, slack or signal" }, { status: 400, headers });
      }
      return NextResponse.json(await fleetctl({ fn: "channel_accounts", params: { kind } }), { headers });
    }

    const target = params.get("target")?.trim();
    if (target && !TARGET.test(target)) {
      return NextResponse.json({ error: "target must be firm:<id> or project:<id>" }, { status: 400, headers });
    }
    return NextResponse.json(
      await fleetctl({ fn: "channels_list", params: target ? { target } : {} }),
      { headers },
    );
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}

/**
 * POST /api/channels
 *
 *   { target, link, account, kind?, label? }   connect a chat
 *   { target, link, remove: true }             disconnect it
 *
 * The link is not validated here beyond being present: the console knows every
 * shape a Telegram or Slack link takes, and a second copy of those patterns
 * would be one more thing to keep in step.
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

  const target = typeof body.target === "string" ? body.target.trim() : "";
  const link = typeof body.link === "string" ? body.link.trim() : "";
  if (!TARGET.test(target)) {
    return NextResponse.json({ error: "target must be firm:<id> or project:<id>" }, { status: 400, headers });
  }
  if (!link) {
    return NextResponse.json({ error: "link is required" }, { status: 400, headers });
  }

  try {
    if (body.remove === true) {
      const result = await fleetctl({ fn: "channel_remove", params: { target, link } });
      const listed = await fleetctl({ fn: "channels_list", params: { target } });
      return NextResponse.json({ result, channels: listed }, { headers });
    }

    const account = typeof body.account === "string" ? body.account.trim() : "";
    if (!account) {
      return NextResponse.json({ error: "account is required" }, { status: 400, headers });
    }
    const kind = isKind(body.kind) ? body.kind : "telegram";
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : undefined;

    const result = await fleetctl({ fn: "channel_add", params: { target, link, account, kind, label } });
    const listed = await fleetctl({ fn: "channels_list", params: { target } });
    return NextResponse.json({ result, channels: listed }, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}
