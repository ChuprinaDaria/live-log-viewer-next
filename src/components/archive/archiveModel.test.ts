import { describe, expect, test } from "bun:test";

import type { ArchiveCard } from "@/lib/archive/sessionmemArchive";

import { cardAge, groupArchive } from "./archiveModel";

function card(over: Partial<ArchiveCard>): ArchiveCard {
  return {
    sessionId: "s", title: "t", project: "fleet", cwd: "/w/fleet", host: "ryzen", engine: "claude",
    endedAt: 100, msgCount: 1, resumable: false, transcriptPath: null,
    summary: "", did: [], broke: [], decided: [], left: [],
    ...over,
  };
}

describe("groupArchive", () => {
  test("machine → project → newest first", () => {
    const groups = groupArchive([
      card({ sessionId: "a", host: "ryzen", project: "fleet", endedAt: 10 }),
      card({ sessionId: "b", host: "walter", project: "bot", endedAt: 50 }),
      card({ sessionId: "c", host: "ryzen", project: "fleet", endedAt: 30 }),
      card({ sessionId: "d", host: "ryzen", project: "bot", endedAt: 20 }),
    ]);
    expect(groups.map((group) => group.host)).toEqual(["walter", "ryzen"]);
    const ryzen = groups.find((group) => group.host === "ryzen")!;
    expect(ryzen.projects.map((entry) => entry.project)).toEqual(["fleet", "bot"]);
    expect(ryzen.projects[0]!.cards.map((row) => row.sessionId)).toEqual(["c", "a"]);
  });

  test("a machine whose newest session is newer sorts first, and so does its project", () => {
    const groups = groupArchive([
      card({ sessionId: "old", host: "pi", endedAt: 1 }),
      card({ sessionId: "new", host: "walter", endedAt: 900 }),
    ]);
    expect(groups.map((group) => group.host)).toEqual(["walter", "pi"]);
  });

  test("a session that never ended sorts last instead of jumping the queue", () => {
    const groups = groupArchive([
      card({ sessionId: "open", endedAt: null }),
      card({ sessionId: "ended", endedAt: 5 }),
    ]);
    expect(groups[0]!.projects[0]!.cards.map((row) => row.sessionId)).toEqual(["ended", "open"]);
  });

  test("an empty archive groups into nothing", () => {
    expect(groupArchive([])).toEqual([]);
  });
});

describe("cardAge", () => {
  test("seconds since the session ended", () => {
    expect(cardAge(card({ endedAt: 1_000 }), 1_060_000)).toBe(60);
  });

  test("a session with no end has no age", () => {
    expect(cardAge(card({ endedAt: null }), 1_000)).toBeNull();
  });
});
