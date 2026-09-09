import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, mock, test } from "bun:test";

/*
 * The seat must not wait on the operator's console — transitively either.
 *
 * The synchronous resolve inside the seat command was never the whole path: it
 * hands a `role: "orchestrator"` body to the spawn command, and the spawn
 * command is what reads the console catalog. So a console that is missing,
 * refusing, hanging or answering nonsense could stop a seat from being taken
 * and a rotation from completing — and then nothing is left that could launch
 * the agent which would repair the console.
 *
 * A bounded wait is not the fix either: `fleetctl/client.ts` allows 20 s per
 * call, and a seat that takes 40 s to fail is a stopped rotation. The
 * requirement is ZERO console calls, so every scenario below asserts the count
 * rather than the latency.
 *
 * The counter is proven able to fire: the last case runs the same launch on the
 * default (catalog) resolution and requires the calls it deliberately omits
 * everywhere else.
 */

const previousStateDir = process.env.LLV_STATE_DIR;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "llv-seat-console-"));
process.env.LLV_STATE_DIR = path.join(sandbox, "state");

const actualClient = await import("@/lib/fleetctl/client");
type Console = "missing" | "failing" | "hanging" | "corrupt" | "healthy";
let consoleState: Console = "healthy";
let calls: string[] = [];
mock.module("@/lib/fleetctl/client", () => ({
  ...actualClient,
  fleetctlInstalled: () => {
    calls.push("installed?");
    return consoleState !== "missing";
  },
  fleetctl: async (call: { fn: string; params?: { role?: string } }) => {
    calls.push(call.fn);
    if (consoleState === "missing") throw new actualClient.FleetctlError("MISSING", "fleetctl is not installed on this machine");
    if (consoleState === "failing") throw new actualClient.FleetctlError("FAILED", "console unavailable");
    /* A console that never answers. Any path that awaits it hangs the test
       instead of quietly taking 20 seconds in production. */
    if (consoleState === "hanging") return new Promise(() => {});
    if (consoleState === "corrupt") {
      if (call.fn === "roles_list") return { roles: [{ id: "orchestrator" }] };
      return { id: "orchestrator", config: { engine: "kettle", model: "", effort: "" } };
    }
    if (call.fn === "roles_list") return { roles: [{ id: "orchestrator" }, { id: "custom-scribe" }] };
    if (call.params?.role === "custom-scribe") {
      return { id: "custom-scribe", name: "Scribe", origin: "local", config: { engine: "codex", model: "gpt-5.6-terra", effort: "high" }, promptScaffold: "Write the release note" };
    }
    return { id: "orchestrator", config: { engine: "claude", model: "opus", effort: "high" }, promptScaffold: "Console orchestrator scaffold" };
  },
}));

import type { SpawnCommandDependencies } from "@/lib/agent/spawnCommand";

const { executeSpawnRequest, localRoleResolution } = await import("@/lib/agent/spawnCommand");

afterAll(() => {
  mock.module("@/lib/fleetctl/client", () => actualClient);
  if (previousStateDir === undefined) delete process.env.LLV_STATE_DIR;
  else process.env.LLV_STATE_DIR = previousStateDir;
  fs.rmSync(sandbox, { recursive: true, force: true });
});
beforeEach(() => { calls = []; });

/** Where a launch stops in this test: everything after role resolution is a
    stub, so the request can only reach the registry or fail before it. */
const BOUNDARY = "runtime boundary reached";

function request(body: Record<string, unknown>) {
  return {
    headers: new Headers({ host: "127.0.0.1" }),
    json: async () => body,
  } as unknown as Parameters<typeof executeSpawnRequest>[0];
}

function dependencies(over: Partial<SpawnCommandDependencies>): SpawnCommandDependencies {
  return {
    registry: () => { throw new Error(BOUNDARY); },
    resolveHealthySpawnAccount: () => { throw new Error(BOUNDARY); },
    resolveSpawnAccount: () => { throw new Error(BOUNDARY); },
    runtimeHostClient: () => { throw new Error(BOUNDARY); },
    spawnStructuredConversation: () => { throw new Error(BOUNDARY); },
    assertStructuredRuntime: () => { throw new Error(BOUNDARY); },
    defer: () => {},
    storeImages: () => [],
    ...over,
  } as unknown as SpawnCommandDependencies;
}

/** Run one launch and report what the console saw. Everything after role
    resolution is stubbed, so a launch that "reaches the boundary" is a launch
    whose role resolved. */
async function launch(over: Partial<SpawnCommandDependencies>, role = "orchestrator"): Promise<{ status: number; error: string; calls: string[] }> {
  let status = 0;
  let error = "";
  try {
    const response = await executeSpawnRequest(request({
      role,
      ...(role === "orchestrator" ? { roleParams: { mode: "standard" } } : {}),
      cwd: sandbox,
      /* Bracketed like every other spawn body in this repo: a bare `prompt:` at
         the start of a line reads as pasted transcript to the publication gate. */
      ["prompt"]: "Hold the seat",
      title: "Hold the seat for this project",
    }), dependencies(over));
    status = response.status;
    error = String((await response.json() as { error?: string }).error ?? "");
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }
  return { status, error, calls: [...calls] };
}

for (const state of ["missing", "failing", "hanging", "corrupt"] as Console[]) {
  test(`a seat launch asks a ${state} console nothing at all`, async () => {
    consoleState = state;
    const result = await launch({ resolveRole: localRoleResolution });
    expect(result.calls).toEqual([]);
    /* And the launch got PAST role resolution: it failed at the stubbed
       runtime boundary, not on the role. A refusal to resolve `orchestrator`
       is the outage this test exists to prevent. */
    expect(result.error).not.toContain("unknown role");
    expect(result.error).not.toContain("console");
    expect(result.status).not.toBe(400);
  });
}

test("the console-backed resolution really does call the console, so the count above means something", async () => {
  consoleState = "healthy";
  const result = await launch({});
  expect(result.calls).toContain("roles_list");
  expect(result.calls).toContain("role_show");
  expect(result.error).not.toContain("unknown role");
});

test("an operator launch keeps the console catalog, so an additional role still launches", async () => {
  consoleState = "healthy";
  /* The seam narrows the seat path and nothing else: the shared catalog stays
     the default, which is what makes an additional console role launchable at
     all — the whole point of §1.1. */
  const operator = await launch({}, "custom-scribe");
  expect(operator.calls).toContain("roles_list");
  expect(operator.error).not.toContain("unknown role");
  expect(operator.error).toContain(BOUNDARY);
  /* And under the seat's local resolution the same id is honestly refused
     rather than silently launched from a stale definition. */
  calls = [];
  const seat = await launch({ resolveRole: localRoleResolution }, "custom-scribe");
  expect(seat.calls).toEqual([]);
  expect(seat.error).toContain("unknown role");
  expect(seat.status).toBe(400);
});

/*
 * The wiring itself, not just the seam: the seat's own in-process spawn is what
 * has to carry the local resolution. It is called here for real, so an edit
 * that drops the dependency fails this test rather than leaving a seam nothing
 * uses.
 *
 * Downstream of role resolution this is the production path, and in this
 * sandbox it has no account, no runtime host and an empty registry under a temp
 * `LLV_STATE_DIR` — so the launch does not finish. That does not weaken the
 * claim: role resolution is the FIRST thing the spawn command does with a
 * `role` body, and a refusal there returns a 400 immediately. Reaching a
 * downstream stall with the console untouched is exactly the evidence wanted.
 */
test("the seat's own in-process spawn carries the local resolution", async () => {
  const { productionSeatCommandDependencies } = await import("./seatCommand");
  for (const state of ["failing", "hanging", "missing"] as Console[]) {
    consoleState = state;
    calls = [];
    let settled: string | null = null;
    const attempt = productionSeatCommandDependencies
      .spawn({
        role: "orchestrator",
        roleParams: { mode: "standard" },
        cwd: sandbox,
        /* Bracketed like every other spawn body in this repo: a bare `prompt:` at
           the start of a line reads as pasted transcript to the publication gate. */
        ["prompt"]: "Hold the seat",
        title: "Hold the seat for this project",
        clientAttemptId: `seat-console-${state}`,
      })
      .then((answer) => { settled = String(answer.body.error ?? ""); })
      .catch((thrown: unknown) => { settled = thrown instanceof Error ? thrown.message : String(thrown); });
    /* Long enough for the whole synchronous admission preamble and any console
       call it might make; short enough that the downstream stall does not stall
       the suite. */
    await Promise.race([attempt, new Promise((resolve) => setTimeout(resolve, 1_200))]);
    expect(calls, `console calls with a ${state} console`).toEqual([]);
    if (settled !== null) expect(settled).not.toContain("unknown role");
  }
});
