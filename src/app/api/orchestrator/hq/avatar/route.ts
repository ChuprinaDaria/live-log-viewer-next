import fs from "node:fs/promises";

import { NextResponse } from "next/server";

import { hqAvatarFile } from "@/lib/orchestrator/hqIdentity";
import type { ApiError } from "@/lib/types";

/* The bytes behind the HQ room's signature. The URL carries the upload's
   timestamp (`?v=…`), so a replaced picture is a different URL and this
   response may be cached forever — which is what keeps an animated GIF from
   being refetched on every poll of the room. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ApiError> | NextResponse> {
  const avatar = hqAvatarFile();
  if (!avatar) return NextResponse.json({ error: "no avatar" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  let data: Buffer;
  try {
    data = await fs.readFile(avatar.path);
  } catch {
    return NextResponse.json({ error: "no avatar" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": avatar.mime,
      "Content-Length": String(data.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
