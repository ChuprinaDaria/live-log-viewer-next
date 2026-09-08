import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextRequest, NextResponse } from "next/server";

import { rejectCrossOrigin } from "@/lib/sameOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/*
 * A portable brief of one conversation, from the operator's sessionmem
 * (TZ-UI.md: session transfer). sessionmem indexes the transcript incrementally
 * (stdlib only, no model) and writes the brief from what it holds: situation,
 * first prompt, files touched, last exchange — plus the summary card when one
 * exists. The brief becomes the first prompt of a new draft, which the operator
 * launches on any engine or account the Viewer offers.
 */

const SESSIONMEM_DIR = process.env.SESSIONMEM_DIR ?? path.join(os.homedir(), "work", "sessionmem");

const SCRIPT = `
import json, sys
sys.path.insert(0, "lib")
import index, brief
transcript, target = sys.argv[1], sys.argv[2]
db = index.connect()
def find():
    return db.execute("SELECT session_id FROM sessions WHERE transcript_path = ?", (transcript,)).fetchone()
row = find()
if not row:
    index.run()
    row = find()
if not row:
    print(json.dumps({"error": "NOT_INDEXED"})); sys.exit(0)
text = brief.make(db, row[0], target)
print(json.dumps({"sessionId": row[0], "brief": text or ""}, ensure_ascii=False))
`;

function runBrief(transcript: string, target: "claude" | "codex"): Promise<{ sessionId: string; brief: string } | { error: string }> {
  return new Promise((resolve) => {
    execFile("python3", ["-c", SCRIPT, transcript, target], { cwd: SESSIONMEM_DIR, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: `sessionmem: ${(stderr || error.message).trim().split("\n").pop() ?? "failed"}` });
        return;
      }
      const line = stdout.trim().split("\n").pop() ?? "";
      try {
        resolve(JSON.parse(line) as { sessionId: string; brief: string } | { error: string });
      } catch {
        resolve({ error: "sessionmem: unreadable answer" });
      }
    });
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rejection = rejectCrossOrigin(request);
  if (rejection) { rejection.headers.set("Cache-Control", "no-store"); return rejection; }
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    // fall through to the shape check
  }
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  const transcript = typeof record?.path === "string" ? record.path : "";
  const target = record?.target === "codex" ? "codex" : "claude";
  if (!transcript.trim() || !path.isAbsolute(transcript) || !transcript.endsWith(".jsonl")) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400, headers });
  }
  if (!fs.existsSync(path.join(SESSIONMEM_DIR, "bin", "sessionmem"))) {
    return NextResponse.json({ error: "SESSIONMEM_MISSING" }, { status: 501, headers });
  }
  const result = await runBrief(transcript, target);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "NOT_INDEXED" ? 404 : 502, headers });
  }
  if (!result.brief.trim()) return NextResponse.json({ error: "EMPTY_BRIEF" }, { status: 502, headers });
  return NextResponse.json(result, { headers });
}
