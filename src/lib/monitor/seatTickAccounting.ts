import crypto from "node:crypto";
import fs from "node:fs";
import { initializeStateCollections, SqliteStateCollection } from "@/lib/state/sqliteStateStore";
import { seatTickWakeCommit } from "./seatTick";
import { emptySeatTickState, type SeatTickChildInput, type SeatTickProjectState, type SeatTickOutstandingWake } from "./types";
import { emptyLedgerCursor, type LedgerCursor, type LedgerOutcome } from "./seatTickChildLedger";

type Base = { key: string; schemaVersion: 1; project: string };
/** What the seat file looked like when its revocations were last read: a
    file that has not changed is not read again, and one that could not be read
    keeps saying so until it changes. */
type OwnerScan = { identity: string; gap: boolean };
export type AccountingProject = Base & { kind: "project"; revision: number; sequence: number; ownerScan?: OwnerScan; state: SeatTickProjectState; migration: "ready" | "pending" | "unknown"; gap: string | null };
export type AccountingOwner = Base & { kind: "owner"; conversationId: string; epoch: number; after: string; through: string | null };
export type AccountingChild = Base & { kind: "child"; identity: string; rowKey: string; owner: string; launchId: string; input: SeatTickChildInput; generationIndex: number; runningKey: string | null };
export type AccountingSource = Base & { kind: "source"; identity: string; child: string; engine: string; generation: string; legacyBoundary?: { identity: string; bytes: number }; cursor: LedgerCursor };
export type AccountingOutcome = Base & { kind: "outcome"; identity: string; child: string; tuple: string[]; input: SeatTickChildInput; status: "owed" | "acknowledged"; landingKey: string | null; readyKey: string; gap: string | null };
type Ticket = Base & { kind: "poll" | "ready" | "owner-poll" | "running"; target: string };
type Legacy = Base & { kind: "legacy"; conversationId: string; reconciled: boolean };
export type AccountingRow = AccountingProject | AccountingOwner | AccountingChild | AccountingSource | AccountingOutcome | Ticket | Legacy;
type Transaction = Parameters<Parameters<SqliteStateCollection<AccountingRow>["boundedPatch"]>[1]>[0];
/** How a prepared attempt ends (#1465). `landed` acknowledges what it named
    and stamps the wake; `unsent` is proven non-delivery and releases it with
    no stamp, so the next check may raise it again. Nothing else ends one. */
export type WakeDisposition = "landed" | "unsent";
const collectionName = "seat-tick-v3";
const collections = new Map<string, { identity: string; collection: SqliteStateCollection<AccountingRow> }>();
const databaseIdentity = (filename: string) => { const stat = fs.statSync(filename); return `${stat.dev}:${stat.ino}`; };
export const outcomeIdentity = (tuple: readonly string[]): string => crypto.createHash("sha256").update(JSON.stringify(tuple)).digest("hex");
const segment = (value: string) => encodeURIComponent(value);
const key = (kind: string, project: string, id = "") => `${kind}/${segment(project)}/${segment(id)}`;
/** The legacy tick-state JSON and the seat file are bounded, atomically written
    documents; either is read whole under a size ceiling. The real ones are
    kilobytes; the ceilings only refuse a file that is not what it claims. */
export const LEGACY_STATE_LIMIT = 4 * 1024 * 1024;
export const SEAT_FILE_LIMIT = 16 * 1024 * 1024;
/** Rows one transaction may touch importing legacy acknowledgments, so a
    crowd of them is imported in several bounded transactions rather than one
    unbounded one; each put is keyed, so a crash between two is replayed. */
const LEGACY_IMPORT_BATCH = 1000;
/** Predecessor owners one read of the seat file records. */
const OWNER_LIMIT = 200;
/** Running children one check observes, and how many of them move to the back
    of the queue afterwards. Observing eight and rotating four means every
    running child is seen on two CONSECUTIVE checks once per cycle, which is
    what the stall rule needs: a stall is reported once it survived a second
    check. A fixed identity-ordered eight would have watched the same eight for
    ever and never seen a stall among the rest (#1465). */
export const RUNNING_PAGE = 8;
export const RUNNING_ROTATE = 4;

function decodeAccountingRow(raw: unknown): AccountingRow | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as AccountingRow;
  const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;
  const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  const childInput = (input: SeatTickChildInput | undefined) => input && string(input.conversationId)
    && typeof input.title === "string" && ["running", "terminal", "unknown"].includes(input.status)
    && (input.outcome === null || ["finished", "failed"].includes(input.outcome));
  if (row.schemaVersion !== 1 || !string(row.key) || typeof row.project !== "string" || typeof row.kind !== "string"
    || !row.key.startsWith(key(row.kind, row.project))) return null;
  switch (row.kind) {
    case "project": {
      const state = row.state;
      if (!integer(row.revision) || !integer(row.sequence) || !["ready", "pending", "unknown"].includes(row.migration)
        || !state || typeof state !== "object" || !nullableString(row.gap)) return null;
      if (state.seatEpoch !== null && !integer(state.seatEpoch)) return null;
      for (const name of ["lastCheckAt", "lastWakeAt", "quietSince", "idleSince", "lastProposalAt"] as const) {
        const value = state[name];
        if (value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) return null;
      }
      if (state.eventsThrough !== null && !integer(state.eventsThrough)) return null;
      if (!Array.isArray(state.harvestedChildren) || state.harvestedChildren.length !== 0
        || !Array.isArray(state.lastWakeReasons) || !Array.isArray(state.stalledSeen)
        || !state.wakesWithoutChange || typeof state.wakesWithoutChange !== "object") return null;
      const wake = state.outstandingWake;
      if (wake !== null && (!wake || !string(wake.clientMessageId) || !string(wake.conversationId)
        || !integer(wake.seatEpoch) || !nullableString(wake.operationId) || !wake.commit
        || typeof wake.commit.proposal !== "boolean" || !string(wake.commit.fingerprint)
        || !integer(wake.commit.eventsThrough) || !Array.isArray(wake.commit.reasons)
        || !Array.isArray(wake.commit.children) || !wake.commit.children.every(string)
        || (wake.preparedAt !== undefined && !string(wake.preparedAt)))) return null;
      if (row.ownerScan !== undefined && (!row.ownerScan || !string(row.ownerScan.identity) || typeof row.ownerScan.gap !== "boolean")) return null;
      return row;
    }
    case "owner": return string(row.conversationId) && integer(row.epoch) && typeof row.after === "string" && nullableString(row.through) ? row : null;
    case "child": return string(row.identity) && string(row.rowKey) && string(row.owner) && string(row.launchId) && childInput(row.input)
      && integer(row.generationIndex) && nullableString(row.runningKey) ? row : null;
    case "source": return string(row.identity) && string(row.child) && string(row.engine) && string(row.generation)
      && row.cursor && integer(row.cursor.offset) && integer(row.cursor.seq) && integer(row.cursor.settledThrough)
      && integer(row.cursor.initialSize) && nullableString(row.cursor.identity) && nullableString(row.cursor.activeTurn)
      && nullableString(row.cursor.gap) && typeof row.cursor.atEnd === "boolean" ? row : null;
    case "outcome": return Array.isArray(row.tuple) && [2, 3].includes(row.tuple.length) && row.tuple.every(string)
      && row.identity === outcomeIdentity(row.tuple) && row.key === key("outcome", row.project, row.identity)
      && childInput(row.input) && row.input.outcomeId === row.identity && row.input.status === "terminal"
      && ["owed", "acknowledged"].includes(row.status) && string(row.child) && string(row.readyKey) ? row : null;
    case "poll": case "ready": case "owner-poll": case "running": return string(row.target) ? row : null;
    case "legacy": return string(row.conversationId) && typeof row.reconciled === "boolean" ? row : null;
    default: return null;
  }
}

/** A bounded, atomically written JSON document read whole, or the reason it
    could not be. `absent` is a file that does not exist. */
function readJsonDocument(file: string, limit: number): { kind: "parsed"; value: unknown } | { kind: "absent" } | { kind: "gap"; gap: string } {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return { kind: "gap", gap: "not-a-file" };
    if (stat.size > limit) return { kind: "gap", gap: "oversized" };
    const buffer = Buffer.allocUnsafe(stat.size);
    let read = 0;
    while (read < stat.size) {
      const length = fs.readSync(fd, buffer, read, stat.size - read, read);
      if (!length) break;
      read += length;
    }
    try { return { kind: "parsed", value: JSON.parse(buffer.subarray(0, read).toString("utf8")) }; }
    catch { return { kind: "gap", gap: "malformed" }; }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "absent" } : { kind: "gap", gap: "unreadable" };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Non-evicting accounting rows and FIFO tickets in the existing state DB.
 * All changes use the shared store's authority fence, lease and transaction. */
export class SeatTickAccounting {
  readonly collection: SqliteStateCollection<AccountingRow>;
  constructor(readonly filename: string, readonly project: string) {
    const cached = collections.get(filename);
    if (cached) {
      if (databaseIdentity(filename) !== cached.identity) throw new Error("seat accounting database was replaced");
      this.collection = cached.collection;
      return;
    }
    initializeStateCollections(filename, [{ collection: collectionName, schemaVersion: 1, migrationId: "monitor-v3", key: (raw) => (raw as AccountingRow).key, loadRecords: () => [] }]);
    this.collection = new SqliteStateCollection<AccountingRow>(filename, {
      collection: collectionName, schemaVersion: 1, busyMessage: "seat outcome accounting is busy", key: (row) => row.key,
      decode: decodeAccountingRow, clone: structuredClone, strictDecode: true,
    });
    collections.set(filename, { identity: databaseIdentity(filename), collection: this.collection });
  }
  private base(kind: string, id = ""): Base { return { key: key(kind, this.project, id), project: this.project, schemaVersion: 1 }; }
  get(id: string): AccountingRow | null { return this.collection.get(id); }
  row(): AccountingProject | null {
    const row = this.get(key("project", this.project));
    if (row && row.kind !== "project") throw new Error("invalid project accounting row");
    return row;
  }
  page(kind: AccountingRow["kind"], limit: number): AccountingRow[] {
    const prefix = key(kind, this.project);
    return this.collection.keyRange(prefix, `${prefix}~`, limit);
  }
  /** A FIFO ticket at the tail of its queue; the key is returned so a row can
      remember which ticket is its own. */
  private ticket(tx: Transaction, row: AccountingProject, kind: Ticket["kind"], target: string): string {
    if (!Number.isSafeInteger(++row.sequence)) throw new Error("accounting sequence exhausted");
    const ticket = { ...this.base(kind, String(row.sequence).padStart(16, "0")), kind, target };
    tx.put(ticket);
    return ticket.key;
  }
  /** Keep the child's running ticket in step with its status: a running child
      holds exactly one, and a child that stopped running holds none. */
  private trackRunning(tx: Transaction, row: AccountingProject, child: AccountingChild): void {
    if (child.input.status === "running") {
      if (!child.runningKey) child.runningKey = this.ticket(tx, row, "running", child.key);
    } else if (child.runningKey) {
      tx.delete(child.runningKey);
      child.runningKey = null;
    }
  }
  private mutate<R>(operation: (tx: Transaction, project: AccountingProject) => R): R {
    return this.collection.boundedPatch(4096, (tx) => {
      const row = tx.get(key("project", this.project));
      if (!row || row.kind !== "project") throw new Error("accounting migration has not completed");
      const result = operation(tx, row);
      row.revision++;
      tx.put(row);
      return result;
    });
  }
  initialize(state: SeatTickProjectState, gap: string | null): void {
    this.collection.boundedPatch(4096, (tx) => {
      if (tx.get(key("project", this.project))) return;
      const ids = state.harvestedChildren;
      for (const id of ids) tx.put({ ...this.base("legacy", id), kind: "legacy", conversationId: id, reconciled: false });
      tx.put({ ...this.base("project"), kind: "project", revision: 0, sequence: 0,
        state: { ...state, harvestedChildren: [] }, migration: gap ? "unknown" : "ready", gap });
    });
  }
  /**
   * Import the project's row from the legacy JSON state file, once.
   *
   * The file is a bounded document the tick wrote atomically, so it is read
   * whole under {@link LEGACY_STATE_LIMIT} and parsed in one step; there is no
   * resumable cursor and nothing to resume. A file that cannot be read whole,
   * parsed, or trusted leaves the row `unknown` with the reason on it, and
   * every check reports that reason until the file is fixed or removed — a
   * blocked migration refuses every prepare, so it must never be silent.
   * Acknowledgments become separate rows, imported in bounded batches.
   */
  migrateLegacy(file: string, normalize: (raw: Record<string, unknown>, version: number | null) => SeatTickProjectState): void {
    if (this.row()?.migration === "ready") return;
    if (!this.row()) this.collection.boundedPatch(2, (tx) => {
      if (!tx.get(key("project", this.project))) tx.put({ ...this.base("project"), kind: "project", revision: 0, sequence: 0,
        state: emptySeatTickState(), migration: "pending", gap: null });
    });
    const opening = this.row()!;
    const document = readJsonDocument(file, LEGACY_STATE_LIMIT);
    let gap: string | null = null;
    let state = emptySeatTickState();
    const imported: string[] = [];
    if (document.kind === "gap") gap = document.gap === "malformed" ? "legacy-json-malformed" : document.gap === "oversized" ? "legacy-state-oversized" : "legacy-state-unreadable";
    else if (document.kind === "parsed") {
      const parsed = document.value;
      const projects = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).projects : undefined;
      if (!projects || typeof projects !== "object" || Array.isArray(projects)) gap = "legacy-projects-unreadable";
      else {
        const version = typeof (parsed as Record<string, unknown>).version === "number" ? (parsed as Record<string, unknown>).version as number : null;
        const raw = (projects as Record<string, unknown>)[this.project];
        if (raw !== undefined) {
          const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
          state = normalize(row, version);
          const acknowledgments = row.harvestedChildren;
          if (acknowledgments !== undefined) {
            if (!Array.isArray(acknowledgments)) gap = "legacy-acknowledgments-unreadable";
            else for (const id of acknowledgments) {
              if (typeof id !== "string" || !id || id.length > 200) { gap = "legacy-acknowledgments-unreadable"; break; }
              imported.push(id);
            }
          }
          if (Object.hasOwn(row, "outstandingWake") && row.outstandingWake !== null && !state.outstandingWake) gap = "legacy-outstanding-unreadable";
        }
      }
    }
    const legacyRows = gap ? [] : [...new Set(imported)];
    for (let start = 0; start < legacyRows.length; start += LEGACY_IMPORT_BATCH) {
      const batch = legacyRows.slice(start, start + LEGACY_IMPORT_BATCH);
      this.collection.boundedPatch(LEGACY_IMPORT_BATCH + 2, (tx) => {
        const current = tx.get(opening.key);
        if (!current || current.kind !== "project" || current.revision !== opening.revision) return;
        for (const id of batch) tx.put({ ...this.base("legacy", id), kind: "legacy", conversationId: id, reconciled: false });
      });
    }
    this.collection.boundedPatch(2, (tx) => {
      const current = tx.get(opening.key);
      if (!current || current.kind !== "project" || current.revision !== opening.revision) return;
      const migration = gap ? "unknown" : "ready";
      /* A blocked import re-read on every check must not move the revision
         while nothing about it changed, or a check's own conditional write —
         made on the revision it read — is refused as stale. */
      if (current.migration === migration && current.gap === gap && gap) return;
      tx.put({ ...current, revision: current.revision + 1, state: gap ? current.state : { ...state, harvestedChildren: [] }, migration, gap });
    });
  }
  readState(): SeatTickProjectState {
    const row = this.row();
    if (!row) throw new Error("missing project accounting");
    return { ...row.state, accounting: { filename: this.filename, revision: row.revision, gap: row.migration === "ready" ? row.gap : row.gap ?? "legacy-migration-pending" } };
  }
  /** Conditional project write. A row whose legacy import is blocked is written
      too (#1465): the check's own memory — the run of failures that puts the
      blocked import on the board, the stall memory, the sealed cursor — has to
      persist for the condition to be reported at all, and the import, once the
      file is fixed, replaces the row wholesale anyway. */
  writeState(state: SeatTickProjectState): void {
    this.mutate((tx, row) => {
      if (state.accounting?.revision !== row.revision) throw new Error("stale seat tick state");
      row.state = { ...state, accounting: undefined, harvestedChildren: [] };
    });
  }
  owner(conversationId: string, epoch: number): void {
    const existing = this.get(key("owner", this.project, String(epoch)));
    if (existing?.kind === "owner" && existing.conversationId === conversationId) return;
    this.mutate((tx, row) => {
      const id = key("owner", this.project, String(epoch));
      const existing = tx.get(id);
      if (existing) {
        if (existing.kind !== "owner" || existing.conversationId !== conversationId) throw new Error("contradictory seat ownership");
        return;
      }
      tx.put({ ...this.base("owner", String(epoch)), kind: "owner", conversationId, epoch, after: "", through: null });
      this.ticket(tx, row, "owner-poll", id);
    });
  }
  /**
   * Record the project's predecessor seats from the seat file's committed
   * revocations, so their children are discovered too. Abandoned pending-seat
   * history grants no ownership.
   *
   * The seat file is written atomically and is kilobytes long, so it is read
   * whole under {@link SEAT_FILE_LIMIT} and parsed once; the identity of the
   * file last read is remembered on the project row, and an unchanged file is
   * not read again. Returns whether this check's owner discovery is incomplete.
   */
  discoverRevokedOwners(filename: string, matches: (project: string) => boolean): boolean {
    const opening = this.row()!;
    let identity: string;
    try {
      const stat = fs.statSync(filename);
      identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
    if (opening.ownerScan?.identity === identity) return opening.ownerScan.gap;
    const document = readJsonDocument(filename, SEAT_FILE_LIMIT);
    if (document.kind === "absent") return false;
    let gap = document.kind === "gap";
    const owners: { conversationId: string; epoch: number }[] = [];
    if (document.kind === "parsed") {
      const file = document.value as Record<string, unknown> | null;
      const revocations = file && typeof file === "object" && !Array.isArray(file) && file.schemaVersion === 1 && Array.isArray(file.revocations)
        ? file.revocations : null;
      if (!revocations) gap = true;
      else for (const candidate of revocations) {
        const row = (candidate ?? {}) as Record<string, unknown>;
        if (typeof row.project === "string" && matches(row.project)
          && typeof row.conversationId === "string" && row.conversationId.startsWith("conversation_")
          && Number.isSafeInteger(row.seatEpoch) && Number(row.seatEpoch) >= 1
          && typeof row.revokedAt === "string" && Number.isFinite(Date.parse(row.revokedAt))) {
          owners.push({ conversationId: row.conversationId, epoch: Number(row.seatEpoch) });
        }
      }
    }
    const recorded = owners.slice(0, OWNER_LIMIT);
    const capped = owners.length > recorded.length;
    let raced = false;
    this.mutate((tx, row) => {
      // Another controller may have progressed while the file was read.
      if (row.revision !== opening.revision) { raced = true; return; }
      for (const owner of recorded) {
        const id = key("owner", this.project, String(owner.epoch));
        const existing = tx.get(id);
        if (existing) {
          if (existing.kind !== "owner" || existing.conversationId !== owner.conversationId) throw new Error("contradictory predecessor ownership");
          continue;
        }
        tx.put({ ...this.base("owner", String(owner.epoch)), kind: "owner", conversationId: owner.conversationId, epoch: owner.epoch, after: "", through: null });
        this.ticket(tx, row, "owner-poll", id);
      }
      /* A capped read is not remembered as this file: the next check reads it
         again and records the owners past the cap, which already exist by then
         and are skipped. */
      if (!capped) row.ownerScan = { identity, gap };
    });
    return gap || capped || raced;
  }
  discovery(ticket: Ticket, owner: AccountingOwner, children: AccountingChild[]): void {
    this.mutate((tx, row) => {
      const current = tx.get(ticket.key);
      if (!current) return;
      for (const child of children) {
        const prior = tx.get(child.key);
        if (!prior) {
          this.trackRunning(tx, row, child);
          tx.put(child);
          this.ticket(tx, row, "poll", child.key);
        }
      }
      tx.put(owner);
      tx.delete(ticket.key);
      this.ticket(tx, row, "owner-poll", owner.key);
    });
  }
  child(rowKey: string, owner: string, launchId: string, input: SeatTickChildInput): AccountingChild {
    const identity = outcomeIdentity([owner, rowKey, launchId]);
    return { ...this.base("child", identity), kind: "child", identity, rowKey, owner, launchId, input, generationIndex: 0, runningKey: null };
  }
  source(child: AccountingChild, engine: string, generation: string): AccountingSource {
    const identity = outcomeIdentity([engine, generation]);
    const held = this.get(key("source", this.project, identity));
    if (held) {
      if (held.kind !== "source" || held.child !== child.key || held.engine !== engine || held.generation !== generation) throw new Error("source identity collision");
      return held;
    }
    return { ...this.base("source", identity), kind: "source", identity, child: child.key, engine, generation, cursor: emptyLedgerCursor() };
  }
  ingest(ticket: Ticket, child: AccountingChild, source: AccountingSource | null, outcomes: LedgerOutcome[], failure = false): void {
    this.mutate((tx, row) => {
      if (!tx.get(ticket.key)) return;
      if (source?.cursor.identity && source.legacyBoundary?.identity !== source.cursor.identity) {
        source.legacyBoundary = { identity: source.cursor.identity, bytes: source.cursor.initialSize };
      }
      const tuples = failure ? [[child.launchId, "pre-execution-failure"]] : outcomes.map((event) => [source!.engine, source!.generation, event.turnId]);
      tuples.forEach((tuple, index) => {
        const identity = outcomeIdentity(tuple);
        const id = key("outcome", this.project, identity);
        const result = failure || outcomes[index]!.status !== "completed" ? "failed" : "finished";
        const existing = tx.get(id);
        if (existing) {
          if (existing.kind !== "outcome" || JSON.stringify(existing.tuple) !== JSON.stringify(tuple)) throw new Error("outcome identity collision");
          if (existing.input.outcome !== result) tx.put({ ...existing, gap: "conflicting-terminal" });
          return;
        }
        const legacy = tx.get(key("legacy", this.project, child.input.conversationId));
        const input: SeatTickChildInput = { ...child.input, status: "terminal", outcome: result, outcomeId: identity };
        const readyKey = key("ready", this.project, String(row.sequence + 1).padStart(16, "0"));
        this.ticket(tx, row, "ready", id);
        tx.put({ ...this.base("outcome", identity), kind: "outcome", identity, child: child.key, tuple, input, status: "owed", landingKey: null, readyKey,
          gap: legacy && (failure || !source?.legacyBoundary || outcomes[index]!.endOffset <= source.legacyBoundary.bytes) ? "legacy-delivery-ambiguous" : null });
      });
      if (source) tx.put(source);
      this.trackRunning(tx, row, child);
      tx.put(child);
      tx.delete(ticket.key);
      this.ticket(tx, row, "poll", child.key);
    });
  }
  /** Move observed running tickets to the tail of their queue, so the next
      check observes the children behind them. A ticket its child no longer
      claims is stale and is dropped. */
  rotateRunning(tickets: readonly AccountingRow[]): void {
    if (tickets.length === 0) return;
    this.mutate((tx, row) => {
      for (const ticket of tickets) {
        if (ticket.kind !== "running" || !tx.get(ticket.key)) continue;
        tx.delete(ticket.key);
        const child = tx.get(ticket.target);
        if (!child || child.kind !== "child" || child.runningKey !== ticket.key) continue;
        child.runningKey = child.input.status === "running" ? this.ticket(tx, row, "running", child.key) : null;
        tx.put(child);
      }
    });
  }
  ready(limit: number): AccountingOutcome[] {
    return this.page("ready", limit).flatMap((ticket) => {
      if (ticket.kind !== "ready") throw new Error("invalid ready ticket");
      const outcome = this.get(ticket.target);
      if (!outcome || outcome.kind !== "outcome") throw new Error("missing outcome");
      if (outcome.status === "owed" && outcome.gap) this.defer(outcome);
      return outcome.status === "owed" && !outcome.gap ? [outcome] : [];
    });
  }
  defer(outcome: AccountingOutcome): void {
    this.mutate((tx, row) => {
      const held = tx.get(outcome.key);
      if (!held || held.kind !== "outcome" || held.status !== "owed" || held.readyKey !== outcome.readyKey) return;
      tx.delete(held.readyKey);
      held.readyKey = key("ready", this.project, String(row.sequence + 1).padStart(16, "0"));
      this.ticket(tx, row, "ready", held.key);
      tx.put(held);
    });
  }
  /** Freeze the attempt on the row, or refuse without touching it: a refusal
      moves no revision, so the check that was refused for want of a finished
      import or behind an outstanding attempt can still write its own state. */
  prepare(state: SeatTickProjectState, wake: SeatTickOutstandingWake): boolean {
    return this.collection.boundedPatch(4096, (tx) => {
      const row = tx.get(key("project", this.project));
      if (!row || row.kind !== "project") throw new Error("accounting migration has not completed");
      if (row.revision !== state.accounting?.revision || row.state.outstandingWake || row.migration !== "ready") return false;
      for (const id of wake.commit.children) {
        const outcome = tx.get(key("outcome", this.project, id));
        if (!outcome || outcome.kind !== "outcome" || outcome.status !== "owed" || outcome.gap) return false;
      }
      row.state = { ...state, accounting: undefined, harvestedChildren: [], outstandingWake: wake };
      row.revision++;
      tx.put(row);
      return true;
    });
  }
  /** End the prepared attempt under `expectedKey` (#1465). See
      {@link WakeDisposition} for what each ending stamps. `state` carries the
      instant a landing is stamped at, on `lastWakeAt`. */
  settle(expectedKey: string, state: SeatTickProjectState, disposition: WakeDisposition): boolean {
    return this.mutate((tx, row) => {
      const wake = row.state.outstandingWake;
      if (!wake || wake.clientMessageId !== expectedKey) return false;
      if (disposition === "landed") for (const id of wake.commit.children) {
        const outcome = tx.get(key("outcome", this.project, id));
        if (!outcome) {
          // A legacy prepared wake names conversations. Landing preserves that
          // positive evidence without attributing it to a guessed turn.
          if (!id.startsWith("conversation_")) throw new Error("missing frozen outcome");
          tx.put({ ...this.base("legacy", id), kind: "legacy", conversationId: id, reconciled: true });
          continue;
        }
        if (outcome.kind !== "outcome") throw new Error("invalid frozen outcome");
        tx.put({ ...outcome, status: "acknowledged", landingKey: expectedKey });
        tx.delete(outcome.readyKey);
      }
      const current = disposition === "landed" ? seatTickWakeCommit(row.state, wake.commit, Date.parse(state.lastWakeAt!)) : row.state;
      row.state = { ...current, accounting: undefined, harvestedChildren: [], outstandingWake: null };
      return true;
    });
  }
}
