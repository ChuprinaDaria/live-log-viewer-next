import { expect, test } from "bun:test";

import { HQ_PROMPT_VERSION, hqMandate } from "./hq";

/* The mandate is the seat's only briefing, so what it must SAY is asserted
   here rather than eyeballed in a transcript. */
const input = {
  hostname: "walter",
  sshHosts: ["ryzen"],
  telegramChat: null,
  mcpServers: ["sessionmem"],
  name: "Дітріх",
} as const;

test("the mandate tells the seat its own name and leaves signing to the room", () => {
  const mandate = hqMandate(input);
  expect(mandate).toContain("Your name is Дітріх; the operator and the other agents call you that.");
  expect(mandate).toContain("Speak in the first person as Дітріх; the room signs your messages for you, so do not add a signature yourself.");
});

test("a renamed seat gets the new name in its mandate", () => {
  expect(hqMandate({ ...input, name: "Гвардія" })).toContain("Your name is Гвардія;");
});

test("the prompt version moved with the name line", () => {
  expect(HQ_PROMPT_VERSION).toBe(3);
});

test("the access inventory is named only when configured, with the hand-out rule", () => {
  expect(hqMandate(input)).not.toContain("access inventory");
  const withDoc = hqMandate({ ...input, accessDoc: "/srv/secrets/ACCESS.md" });
  expect(withDoc).toContain("/srv/secrets/ACCESS.md");
  expect(withDoc).toContain("ONLY when the operator names that agent");
  expect(withDoc).toContain("secret_share");
});
