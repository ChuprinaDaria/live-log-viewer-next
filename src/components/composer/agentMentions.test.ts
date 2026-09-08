import { expect, test } from "bun:test";
import type { FileEntry } from "@/lib/types";
import { activeMention, insertAgentMention, liveAgentMentions } from "./agentMentions";

const row = (id: string, title: string, rest: Partial<FileEntry> = {}) => ({ conversationId: id, title, engine: "claude", activity: "live", project: "project-a", ...rest }) as FileEntry;

test("only live addressable agents are offered; duplicate names keep their own IDs", () => {
  const agents = liveAgentMentions([
    row("conversation_hq", "HQ"), row("conversation_a", "Оглядач"), row("conversation_b", "Оглядач"),
    row("conversation_dead", "Dead", { proc: "killed" }), row("conversation_idle", "Idle", { activity: "idle" }),
    row("conversation_waiting", "Waiting", { activity: "recent", proc: "running" }), row("conversation_a", "Duplicate row"),
    row("", "No identity"),
  ], "conversation_hq");
  expect(agents.map((a) => a.id).sort()).toEqual(["conversation_a", "conversation_b", "conversation_waiting"]);
});

test("recognizes a Ukrainian query at the caret, without treating email or a selected link as a query", () => {
  expect(activeMention("Запитай @ог", 11)).toEqual({ start: 8, end: 11, query: "ог" });
  expect(activeMention("contact@example.invalid", 23)).toBeNull();
  expect(activeMention("[@Agent](#c=conversation_a) ", 27)).toBeNull();
  expect(activeMention("first\n@", 7)).toEqual({ start: 6, end: 7, query: "" });
});

test("selection replaces only the query, preserves suffix and binds the exact conversation", () => {
  const agent = liveAgentMentions([row("conversation_b", "Оглядач [тест]")])[0];
  const inserted = insertAgentMention("Ask @ог about this", { start: 4, end: 7 }, agent);
  expect(inserted.text).toBe("Ask [@Оглядач \\[тест\\]](#c=conversation_b)  about this");
  expect(inserted.text.slice(inserted.caret)).toBe(" about this");
});
