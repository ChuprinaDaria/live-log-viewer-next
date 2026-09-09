import { agentMentionLink, agentMentionName, MENTION_NAME_CHARACTERS, type AgentMention } from "./agentMentions";

export interface MentionBinding { token: string; id: string; name: string }

/** A readable draft token with a separately persisted, immutable recipient.
 * Choosing another same-named agent gets another token, never a reassignment. */
export function bindAgentMention(bindings: readonly MentionBinding[], agent: AgentMention): MentionBinding {
  const existing = bindings.find((binding) => binding.id === agent.id);
  if (existing) return existing;
  const base = `@${agentMentionName(agent.name)}`;
  let token = base;
  for (let n = 2; bindings.some((binding) => binding.token === token); n++) token = `${base}-${n}`;
  return { token, id: agent.id, name: agent.name };
}

/** Resolve only explicitly chosen, complete tokens at the queue boundary.
 * The queued bytes carry the ID through reloads, renames and delivery retries. */
export function resolveAgentMentions(text: string, bindings: readonly MentionBinding[]): string {
  if (!bindings.length) return text;
  const byToken = new Map(bindings.map((binding) => [binding.token, binding]));
  const tokens = new RegExp(`(?<![${MENTION_NAME_CHARACTERS}@])@[${MENTION_NAME_CHARACTERS}]+`, "gu");
  return text.replace(tokens, (token, offset: number) => {
    const binding = byToken.get(token);
    if (!binding) return token;
    // Already serialized links can be pasted or restored from an outbox. Do
    // not turn their label into a nested link or override their explicit ID.
    if (text[offset - 1] === "[" && text.slice(offset + token.length).startsWith("](")) return token;
    return agentMentionLink(binding.token, binding.id);
  });
}

export function readMentionBindings(value: string | null): MentionBinding[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is MentionBinding => item && typeof item === "object"
      && typeof item.token === "string" && new RegExp(`^@[${MENTION_NAME_CHARACTERS}]{1,64}$`, "u").test(item.token)
      && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 128
      && typeof item.name === "string" && item.name.length <= 2000).slice(0, 100);
  } catch { return []; }
}
