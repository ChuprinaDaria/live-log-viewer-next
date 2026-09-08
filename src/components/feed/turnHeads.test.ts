import { expect, test } from "bun:test";

import type { FeedEntry, Item } from "./parse";
import { isTurnHead } from "./turnHeads";

const entry = (key: string, item: Item): FeedEntry => ({ anchorKey: null, key, item });
const prose = (key: string, engine: "claude" | "codex" = "claude"): FeedEntry =>
  entry(key, { kind: "prose", ts: "t", engine, text: "answer" } as Item);
const user = (key: string): FeedEntry => entry(key, { kind: "user", ts: "t", text: "prompt" } as Item);
const tool = (key: string): FeedEntry => entry(key, { kind: "tool" } as unknown as Item);
const think = (key: string): FeedEntry => entry(key, { kind: "think", ts: "t", text: "" } as Item);

test("the first agent item after operator input opens the turn; the rest of the run does not", () => {
  const entries = [user("u"), prose("a"), tool("b"), prose("c")];
  expect(isTurnHead(entries, 0)).toBe(false); // user rows never carry the header
  expect(isTurnHead(entries, 1)).toBe(true);
  expect(isTurnHead(entries, 2)).toBe(false);
  expect(isTurnHead(entries, 3)).toBe(false);
});

test("a turn can open with a command, and the feed start opens a turn", () => {
  const entries = [tool("a"), prose("b")];
  expect(isTurnHead(entries, 0)).toBe(true);
  expect(isTurnHead(entries, 1)).toBe(false);
});

test("quiet chrome between blocks neither takes the header nor splits the run", () => {
  const entries = [user("u"), think("th"), prose("a"), think("th2"), tool("b")];
  expect(isTurnHead(entries, 1)).toBe(false); // think never carries the header
  expect(isTurnHead(entries, 2)).toBe(true);
  expect(isTurnHead(entries, 4)).toBe(false);
});

test("each operator input re-opens the header for the next agent block", () => {
  const entries = [prose("a"), user("u"), prose("b")];
  expect(isTurnHead(entries, 0)).toBe(true);
  expect(isTurnHead(entries, 2)).toBe(true);
});

test("an engine flip inside one run re-opens the header", () => {
  const entries = [prose("a", "claude"), prose("b", "codex"), prose("c", "codex")];
  expect(isTurnHead(entries, 1)).toBe(true);
  expect(isTurnHead(entries, 2)).toBe(false);
});
