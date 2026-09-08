import type { FileEntry } from "@/lib/types";

export type ConversationAvailabilitySnapshot = {
  loaded: boolean;
  ids: ReadonlySet<string>;
  targets?: ReadonlyMap<string, { id: string; name: string }>;
};

let snapshot: ConversationAvailabilitySnapshot = { loaded: false, ids: new Set() };
const listeners = new Set<(value: ConversationAvailabilitySnapshot) => void>();

export function conversationAvailabilitySnapshot(): ConversationAvailabilitySnapshot {
  return snapshot;
}

export function publishConversationAvailability(ids: ReadonlySet<string>, files: readonly FileEntry[] = []): void {
  const targets = new Map<string, { id: string; name: string }>();
  for (const file of files) {
    if (!file.conversationId) continue;
    const target = { id: file.conversationId, name: file.title || file.conversationId };
    targets.set(file.conversationId, target);
    targets.set(file.path, target);
  }
  snapshot = { loaded: true, ids, targets };
  for (const listener of listeners) listener(snapshot);
}

export function subscribeConversationAvailability(
  listener: (value: ConversationAvailabilitySnapshot) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
