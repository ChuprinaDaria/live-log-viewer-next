import { expect, test } from "bun:test";

import { groupByProvider, lastCheckedAt, matchesFilter, secretTitle, secretWhere, summarize, type SecretView } from "@/components/mobile/secretsModel";

/* The order is alphabetical and stable, so a position can be learned; the dead
   keys are reached by the filter and counted on each group's header. The title
   falls back to the slug while the inventory carries no labels yet, which is
   the state the file is in today. */

const secret = (name: string, provider: string, state: SecretView["state"], extra: Partial<SecretView> = {}): SecretView => ({
  name, provider, state, ...extra,
});

const INVENTORY: SecretView[] = [
  secret("tg_a", "telegram", "alive"),
  secret("tg_dead", "telegram", "dead"),
  secret("openai_1", "openai", "dead"),
  secret("openai_2", "openai", "dead"),
  secret("openai_3", "openai", "alive"),
  secret("internal_x", "internal", "unchecked"),
];

test("the counters count what the inventory recorded, not what is on screen", () => {
  expect(summarize(INVENTORY)).toEqual({ total: 6, alive: 2, dead: 3, unchecked: 1 });
});

test("providers and their rows are alphabetical, and each group counts its own states", () => {
  const groups = groupByProvider(INVENTORY, "all");
  expect(groups.map((group) => group.provider)).toEqual(["internal", "openai", "telegram"]);
  expect(groups[1].rows.map((row) => row.name)).toEqual(["openai_1", "openai_2", "openai_3"]);
  expect(groups[1]).toMatchObject({ alive: 1, dead: 2, unchecked: 0 });
});

test("the dead filter keeps only dead keys and drops the groups that have none", () => {
  const groups = groupByProvider(INVENTORY, "dead");
  expect(groups.map((group) => group.provider)).toEqual(["openai", "telegram"]);
  expect(groups.every((group) => group.dead === group.rows.length)).toBe(true);
  expect(groups.flatMap((group) => group.rows).every((row) => row.state === "dead")).toBe(true);
  expect(matchesFilter(secret("k", "p", "alive"), "dead")).toBe(false);
  expect(matchesFilter(secret("k", "p", "unchecked"), "unchecked")).toBe(true);
});

test("a row is titled by its label when the inventory has one, by its slug until then", () => {
  expect(secretTitle(secret("openai_sloth_all_ryzen", "openai", "dead"))).toBe("openai_sloth_all_ryzen");
  expect(secretTitle(secret("openai_sloth_all_ryzen", "openai", "dead", { label: "OpenAI · sloth-all" }))).toBe("OpenAI · sloth-all");
});

test("the header dates the inventory by its freshest check, not its first", () => {
  expect(lastCheckedAt([
    secret("a", "p", "alive", { checkedAt: "2026-09-08 04:00:05" }),
    secret("b", "p", "dead", { checkedAt: "2026-09-08 04:01:17" }),
    secret("c", "p", "unchecked"),
  ])).toBe("2026-09-08 04:01:17");
  expect(lastCheckedAt([secret("a", "p", "unchecked")])).toBeNull();
});

/* Where a key lives is the question the store always answered and the screen
   never asked: `ref` carries machine, file and variable name. */
test("a key says which machine, file and variable it lives in", () => {
  const row = {
    name: "clickup_dasha", provider: "clickup", state: "alive" as const,
    host: "ryzen", file: "/srv/x/.env", envName: "CLICKUP_TOKEN",
  };
  expect(secretWhere(row)).toBe("ryzen · /srv/x/.env · CLICKUP_TOKEN");
});

test("a key whose ref names no machine or variable says only what it knows", () => {
  expect(secretWhere({ name: "a", provider: "p", state: "unchecked" as const })).toBe("");
  expect(secretWhere({ name: "a", provider: "p", state: "unchecked" as const, host: "walter" })).toBe("walter");
});
