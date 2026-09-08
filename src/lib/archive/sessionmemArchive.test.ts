import { describe, expect, test } from "bun:test";

import { cardFromRow, countArchive, hostOf, readArchive, type ArchiveRow } from "./sessionmemArchive";

/*
 * The reader's pure half: a sessionmem row becomes an ArchiveCard, and the
 * machine name comes from the transcript path when the path says so. The
 * python one-shot is injected, so nothing here starts an interpreter or reads
 * the operator's database.
 */

function row(over: Partial<ArchiveRow> = {}): ArchiveRow {
  return {
    session_id: "s1",
    source: "claude",
    title: "Індексатор",
    project: "fleet",
    cwd: "/w/fleet",
    ended_at: 1_700_000_000,
    msg_count: 42,
    transcript_path: "/w/.claude/projects/-w-fleet/s1.jsonl",
    resumable: true,
    summary: "Полагодили лічильник.",
    did: ["переписали SQL"],
    broke: [],
    decided: ["беремо sqlite"],
    left: ["дописати тест"],
    ...over,
  };
}

describe("hostOf", () => {
  test("a pulled transcript names its machine", () => {
    expect(hostOf("/w/state/pulled/walter/projects/a.jsonl", "ryzen")).toBe("walter");
  });

  test("a local transcript falls back to the machine the reader ran on", () => {
    expect(hostOf("/w/.claude/projects/-w-fleet/a.jsonl", "ryzen")).toBe("ryzen");
    expect(hostOf(null, "ryzen")).toBe("ryzen");
  });
});

describe("cardFromRow", () => {
  test("maps every field the screen reads", () => {
    const card = cardFromRow(row(), "ryzen");
    expect(card).toEqual({
      sessionId: "s1",
      title: "Індексатор",
      project: "fleet",
      cwd: "/w/fleet",
      host: "ryzen",
      engine: "claude",
      endedAt: 1_700_000_000,
      msgCount: 42,
      resumable: true,
      transcriptPath: "/w/.claude/projects/-w-fleet/s1.jsonl",
      summary: "Полагодили лічильник.",
      did: ["переписали SQL"],
      broke: [],
      decided: ["беремо sqlite"],
      left: ["дописати тест"],
    });
  });

  test("codex sessions keep their engine, and a card that was never made is empty, not invented", () => {
    const card = cardFromRow(row({ source: "codex", summary: null, did: null, broke: null, decided: null, left: null }), "ryzen");
    expect(card?.engine).toBe("codex");
    expect(card?.summary).toBe("");
    expect(card?.did).toEqual([]);
  });

  test("a row with no session id is dropped rather than rendered blank", () => {
    expect(cardFromRow({ ...row(), session_id: "" }, "ryzen")).toBeNull();
    expect(cardFromRow(null, "ryzen")).toBeNull();
    expect(cardFromRow({ nonsense: true }, "ryzen")).toBeNull();
  });

  test("a pulled transcript overrides the reader's own machine", () => {
    const card = cardFromRow(row({ transcript_path: "/w/state/pulled/walter/p/s1.jsonl" }), "ryzen");
    expect(card?.host).toBe("walter");
  });
});

describe("readArchive", () => {
  test("passes its options to the script as one JSON argument and maps the answer", async () => {
    const seen: string[] = [];
    const cards = await readArchive({ cwdPrefixes: ["/w/fleet"], limit: 5 }, async (payload) => {
      seen.push(payload);
      return JSON.stringify({ host: "ryzen", total: 9, rows: [row(), row({ session_id: "s2", transcript_path: "/w/state/pulled/pi/p/s2.jsonl" })] });
    });
    expect(JSON.parse(seen[0]!)).toEqual({ cwdPrefixes: ["/w/fleet"], limit: 5, count: false });
    expect(cards.cards.map((card) => [card.sessionId, card.host])).toEqual([["s1", "ryzen"], ["s2", "pi"]]);
    /* The page is capped; the screen has to be able to say how much it is not showing. */
    expect(cards.total).toBe(9);
  });

  test("without a total from the script, the page is all there is", async () => {
    const page = await readArchive({}, async () => JSON.stringify({ host: "h", rows: [row()] }));
    expect(page.total).toBe(1);
  });

  test("caps the limit and defaults it, so one request cannot ask for the whole database", async () => {
    let payload = "";
    await readArchive({ limit: 5000 }, async (raw) => { payload = raw; return JSON.stringify({ host: "h", rows: [] }); });
    expect(JSON.parse(payload).limit).toBe(200);
    await readArchive({}, async (raw) => { payload = raw; return JSON.stringify({ host: "h", rows: [] }); });
    expect(JSON.parse(payload).limit).toBe(200);
  });

  test("an unreadable answer is an error, not an empty archive", async () => {
    await expect(readArchive({}, async () => "not json")).rejects.toThrow();
  });
});

describe("countArchive", () => {
  test("asks for a count and returns it", async () => {
    let payload = "";
    const count = await countArchive({}, async (raw) => { payload = raw; return JSON.stringify({ count: 317 }); });
    expect(JSON.parse(payload).count).toBe(true);
    expect(count).toBe(317);
  });
});
