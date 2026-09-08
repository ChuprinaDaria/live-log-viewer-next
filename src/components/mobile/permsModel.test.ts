import { expect, test } from "bun:test";

import { isMachine, isProtected, refusalNeeds, type PermissionsAnswer } from "./permsModel";

const machine: PermissionsAnswer = {
  target: "machine",
  settings: "~/.claude/settings.json",
  defaultMode: "auto",
  counts: { allow: 2, deny: 1, ask: 1 },
  allow: ["Bash(git status:*)", "Read"],
  deny: ["Bash(rm -rf /)"],
  ask: ["Bash(sudo:*)"],
  protected_deny: ["Bash(rm -rf /)"],
};

const project: PermissionsAnswer = {
  target: "project:money",
  own: { allow: ["Bash(pytest:*)"], deny: [], ask: [] },
  chain: ["firm:noologic", "project:money", "machine"],
  effective: {
    allow: [{ rule: "Bash(pytest:*)", from: "project:money" }, { rule: "Bash(mkfs:*)", from: "machine", shadowed_by_deny: true }],
    deny: [{ rule: "Bash(mkfs:*)", from: "machine" }],
    ask: [],
  },
};

test("the two answer shapes are told apart by their target, not by guessing at fields", () => {
  expect(isMachine(machine)).toBe(true);
  expect(isMachine(project)).toBe(false);
});

/* The console phrases each of its two pauses with the word it wants back. The
   page offers exactly that button and invents no third kind of confirmation —
   otherwise there would be two opinions about danger to keep in step. */
test("a refusal asking for confirm is offered a confirm, and one asking for force is not", () => {
  expect(refusalNeeds("Bash(sudo:*) відкриває небезпечну дію… додай confirm=true, якщо справді цього хочеш"))
    .toBe("confirm");
  expect(refusalNeeds("Bash(rm -rf /) — захисна заборона… Зняти можна з force=true, але подумай двічі"))
    .toBe("force");
});

test("an ordinary failure offers no way to repeat itself", () => {
  expect(refusalNeeds("немає такої фірми: bluebrd")).toBeNull();
  expect(refusalNeeds("HTTP 502")).toBeNull();
});

test("a protective deny is known as such, so the row can show it cannot be removed", () => {
  expect(isProtected(machine, "Bash(rm -rf /)")).toBe(true);
  expect(isProtected(machine, "Bash(git push --force:*)")).toBe(false);
  /* A project answer carries no protected list: those live on the machine. */
  expect(isProtected(project, "Bash(rm -rf /)")).toBe(false);
  expect(isProtected(null, "Bash(rm -rf /)")).toBe(false);
});

test("an inherited rule keeps the level it came from, and a shadowed allow says so", () => {
  const effective = (project as { effective?: Record<string, { rule: string; from: string; shadowed_by_deny?: boolean }[]> }).effective!;
  expect(effective.allow[0]).toMatchObject({ rule: "Bash(pytest:*)", from: "project:money" });
  /* Deny beats allow: the row is still listed, but marked inert rather than
     quietly dropped — an operator who added it deserves to see why it does
     nothing. */
  expect(effective.allow[1]).toMatchObject({ from: "machine", shadowed_by_deny: true });
});
