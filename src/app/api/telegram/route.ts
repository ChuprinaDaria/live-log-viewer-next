import { NextRequest, NextResponse } from "next/server";

import { rejectCrossOrigin } from "@/lib/sameOrigin";
import { saveTelegramApiCredentials, validTelegramApiCredentials } from "@/lib/telegram/packaging";
import { ensureTelegramReportScheduler } from "@/lib/telegram/reportRunner";
import { telegramService } from "@/lib/telegram/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The whole Telegram connection API (issue #1059), deliberately narrow:
 * status (GET, `?fresh=1` runs a health check) and eight actions (POST):
 * start, start_phone, code, password, credentials, cancel, logout, delete.
 * The `credentials` action (#1070) is the one inbound path that carries an
 * operator-entered secret (api_id + api_hash) — validated, then persisted
 * owner-only. Every RESPONSE is the sanitized TelegramStatusPayload plus the
 * account listing: no session string, no API credential, and no raw upstream
 * error ever leaves this boundary, in a GET payload or otherwise.
 *
 * Three inbound values are secrets in transit and are treated as such: the
 * phone number, the login code, and the 2FA password. None is echoed back,
 * none is logged here (nothing in this file logs at all), and none appears in
 * a refusal message — a rejected code answers "invalid_request", never the
 * digits that were rejected.
 *
 * A `slug` on an existing action names ONE enrolled account; without it the
 * action means the default slot, which is what the HQ's connector reads and
 * what every caller that predates named accounts still means.
 */

function failure(status: number, code: string, message: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Whether this request is about a NAMED account rather than the default slot. */
function namedSlug(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.trim() !== "default" ? value.trim() : null;
}

export async function GET(req: NextRequest) {
  try {
    /* The footer row polls this route from every open Viewer, which is what
       keeps the Daily Report scheduler (#1086) alive in this process and
       catches up a slot that passed while it was down. */
    ensureTelegramReportScheduler();
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    if (fresh) {
      const rejected = rejectCrossOrigin(req);
      if (rejected) return rejected;
    }
    const service = telegramService();
    const telegram = fresh ? await service.checkHealth() : service.status();
    /* The named accounts ride along with the status the footer already polls,
       so the channels page and the panel read one answer instead of two. */
    const { accounts, logins } = service.accounts();
    return NextResponse.json({ telegram, accounts, logins });
  } catch {
    return failure(500, "status_failed", "Telegram status is unavailable");
  }
}

export async function POST(req: NextRequest) {
  const rejected = rejectCrossOrigin(req);
  if (rejected) return rejected;
  let body: { action?: unknown; operationId?: unknown; password?: unknown; apiId?: unknown; apiHash?: unknown; slug?: unknown; phone?: unknown; code?: unknown };
  try { body = await req.json() as typeof body; } catch { return failure(400, "invalid_json", "Invalid JSON"); }
  const service = telegramService();
  try {
    switch (body.action) {
      case "start":
        return NextResponse.json({ telegram: await service.startLogin() }, { status: 202 });
      case "start_phone": {
        if (typeof body.slug !== "string" || typeof body.phone !== "string") {
          return failure(400, "invalid_request", "A slug and a phone number are required");
        }
        return NextResponse.json(await service.startPhoneLogin({
          slug: body.slug,
          phone: body.phone,
          ...(typeof body.apiId === "string" ? { apiId: body.apiId } : {}),
          ...(typeof body.apiHash === "string" ? { apiHash: body.apiHash } : {}),
        }), { status: 202 });
      }
      case "code": {
        if (typeof body.operationId !== "string" || typeof body.code !== "string") {
          return failure(400, "invalid_request", "Operation id and code are required");
        }
        return NextResponse.json(await service.submitCode(body.operationId, body.code));
      }
      case "password": {
        if (typeof body.operationId !== "string" || typeof body.password !== "string") {
          return failure(400, "invalid_request", "Operation id and password are required");
        }
        if (namedSlug(body.slug)) {
          return NextResponse.json(await service.submitPhonePassword(body.operationId, body.password));
        }
        return NextResponse.json({ telegram: await service.submitPassword(body.operationId, body.password) });
      }
      case "cancel": {
        if (typeof body.operationId !== "string") return failure(400, "invalid_request", "Operation id is required");
        if (namedSlug(body.slug)) {
          return NextResponse.json(await service.cancelPhoneLogin(body.operationId));
        }
        return NextResponse.json({ telegram: await service.cancelLogin(body.operationId) });
      }
      case "credentials": {
        /* #1070: operator-entered api_id/api_hash land in the same
           telegram.json the connector reads. Validation happens before any
           write, and the response is the ordinary sanitized status payload —
           the hash never comes back. */
        if (!validTelegramApiCredentials(body.apiId, body.apiHash)) {
          return failure(400, "invalid_credentials", "Telegram API credentials are invalid");
        }
        saveTelegramApiCredentials(body.apiId as string, body.apiHash as string);
        return NextResponse.json({ telegram: service.credentialsSaved() });
      }
      case "logout": {
        const slug = namedSlug(body.slug);
        if (slug) return NextResponse.json(await service.logoutAccount(slug));
        return NextResponse.json({ telegram: await service.logout() });
      }
      case "delete": {
        const slug = namedSlug(body.slug);
        if (slug) return NextResponse.json(await service.deleteAccount(slug));
        return NextResponse.json({ telegram: await service.deleteLocalSession() });
      }
      default:
        return failure(400, "invalid_action", "Unknown Telegram action");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram action failed";
    if (message === "a Telegram login operation is already running") return failure(409, "login_busy", message);
    if (message === "a Telegram login operation is running") return failure(409, "login_busy", message);
    if (message === "Telegram login operation is unavailable") return failure(404, "unknown_operation", message);
    if (message === "Telegram login is not awaiting a password") return failure(409, "not_awaiting_password", message);
    if (message === "Telegram login is not awaiting a code") return failure(409, "not_awaiting_code", message);
    if (message === "Telegram password is invalid") return failure(400, "invalid_request", message);
    /* Each of these names a FIELD, never its value: the rejected number and
       the rejected code do not travel back out in an error string. */
    if (message === "Telegram code is invalid") return failure(400, "invalid_request", message);
    if (message === "Telegram phone number is invalid") return failure(400, "invalid_request", message);
    if (message === "Telegram account slug is invalid") return failure(400, "invalid_request", message);
    if (message === "the default Telegram slot is read-only here") return failure(400, "invalid_request", message);
    return failure(500, "action_failed", "Telegram action failed");
  }
}
