import { NextRequest, NextResponse } from "next/server";

import {
  clearHqAvatar,
  InvalidHqAvatarError,
  InvalidHqNameError,
  readHqIdentity,
  writeHqAvatar,
  writeHqName,
  type HqIdentity,
} from "@/lib/orchestrator/hqIdentity";
import { HQ_AVATAR_MAX_BYTES } from "@/lib/orchestrator/hqIdentityShared";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/* The signature the HQ room puts on the orchestrator's messages: a name, and
   an optional picture the operator uploads from the dashboard. The bytes never
   travel in this route's answers — only the URL of the avatar route, stamped
   with the upload's timestamp so a replaced picture is a different URL and the
   immutable cache below is honest. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

interface HqIdentityView {
  name: string;
  avatarUrl: string | null;
}

interface HqIdentityRefusal {
  error: string;
  code: "invalid_json" | "name_invalid" | "avatar_type" | "avatar_size" | "avatar_mismatch";
}

function view(identity: HqIdentity): HqIdentityView {
  return {
    name: identity.name,
    avatarUrl: identity.avatar
      ? `/api/orchestrator/hq/avatar?v=${encodeURIComponent(identity.avatar.updatedAt)}`
      : null,
  };
}

export async function GET(): Promise<NextResponse<HqIdentityView>> {
  return NextResponse.json(view(readHqIdentity()), { headers });
}

/** Raw byte count a base64 string decodes to, without decoding it: an
    over-budget upload is refused before it becomes a Buffer. */
function rawBytesFromBase64(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

function refuse(refusal: HqIdentityRefusal, status: 400 | 413): NextResponse<HqIdentityRefusal> {
  return NextResponse.json(refusal, { status, headers });
}

export async function POST(req: NextRequest): Promise<NextResponse<HqIdentityView | HqIdentityRefusal>> {
  const rejection = rejectCrossOrigin(req);
  if (rejection) return rejection as NextResponse<HqIdentityRefusal>;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* A body that is not JSON says nothing about the name — the client shows
       its generic failure rather than «Імʼя: 1–40 символів». */
    return refuse({ error: "invalid JSON", code: "invalid_json" }, 400);
  }

  let identity = readHqIdentity();

  if (typeof body.name === "string") {
    try {
      identity = writeHqName(body.name);
    } catch (error) {
      if (error instanceof InvalidHqNameError) return refuse({ error: error.message, code: "name_invalid" }, 400);
      throw error;
    }
  }

  if (body.clearAvatar === true) identity = clearHqAvatar();

  if (body.avatar !== undefined && body.avatar !== null) {
    const avatar = body.avatar as Record<string, unknown>;
    if (typeof avatar.mime !== "string" || typeof avatar.base64 !== "string") {
      return refuse({ error: "avatar must carry a mime and base64", code: "avatar_type" }, 400);
    }
    if (rawBytesFromBase64(avatar.base64) > HQ_AVATAR_MAX_BYTES) {
      return refuse({ error: "avatar is too large", code: "avatar_size" }, 413);
    }
    /* Decoded ONCE, here: the bytes are large enough that a second pass (or a
       re-encode to compare) is a real cost on this box. */
    const data = Buffer.from(avatar.base64, "base64");
    if (data.byteLength === 0) return refuse({ error: "avatar could not be read", code: "avatar_mismatch" }, 400);
    try {
      identity = writeHqAvatar({ mime: avatar.mime, data });
    } catch (error) {
      if (error instanceof InvalidHqAvatarError) {
        if (error.reason === "size") return refuse({ error: error.message, code: "avatar_size" }, 413);
        return refuse({ error: error.message, code: error.reason === "type" ? "avatar_type" : "avatar_mismatch" }, 400);
      }
      throw error;
    }
  }

  return NextResponse.json(view(identity), { headers });
}
