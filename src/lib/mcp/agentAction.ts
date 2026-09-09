export type AgentActionState = "pending" | "queued" | "held" | "delivered" | "failed" | "unknown" | "created";

type Evidence = Record<string, unknown>;
const record = (v: unknown): Evidence => v && typeof v === "object" && !Array.isArray(v) ? v as Evidence : {};
const text = (v: unknown): string => typeof v === "string" ? v : "";

/** Spawn bindings publish starting/path-pending/settled + initialMessage;
 * recovery publishes receipt state + launched. A conversation ID is reserved
 * before launch, so its mere presence is never evidence of a created agent. */
function spawnState(result: Evidence): AgentActionState {
  const state = text(result.state);
  if (result.rejection || ["failed", "conflicted"].includes(state) || result.initialMessage === "failed") return "failed";
  if (state === "starting") return "pending";
  if (result.launched === false && (result.outcome === "settled" || ["settled", "completed"].includes(state))) return "failed";
  if (text(result.conversationId) && text(result.launchId)) {
    if (state === "completed" && result.launched === true) return "created";
    if (state === "settled" && result.initialMessage === "delivered" && result.launched !== false) return "created";
  }
  if (["path-pending", "host-verified", "prompt-delivered"].includes(state)
    || ["accepted", "in-flight"].includes(text(result.outcome))) return "queued";
  return "unknown";
}

function messageState(result: Evidence): AgentActionState {
  const outcome = text(result.state) || text(result.outcome);
  if (outcome === "delivered") return result.settled === false ? "unknown" : "delivered";
  if (outcome === "held") return "held";
  // Legacy dispatch names acknowledge acceptance. Only the durable delivered
  // receipt (or its recovery state) establishes arrival.
  if (["queued", "accepted", "in-flight", "delivering", "pending", "delivered-to-live", "resumed", "reconfigured"].includes(outcome)) return "queued";
  return "unknown";
}

/** Tool completion is not proof of message arrival. Preserve the recorded
 * receipt outcome without polling, retrying or dispatching from the feed. */
export function agentAction(tool: string, argsValue: unknown, resultValue: unknown, status: "run" | "ok" | "err") {
  const kind = tool === "spawn_agent" ? "spawn" : ["send_message", "send_message_to_orchestrator"].includes(tool) ? "message" : null;
  if (!kind) return null;
  const args = record(argsValue);
  const envelope = record(resultValue);
  // Recovery refusals carry their evidence/IDs inside details; normal answers
  // publish it at the top level. Never infer failure from ok:false before
  // checking the explicit uncertainty contract.
  const result = { ...record(envelope.details), ...envelope };
  const outcomes = [text(result.state), text(result.outcome)];
  let state: AgentActionState;
  if (result.code === "outcome_unknown" || outcomes.includes("unknown")) state = "unknown";
  else if (status === "err" || result.ok === false || outcomes.some((value) => ["failed", "not-executed", "error", "conflicted"].includes(value))) state = "failed";
  else if (status === "run") state = "pending";
  else state = kind === "spawn" ? spawnState(result) : messageState(result);
  return {
    kind, state,
    text: text(args[kind === "spawn" ? "prompt" : "text"]),
    title: text(args.title),
    target: text(result.conversationId) || text(args.conversationId),
    path: text(result.transcriptPath) || text(args.transcriptPath),
    project: text(args.project),
  };
}
