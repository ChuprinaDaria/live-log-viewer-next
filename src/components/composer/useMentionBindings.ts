"use client";

import { useRef } from "react";
import type { AgentMention } from "./agentMentions";
import { bindAgentMention, readMentionBindings, resolveAgentMentions } from "./mentionBindings";

export function useMentionBindings(conversationId: string) {
  const key = `llvAgentMentionDraft:${conversationId}`;
  const read = () => {
    try { return readMentionBindings(sessionStorage.getItem(key)); }
    catch { return []; }
  };
  // The table is not rendered; it is read synchronously when a choice or send
  // happens. It shares the draft's storage lifetime and stable conversation ID.
  const current = useRef({ key, bindings: read() });
  const table = () => {
    if (current.current.key !== key) current.current = { key, bindings: read() };
    return current.current;
  };
  return {
    choose: (agent: AgentMention): string => {
      const state = table();
      const binding = bindAgentMention(state.bindings, agent);
      if (!state.bindings.some((item) => item.token === binding.token)) {
        state.bindings = [...state.bindings, binding];
      }
      try { sessionStorage.setItem(key, JSON.stringify(state.bindings)); } catch { return resolveAgentMentions(binding.token, [binding]); }
      return binding.token;
    },
    resolve: (text: string) => resolveAgentMentions(text, table().bindings),
    clear: () => {
      current.current = { key, bindings: [] };
      try { sessionStorage.removeItem(key); } catch { /* no persistent storage */ }
    },
  };
}
