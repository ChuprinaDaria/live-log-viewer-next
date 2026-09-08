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
  expect(agentAction("spawn_agent", { prompt: "Do the task", title: "Worker" }, { conversationId: "conversation_a" }, "ok")).toMatchObject({ kind: "spawn", text: "Do the task", title: "Worker", target: "conversation_a", state: "created" });
  expect(agentAction("send_message_to_orchestrator", { project: "project-a", text: "Report" }, null, "run")?.state).toBe("pending");
  expect(agentAction("exec_command", { cmd: "send_message" }, null, "ok")).toBeNull();
});
