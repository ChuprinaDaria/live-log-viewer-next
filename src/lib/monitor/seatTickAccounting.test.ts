import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUNNING_PAGE, RUNNING_ROTATE, SeatTickAccounting } from "./seatTickAccounting";
import { emptySeatTickState, type SeatTickChildInput } from "./types";

const CONVERSATION = ["conversation", "seat"].join("_");

test("prepared wake survives reopening, rejects concurrent preparation and lands once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seat-accounting-"));
  try {
    const filename = path.join(dir, "state.sqlite");
    const first = new SeatTickAccounting(filename, "project");
    first.initialize(emptySeatTickState(), null);
    const before = first.readState();
    const wake = { clientMessageId: "original", conversationId: CONVERSATION, seatEpoch: 1,
      operationId: null, text: "frozen payload", preparedAt: "2026-09-05T11:00:00.000Z", commit: { proposal: false, reasons: [], fingerprint: "one", eventsThrough: 0, children: [] } };
    expect(first.prepare(before, wake)).toBe(true);
    const reopened = new SeatTickAccounting(filename, "project");
    expect(reopened.readState().outstandingWake).toEqual(wake);
    expect(reopened.prepare(before, { ...wake, clientMessageId: "replacement" })).toBe(false);
    expect(() => first.writeState(before)).toThrow("stale");
    expect(reopened.settle("wrong-key", reopened.readState(), "landed")).toBe(false);
    expect(reopened.readState().outstandingWake).toEqual(wake);
    expect(reopened.settle("original", { ...reopened.readState(), lastWakeAt: "2026-09-05T12:00:00.000Z" }, "landed")).toBe(true);
    expect(first.settle("original", before, "landed")).toBe(false);
    expect(first.readState().lastWakeAt).toBe("2026-09-05T12:00:00.000Z");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* The two ways an attempt ends (#1465): `unsent` is proven non-delivery and
   moves no stamp; only `landed` stamps and acknowledges. */
test("an attempt ended unsent moves no stamp and acknowledges nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seat-accounting-endings-"));
  try {
    const filename = path.join(dir, "state.sqlite");
    const accounting = new SeatTickAccounting(filename, "project");
    accounting.initialize({ ...emptySeatTickState(), lastWakeAt: "2026-09-05T10:00:00.000Z", quietSince: "2026-09-05T10:30:00.000Z" }, null);
    const wake = { clientMessageId: "attempt", conversationId: CONVERSATION, seatEpoch: 1, operationId: null,
      commit: { proposal: false, reasons: ["interval" as const], fingerprint: "one", eventsThrough: 9, children: [] } };
    expect(accounting.prepare(accounting.readState(), wake)).toBe(true);
    expect(accounting.settle("attempt", accounting.readState(), "unsent")).toBe(true);
    expect(accounting.readState()).toMatchObject({ outstandingWake: null, lastWakeAt: "2026-09-05T10:00:00.000Z", eventsThrough: null, quietSince: "2026-09-05T10:30:00.000Z" });
    /* The same attempt may be prepared again afterwards. */
    expect(accounting.prepare(accounting.readState(), wake)).toBe(true);
    expect(accounting.readState().outstandingWake).toEqual(wake);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function childInput(id: string, status: SeatTickChildInput["status"] = "running"): SeatTickChildInput {
  return { conversationId: id, title: id, status, outcome: null, terminalAt: null, activity: null };
}

/* Running tickets are a FIFO the check observes eight of and rotates four of,
   so every running child is observed on two consecutive checks once per cycle
   (#1465). The fixed identity-ordered eight this replaces never observed the
   ninth. */
test("running tickets rotate so every running child is observed on two consecutive checks, and one that stops running leaves the queue", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seat-accounting-running-"));
  try {
    const accounting = new SeatTickAccounting(path.join(dir, "state.sqlite"), "project");
    accounting.initialize(emptySeatTickState(), null);
    accounting.owner(CONVERSATION, 1);
    const ownerTicket = accounting.page("owner-poll", 1)[0]!;
    if (ownerTicket.kind !== "owner-poll") throw new Error("fixture");
    const owner = accounting.get(ownerTicket.target)!;
    if (owner.kind !== "owner") throw new Error("fixture");
    const children = Array.from({ length: 12 }, (_, index) => accounting.child(`row-${index}`, CONVERSATION, `launch-${index}`, childInput(`child-${index}`)));
    accounting.discovery(ownerTicket, owner, children);
    expect(accounting.page("running", 60)).toHaveLength(12);

    const observed: string[][] = [];
    for (let check = 0; check < 6; check++) {
      const page = accounting.page("running", RUNNING_PAGE);
      observed.push(page.map((ticket) => ticket.kind === "running" ? (accounting.get(ticket.target) as { input: SeatTickChildInput }).input.conversationId : ""));
      accounting.rotateRunning(page.slice(0, RUNNING_ROTATE));
    }
    expect(observed[0]).toEqual(children.slice(0, 8).map((child) => child.input.conversationId));
    expect(observed[1]).toEqual([...children.slice(4, 12)].map((child) => child.input.conversationId));
    /* The twelfth child is observed on checks two and three in a row. */
    expect(observed[1]).toContain("child-11");
    expect(observed[2]).toContain("child-11");
    for (const child of children) {
      const seen = observed.map((page, index) => page.includes(child.input.conversationId) ? index : -1).filter((index) => index >= 0);
      expect(seen.some((index, position) => seen[position + 1] === index + 1)).toBe(true);
    }
    /* The queue still holds exactly one ticket per running child. */
    expect(accounting.page("running", 60)).toHaveLength(12);
    const rows = accounting.page("child", 60).flatMap((row) => row.kind === "child" ? [row] : []);
    expect(new Set(rows.map((row) => row.runningKey)).size).toBe(12);

    /* A child that stops running leaves the queue when it is polled; one that
       runs again re-enters at the tail. */
    const polled = accounting.page("poll", 1)[0]!;
    if (polled.kind !== "poll") throw new Error("fixture");
    const target = accounting.get(polled.target)!;
    if (target.kind !== "child") throw new Error("fixture");
    accounting.ingest(polled, { ...target, input: childInput(target.input.conversationId, "terminal") }, null, []);
    expect(accounting.page("running", 60)).toHaveLength(11);
    expect((accounting.get(target.key) as { runningKey: string | null }).runningKey).toBeNull();
    const again = accounting.page("poll", 60).find((ticket) => ticket.kind === "poll" && ticket.target === target.key)!;
    if (again.kind !== "poll") throw new Error("fixture");
    accounting.ingest(again, { ...(accounting.get(target.key) as typeof target), input: childInput(target.input.conversationId, "running") }, null, []);
    expect(accounting.page("running", 60)).toHaveLength(12);
    expect(accounting.page("running", 60).at(-1)!.kind === "running" && (accounting.page("running", 60).at(-1) as { target: string }).target).toBe(target.key);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* The legacy tick state is a bounded document written atomically: it is read
   whole and parsed once, so the migration is complete on the first read
   (#1465). No cursor, no window of checks, no partial import. */
test("the legacy JSON row is imported in one read, acknowledgments become rows, and a file that cannot be trusted blocks with its reason", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seat-accounting-legacy-"));
  try {
    const normalize = (raw: Record<string, unknown>) => ({ ...emptySeatTickState(), lastWakeAt: typeof raw.lastWakeAt === "string" ? raw.lastWakeAt : null });
    const crowd = Array.from({ length: 2_500 }, (_, index) => ["conversation", String(index)].join("_"));
    const legacy = path.join(dir, "seat-tick.json");
    fs.writeFileSync(legacy, JSON.stringify({ version: 2, projects: { viewer: { lastWakeAt: "2026-09-05T10:00:00.000Z", harvestedChildren: crowd }, other: {} } }));
    const viewer = new SeatTickAccounting(path.join(dir, "state.sqlite"), "viewer");
    viewer.migrateLegacy(legacy, normalize);
    expect(viewer.row()).toMatchObject({ migration: "ready", gap: null });
    expect(viewer.readState()).toMatchObject({ lastWakeAt: "2026-09-05T10:00:00.000Z", accounting: { gap: null } });
    expect(viewer.collection.snapshot().filter((row) => row.kind === "legacy")).toHaveLength(2_500);
    /* A project the file never named starts empty and ready. */
    const absent = new SeatTickAccounting(path.join(dir, "state.sqlite"), "unnamed");
    absent.migrateLegacy(legacy, normalize);
    expect(absent.row()).toMatchObject({ migration: "ready", gap: null });
    /* A file that is not a document, one whose projects are not an object and
       one whose acknowledgments are not identities each block with a reason. */
    const cases: [string, string][] = [
      ["{ not json", "legacy-json-malformed"],
      [JSON.stringify({ version: 2, projects: [] }), "legacy-projects-unreadable"],
      [JSON.stringify({ version: 2, projects: { blocked: { harvestedChildren: [42] } } }), "legacy-acknowledgments-unreadable"],
      [JSON.stringify({ version: 2, projects: { blocked: { outstandingWake: false } } }), "legacy-outstanding-unreadable"],
    ];
    for (const [body, gap] of cases) {
      const file = path.join(dir, `${gap}.json`);
      fs.writeFileSync(file, body);
      const blocked = new SeatTickAccounting(path.join(dir, `${gap}.sqlite`), "blocked");
      blocked.migrateLegacy(file, normalize);
      expect(blocked.row()).toMatchObject({ migration: "unknown", gap });
      expect(blocked.readState().accounting?.gap).toBe(gap);
    }
    /* Fixing the file unblocks the next read. */
    const fixable = path.join(dir, "legacy-json-malformed.json");
    fs.writeFileSync(fixable, JSON.stringify({ version: 2, projects: { blocked: {} } }));
    const unblocked = new SeatTickAccounting(path.join(dir, "legacy-json-malformed.sqlite"), "blocked");
    unblocked.migrateLegacy(fixable, normalize);
    expect(unblocked.row()).toMatchObject({ migration: "ready", gap: null });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* The seat file is read whole once per change (#1465): committed revocations
   for the project become predecessor owners, pending history grants nothing,
   and an unchanged file is not read again. */
test("predecessor owners come from the seat file's committed revocations, read once per change", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seat-accounting-owners-"));
  try {
    const accounting = new SeatTickAccounting(path.join(dir, "state.sqlite"), "viewer");
    accounting.initialize(emptySeatTickState(), null);
    const seats = path.join(dir, "orchestrator-seats.json");
    const predecessor = ["conversation", "predecessor"].join("_");
    const write = (revocations: unknown[], history: unknown[] = []) => fs.writeFileSync(seats, JSON.stringify({ schemaVersion: 1, nextSeatEpoch: 9, seats: {}, pending: {}, revocations, history }));
    write([
      { project: "viewer", conversationId: predecessor, seatEpoch: 6, revokedAt: "2026-09-05T10:00:00.000Z", successorConversationId: null },
      { project: "other", conversationId: ["conversation", "elsewhere"].join("_"), seatEpoch: 3, revokedAt: "2026-09-05T10:00:00.000Z", successorConversationId: null },
      { project: "viewer", conversationId: "not-a-conversation", seatEpoch: 5, revokedAt: "2026-09-05T10:00:00.000Z" },
    ], [{ seat: { project: "viewer", conversationId: ["conversation", "abandoned"].join("_"), seatEpoch: 4, state: "pending" }, reason: "terminal_error" }]);
    expect(accounting.discoverRevokedOwners(seats, (project) => project === "viewer")).toBe(false);
    const owners = accounting.page("owner", 20).flatMap((row) => row.kind === "owner" ? [row] : []);
    expect(owners.map((owner) => [owner.conversationId, owner.epoch])).toEqual([[predecessor, 6]]);
    expect(accounting.page("owner-poll", 20)).toHaveLength(1);
    /* Unchanged: not read again, no new rows. */
    const revision = accounting.row()!.revision;
    expect(accounting.discoverRevokedOwners(seats, (project) => project === "viewer")).toBe(false);
    expect(accounting.row()!.revision).toBe(revision);
    /* A file that cannot be parsed is a gap until it changes; an absent one is not. */
    fs.writeFileSync(seats, "{ torn");
    expect(accounting.discoverRevokedOwners(seats, () => true)).toBe(true);
    expect(accounting.discoverRevokedOwners(seats, () => true)).toBe(true);
    fs.unlinkSync(seats);
    expect(accounting.discoverRevokedOwners(seats, () => true)).toBe(false);
    /* A contradictory owner for a recorded epoch is refused, never overwritten. */
    write([{ project: "viewer", conversationId: ["conversation", "impostor"].join("_"), seatEpoch: 6, revokedAt: "2026-09-05T11:00:00.000Z" }]);
    expect(() => accounting.discoverRevokedOwners(seats, (project) => project === "viewer")).toThrow("contradictory predecessor ownership");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
