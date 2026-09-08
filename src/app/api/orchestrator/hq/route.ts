import fs from "node:fs";
import os from "node:os";

import { NextRequest, NextResponse } from "next/server";

import { HQ_SESSION_CLASS, hqMcpServers } from "@/lib/agent/mcpAllowlist";
import { ensureOperatorSpawnCapability } from "@/lib/agent/operatorCapability";
import { internalServiceHeaders, requireOperatorAuthority } from "@/lib/agent/operatorAuthority";
import { executeSpawnRequest, productionSpawnCommandDependencies } from "@/lib/agent/spawnCommand";
import { VIEWER_SPAWN_CAPABILITY_HEADER } from "@/lib/agent/spawnPolicy";
import { HQ_PROJECT, HQ_PROMPT_VERSION, HQ_SPAWN_CONFIG, hqCwd, hqMandate, hqSshHosts, hqTelegramChat } from "@/lib/orchestrator/hq";
import { executeOrchestratorSeatRequest, productionSeatCommandDependencies } from "@/lib/orchestrator/seatCommand";
import { orchestratorSeatFor, type OrchestratorSeat } from "@/lib/orchestrator/seats";
import { rejectCrossOrigin } from "@/lib/sameOrigin";
import type { ApiError } from "@/lib/types";

/* The standing HQ seat (see `@/lib/orchestrator/hq`): its status, and the one
   confirm that seats it. Everything with behavior is the ordinary seat
   command; this route only fixes the project, the cwd, the mandate and the
   grant class, so the client sends a runtime choice and a request id. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

interface HqStatus {
  seat: OrchestratorSeat | null;
  pending: OrchestratorSeat | null;
  exists: boolean;
}

export async function GET(): Promise<NextResponse<HqStatus>> {
  const { active, pending } = orchestratorSeatFor(HQ_PROJECT);
  return NextResponse.json({
    seat: active,
    pending,
    exists: active !== null && (active.path === null || fs.existsSync(active.path)),
  }, { headers });
}

/** POST /api/spawn in-process with the HQ grant class: the only path that
    names it, so no request body can. */
async function spawnHq(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = {
    headers: new Headers({
      host: "127.0.0.1",
      ...internalServiceHeaders("orchestrator"),
      [VIEWER_SPAWN_CAPABILITY_HEADER]: ensureOperatorSpawnCapability(),
    }),
    json: async () => body,
  } as unknown as NextRequest;
  const response = await executeSpawnRequest(request, {
    ...productionSpawnCommandDependencies,
    internalGrant: () => ({ sessionClass: HQ_SESSION_CLASS, mcpServers: hqMcpServers() }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

export async function POST(req: NextRequest): Promise<NextResponse<Record<string, unknown> | ApiError>> {
  const rejection = rejectCrossOrigin(req);
  if (rejection) return rejection;
  const operator = requireOperatorAuthority(req);
  if (!operator.ok) return NextResponse.json({ error: operator.error }, { status: operator.status, headers });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers });
  }
  const mcpServers = hqMcpServers();
  const mandate = hqMandate({
    hostname: os.hostname(),
    sshHosts: hqSshHosts(),
    telegramChat: hqTelegramChat(),
    mcpServers,
  });
  const result = await executeOrchestratorSeatRequest({
    project: HQ_PROJECT,
    cwd: hqCwd(),
    mandate,
    promptVersion: HQ_PROMPT_VERSION,
    engine: typeof body.engine === "string" ? body.engine : HQ_SPAWN_CONFIG.engine,
    model: typeof body.model === "string" ? body.model : HQ_SPAWN_CONFIG.model,
    effort: typeof body.effort === "string" ? body.effort : HQ_SPAWN_CONFIG.effort,
    ...(typeof body.accountId === "string" && body.accountId ? { accountId: body.accountId } : {}),
    clientRequestId: body.clientRequestId,
  }, { ...productionSeatCommandDependencies, spawn: spawnHq }, { kind: "operator", conversationId: null, seatEpoch: null });
  return NextResponse.json(result.body, { status: result.status, headers });
}
