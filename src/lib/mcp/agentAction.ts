export type AgentActionState = "pending" | "queued" | "held" | "delivered" | "failed" | "unknown" | "created";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): string => typeof v === "string" ? v : "";

/** Tool completion is not proof of message arrival. Preserve the recorded
 * receipt outcome without polling, retrying or dispatching from the feed. */
export function agentAction(tool: string, argsValue: unknown, resultValue: unknown, status: "run" | "ok" | "err") {
  const kind = tool === "spawn_agent" ? "spawn" : ["send_message", "send_message_to_orchestrator"].includes(tool) ? "message" : null;
  if (!kind) return null;
  const args = record(argsValue);
  const result = record(resultValue);
  const outcome = text(result.state) || text(result.outcome);
  let state: AgentActionState = "unknown";
  if (status === "err" || result.ok === false || ["failed", "not-executed", "error"].includes(outcome)) state = "failed";
  else if (status === "run") state = "pending";
  else if (["delivered", "delivered-to-live"].includes(outcome)) state = "delivered";
  else if (outcome === "held") state = "held";
  else if (["queued", "accepted", "in-flight", "delivering"].includes(outcome)) state = "queued";
  else if (kind === "spawn" && text(result.conversationId) && !["unknown", "settled"].includes(outcome)) state = "created";
  return {
    kind, state,
    text: text(args[kind === "spawn" ? "prompt" : "text"]),
    title: text(args.title),
    target: text(result.conversationId) || text(args.conversationId),
    path: text(result.transcriptPath) || text(args.transcriptPath),
    project: text(args.project),
  };
}
