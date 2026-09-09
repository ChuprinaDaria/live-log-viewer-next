import { expect, test } from "bun:test";
import { bindAgentMention, readMentionBindings, resolveAgentMentions } from "./mentionBindings";

const agent = (id: string, name = "Оглядач") => ({ id, name, project: "project-a", engine: "claude", role: "reviewer" });
test("the draft shows a short name while the queued text carries the chosen ID", () => {
  const chosen = bindAgentMention([], agent("conversation_b"));
  expect(chosen.token).toBe("@Оглядач");
  expect(resolveAgentMentions("Запитай @Оглядач про форму", [chosen])).toBe("Запитай [@Оглядач](#c=conversation_b) про форму");
});
test("same-named agents do not overwrite each other's binding", () => {
  const first = bindAgentMention([], agent("conversation_a"));
  const second = bindAgentMention([first], agent("conversation_b"));
  expect(second.token).toBe("@Оглядач-2");
  expect(resolveAgentMentions("@Оглядач-2 і @Оглядач", [first, second])).toBe("[@Оглядач-2](#c=conversation_b) і [@Оглядач](#c=conversation_a)");
});
test("a reload or rename preserves the ID, and edits do not resolve a partial name", () => {
  const original = bindAgentMention([], agent("conversation_a"));
  const saved = readMentionBindings(JSON.stringify([original]));
  expect(bindAgentMention(saved, agent("conversation_a", "Нова назва"))).toEqual(original);
  expect(resolveAgentMentions("@Оглядач-extra someone@Оглядач @Unknown", saved)).toBe("@Оглядач-extra someone@Оглядач @Unknown");
  expect(resolveAgentMentions("@Оглядач!", saved)).toBe("[@Оглядач](#c=conversation_a)!");
});
test("a malformed stored table cannot invent a recipient", () => {
  expect(readMentionBindings("broken")).toEqual([]);
  expect(readMentionBindings('[{"token":"@Agent","id":null}]')).toEqual([]);
});

test("only a complete token resolves; dots and quotes remain part of a name", () => {
  const chosen = bindAgentMention([], agent("conversation_a", "Reviewer"));
  for (const value of ["@Reviewer.new", "@Reviewer-extra", "@Reviewer's", "@Reviewer’new", "@Reviewer_name", "@Reviewer2", "name@Reviewer"]) {
    expect(resolveAgentMentions(value, [chosen])).toBe(value);
  }
  expect(resolveAgentMentions("(@Reviewer), @Reviewer!", [chosen])).toBe("([@Reviewer](#c=conversation_a)), [@Reviewer](#c=conversation_a)!");
  const dotted = bindAgentMention([chosen], agent("conversation_b", "Reviewer.new"));
  expect(resolveAgentMentions("(@Reviewer.new)", [chosen, dotted])).toBe("([@Reviewer.new](#c=conversation_b))");
});

test("an already serialized link keeps its own explicit recipient", () => {
  const chosen = bindAgentMention([], agent("conversation_a", "Reviewer"));
  const link = "[@Reviewer](#c=conversation_b)";
  expect(resolveAgentMentions(link, [chosen])).toBe(link);
});
