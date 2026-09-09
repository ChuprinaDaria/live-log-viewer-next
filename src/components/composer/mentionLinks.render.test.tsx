import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { md } from "../feed/markdown";
import { bindAgentMention, resolveAgentMentions } from "./mentionBindings";
import { insertAgentMention } from "./agentMentions";

for (const name of ["Reviewer [UI]", "Reviewer `UI`", "Reviewer **UI**", "Reviewer \\ UI"]) {
  test(`a selected name renders as one clickable conversation link: ${name}`, () => {
    const agent = { id: "conversation_reviewer", name, project: "project-a", role: "reviewer", engine: "codex" };
    const binding = bindAgentMention([], agent);
    for (const text of [resolveAgentMentions(binding.token, [binding]), insertAgentMention("@Rev", { start: 0, end: 4 }, agent).text]) {
      const html = renderToStaticMarkup(<>{md(text)}</>);
      expect(html.match(/<a /g)).toHaveLength(1);
      expect(html).toContain('href="#c=conversation_reviewer"');
      expect(html).not.toContain("\\]");
    }
  });
}
