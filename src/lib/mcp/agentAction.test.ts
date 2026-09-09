import { expect, test } from "bun:test";
import { agentAction } from "./agentAction";

test("a successful tool response does not imply delivery", () => {
  for (const result of [{}, { ok: true }, { outcome: "unknown" }, { outcome: "settled" }]) {
    expect(agentAction("send_message", { text: "First\nSecond", conversationId: "conversation_a" }, result, "ok")).toMatchObject({ text: "First\nSecond", target: "conversation_a", state: "unknown" });
  }
});
test("queued, held, failed and delivered receipts stay distinct", () => {
  for (const [outcome, state] of [["queued", "queued"], ["held", "held"], ["delivered", "delivered"], ["not-executed", "failed"]] as const) {
    expect(agentAction("send_message", {}, { outcome }, "ok")?.state).toBe(state);
  }
  expect(agentAction("send_message", {}, { ok: false }, "ok")?.state).toBe("failed");
});
test("a spawn carries its prompt and identity, while unrelated tools use their ordinary cards", () => {
  expect(agentAction("spawn_agent", { prompt: "Do the task", title: "Worker" }, { conversationId: "conversation_a", launchId: "launch_a", state: "settled", initialMessage: "delivered" }, "ok")).toMatchObject({ kind: "spawn", text: "Do the task", title: "Worker", target: "conversation_a", state: "created" });
  expect(agentAction("send_message_to_orchestrator", { project: "project-a", text: "Report" }, null, "run")?.state).toBe("pending");
  expect(agentAction("exec_command", { cmd: "send_message" }, null, "ok")).toBeNull();
});

const spawnId = { conversationId: "conversation_a", launchId: "launch_a" };
for (const [result, expected] of [
  [{ ...spawnId, ok: true, state: "starting", initialMessage: "pending" }, "pending"],
  [{ ...spawnId, ok: true, state: "path-pending", initialMessage: "queued" }, "queued"],
  [{ ...spawnId, ok: true, state: "settled", initialMessage: "delivered" }, "created"],
  [{ ...spawnId, ok: true, outcome: "settled", state: "completed", launched: true }, "created"],
  [{ ...spawnId, ok: true, outcome: "settled", state: "conflicted", launched: false, reason: "Owner conflict" }, "failed"],
  [{ ...spawnId, ok: true, outcome: "settled", state: "failed", launched: false }, "failed"],
  [{ ...spawnId, ok: true, outcome: "settled", state: "completed", launched: false }, "failed"],
  [{ ...spawnId, ok: true, state: "starting", initialMessage: "pending", launched: false }, "pending"],
  [{ ...spawnId, ok: true, state: "completed", launched: true, rejection: "refused" }, "failed"],
  [{ ...spawnId, ok: true }, "unknown"],
] as const) {
  test(`spawn contract ${JSON.stringify(result)} is ${expected}`, () => {
    expect(agentAction("spawn_agent", { prompt: "Task" }, result, "ok")?.state).toBe(expected);
  });
}

test("unknown delivery evidence outranks an error envelope", () => {
  const result = { ok: false, code: "outcome_unknown", details: { outcome: "unknown", nextAction: "original-key-lookup", conversationId: "conversation_a" } };
  for (const status of ["ok", "err"] as const) {
    expect(agentAction("send_message", {}, result, status)).toMatchObject({ state: "unknown", target: "conversation_a" });
  }
});

test("legacy delivery acceptance is never confirmation before settlement", () => {
  expect(agentAction("send_message", {}, { ok: true, outcome: "delivered-to-live", settled: false }, "ok")?.state).toBe("queued");
  expect(agentAction("send_message", {}, { ok: true, outcome: "delivered-to-live" }, "ok")?.state).toBe("queued");
  expect(agentAction("send_message", {}, { ok: true, outcome: "delivered", settled: false }, "ok")?.state).toBe("unknown");
  expect(agentAction("send_message", {}, { ok: true, outcome: "settled", state: "delivered" }, "ok")?.state).toBe("delivered");
});
