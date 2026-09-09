import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { mobileRowState } from "@/components/mobile/mobileBoardModel";
import { translate } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { ProcessStatusChip } from "./TaskHeader";

/*
 * §1.3 of the audit: the desktop's process chip said «перервано» for a killed
 * host, for a host stopped after a finished turn, and for a transcript that had
 * merely gone quiet. The phone's board already distinguishes all three
 * (`mobileRowState`, #1487), so this file pins the desktop to the SAME reading
 * of the same evidence — and to words that claim no more than the evidence has.
 *
 * The two words the audit named are checked in both locales: silence is never
 * called a permission prompt, and a host that stopped after its turn settled is
 * never called a crash.
 */

const dom = new Window({ url: "http://localhost/" });
const G = globalThis as Record<string, unknown>;
const OVERRIDES: Record<string, unknown> = {
  window: dom, document: dom.document, navigator: dom.navigator, Node: dom.Node, HTMLElement: dom.HTMLElement,
};
const HAS: Record<string, boolean> = {};
const SAVED: Record<string, unknown> = {};
beforeAll(() => { for (const key of Object.keys(OVERRIDES)) { HAS[key] = key in G; SAVED[key] = G[key]; G[key] = OVERRIDES[key]; } });
afterAll(async () => {
  /* React's scheduler may still have a callback queued; taking `window` away
     under it is what turns a passing file into an unhandled error. */
  await new Promise((r) => setTimeout(r, 0));
  for (const key of Object.keys(OVERRIDES)) { if (HAS[key]) G[key] = SAVED[key]; else delete G[key]; }
});

const NOW = 1_760_000_000;

/** A conversation record with only the fields the chip and the phone's board
    read. Both surfaces get the SAME object in every case below. */
function entry(over: Partial<FileEntry>): FileEntry {
  return {
    path: "/p/session.jsonl",
    project: "atlas",
    mtime: NOW - 600,
    size: 1024,
    activity: "recent",
    proc: null,
    pid: null,
    ...over,
  } as FileEntry;
}

function chipText(file: FileEntry): string {
  const host = dom.document.createElement("div");
  dom.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  flushSync(() => root.render(<ProcessStatusChip file={file} />));
  const text = (host as unknown as HTMLElement).textContent ?? "";
  flushSync(() => root.unmount());
  host.remove();
  return text;
}

const CASES = {
  /* A host that died while its turn was open — the zombie. */
  lostMidTurn: entry({ proc: "killed", activity: "stalled", lastTurn: { startedAt: (NOW - 900) * 1000, endedAt: null } as FileEntry["lastTurn"] }),
  /* The ordinary end of every finished stage: the turn closed, then the host
     stopped. */
  settled: entry({ proc: "killed", activity: "recent", lastTurn: { startedAt: (NOW - 900) * 1000, endedAt: (NOW - 800) * 1000 } as FileEntry["lastTurn"] }),
  /* Nothing is known about the process, and the transcript stopped growing. */
  quiet: entry({ proc: null, activity: "stalled", activityReason: "jsonl_turn_stalled" as FileEntry["activityReason"] }),
};

test("a host lost mid-turn and one stopped after its turn read differently, and match the phone", () => {
  expect(chipText(CASES.lostMidTurn)).toBe(translate("en", "task.lostBadge"));
  expect(chipText(CASES.settled)).toBe(translate("en", "task.sessionEndedBadge"));
  /* The phone's model reaches the same two verdicts from the same records: the
     zombie is its own `killed` row, the settled one falls through to an
     ordinary finished conversation. */
  expect(mobileRowState(CASES.lostMidTurn, NOW).key).toBe("killed");
  const settled = mobileRowState(CASES.settled, NOW);
  expect(settled.key).toBe("returned");
  expect(settled.dot).not.toBe("danger");
  expect(settled.edge).toBeNull();
});

test("silence is reported as missing data, not as an interruption", () => {
  expect(chipText(CASES.quiet)).toBe(translate("en", "task.noNewDataBadge"));
  for (const locale of ["en", "uk"] as const) {
    const quiet = translate(locale, "task.noNewDataBadge").toLowerCase();
    /* The words the audit ruled out: neither the crash reading nor the
       permission reading is earned by silence alone. */
    expect(quiet).not.toContain("interrupt");
    expect(quiet).not.toContain("перерв");
    expect(quiet).not.toContain("permission");
    expect(quiet).not.toContain("дозвол");
    const switchboard = translate(locale, "status.stalled").toLowerCase();
    expect(switchboard).not.toContain("permission");
    expect(switchboard).not.toContain("дозвол");
    expect(switchboard).not.toContain("перерв");
    /* A settled host is never named an accident. */
    const ended = translate(locale, "task.sessionEndedBadge").toLowerCase();
    expect(ended).not.toContain("kill");
    expect(ended).not.toContain("вбит");
    expect(ended).not.toContain("перерв");
  }
});

test("a running host still shows its PID, and a confirmed question is not this chip's business", () => {
  expect(chipText(entry({ proc: "running", pid: 4242, activity: "live" }))).toContain("4242");
  /* A quiet transcript under a live process is the switchboard's stalled tail;
     the chip keeps reporting the process it can see. */
  expect(chipText(entry({ proc: "running", pid: 7, activity: "stalled" }))).toContain("7");
  /* Nothing known at all draws nothing rather than a guess. */
  expect(chipText(entry({ proc: null, activity: "recent" }))).toBe("");
});
