import type { AgentMention } from "./agentMentions";

export interface MentionBinding { token: string; id: string; name: string }
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A readable draft token with a separately persisted, immutable recipient.
 * Choosing another same-named agent gets another token, never a reassignment. */
export function bindAgentMention(bindings: readonly MentionBinding[], agent: AgentMention): MentionBinding {
  const existing = bindings.find((binding) => binding.id === agent.id);
  if (existing) return existing;
  const name = agent.name.replace(/[^\p{L}\p{N}_.'’\-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "agent";
  const base = `@${name}`;
  let token = base;
  for (let n = 2; bindings.some((binding) => binding.token === token); n++) token = `${base}-${n}`;
  return { token, id: agent.id, name: agent.name };
}

/** Resolve only explicitly chosen, complete tokens at the queue boundary.
 * The queued bytes carry the ID through reloads, renames and delivery retries. */
export function resolveAgentMentions(text: string, bindings: readonly MentionBinding[]): string {
  if (!bindings.length) return text;
  const byToken = new Map(bindings.map((binding) => [binding.token, binding]));
  const alternatives = [...byToken.keys()].sort((a, b) => b.length - a.length).map(escaped).join("|");
  return text.replace(new RegExp(`(^|\\s)(${alternatives})(?=$|\\s|[!?;:,.)])`, "gu"), (_match, prefix: string, token: string) => {
    const binding = byToken.get(token)!;
    const label = binding.name.replace(/\s+/g, " ").replace(/[\\`*_\[\]<>]/g, "\\$&");
    return `${prefix}[@${label}](#c=${encodeURIComponent(binding.id)})`;
  });
}

export function readMentionBindings(value: string | null): MentionBinding[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MentionBinding => item && typeof item === "object"
      && typeof item.token === "string" && /^@[^\s@]{1,64}$/u.test(item.token)
      && typeof item.id === "string" && item.id.length <= 128
      && typeof item.name === "string" && item.name.length <= 2000).slice(0, 100);
  } catch { return []; }
}
