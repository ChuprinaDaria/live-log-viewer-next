import type { FileEntry } from "@/lib/types";

export interface AgentMention {
  id: string;
  name: string;
  project: string;
  engine: string;
  role: string;
}

/** Titles may repeat or change; only the durable conversation ID is a target. */
export function liveAgentMentions(files: readonly FileEntry[], selfId?: string): AgentMention[] {
  const seen = new Set<string>();
  return files.flatMap((file) => {
    const id = file.conversationId;
    if (!id || id === selfId || seen.has(id) || file.proc === "killed"
      || (file.proc !== "running" && file.activity !== "live")
      || (file.engine !== "claude" && file.engine !== "codex")) return [];
    seen.add(id);
    return [{ id, name: file.title || id, project: file.project, engine: file.engine, role: file.durableLineage?.role ?? "" }];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// The same alphabet governs generated names, picker queries and queue-time
// resolution. In particular, a dot is part of a name, never a partial match.
export const MENTION_NAME_CHARACTERS = String.raw`\p{L}\p{N}_.'’\-`;
export function agentMentionName(name: string): string {
  return name.replace(new RegExp(`[^${MENTION_NAME_CHARACTERS}]+`, "gu"), "-").replace(/^-+|-+$/g, "").slice(0, 48) || "agent";
}

/** Use the readable token as the Markdown label. The feed's small renderer
 * does not decode Markdown escapes inside labels (notably an escaped ]). */
export function agentMentionLink(token: string, id: string): string {
  return `[${token}](#c=${encodeURIComponent(id)})`;
}

export function activeMention(text: string, caret: number): { start: number; end: number; query: string } | null {
  const prefix = text.slice(0, caret);
  const match = new RegExp(`(?:^|[^${MENTION_NAME_CHARACTERS}@\\[\\]])@([${MENTION_NAME_CHARACTERS}]{0,80})$`, "u").exec(prefix);
  if (!match) return null;
  return { start: caret - match[1].length - 1, end: caret, query: match[1] };
}

/** Plain Markdown survives draft persistence, delivery retries and renames, and
 * uses the feed's existing conversation link navigation. Never dispatch here. */
export function insertAgentMention(text: string, range: { start: number; end: number }, agent: AgentMention) {
  const token = agentMentionLink(`@${agentMentionName(agent.name)}`, agent.id) + " ";
  return { text: text.slice(0, range.start) + token + text.slice(range.end), caret: range.start + token.length };
}
