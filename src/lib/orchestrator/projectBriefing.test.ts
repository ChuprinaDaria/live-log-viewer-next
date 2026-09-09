import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { forgetOrgBridge } from "@/lib/projects/orgBridge";

import {
  PROJECT_BRIEFING_BUDGET_BYTES,
  PROJECT_BRIEFING_HEADING,
  projectBriefing,
  withProjectBriefing,
} from "./projectBriefing";

let sandbox = "";
let previousStateDir: string | undefined;

/** A console row as `projects_list` returns it, written straight into the org
    bridge's cache — which is the ONLY source the seat path may read, because
    it must never shell out to a console that might hang. */
function seedConsole(rows: Record<string, unknown>[]): void {
  fs.writeFileSync(
    path.join(sandbox, "org-bridge.json"),
    JSON.stringify({ builtAt: "2026-09-09T00:00:00.000Z", rows }),
  );
  forgetOrgBridge();
}

/** The board id the bridge mints for a path that is neither a checkout nor
    backed by a remote: Claude's own folder slug. */
const boardIdFor = (candidate: string) => candidate.replace(/[/_.]/g, "-");

beforeEach(() => {
  previousStateDir = process.env.LLV_STATE_DIR;
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "llv-briefing-"));
  process.env.LLV_STATE_DIR = sandbox;
  forgetOrgBridge();
});

afterEach(() => {
  forgetOrgBridge();
  if (previousStateDir === undefined) delete process.env.LLV_STATE_DIR;
  else process.env.LLV_STATE_DIR = previousStateDir;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("a project the console does not know gets no briefing at all", () => {
  seedConsole([]);
  expect(projectBriefing("proj-a")).toBeNull();
  expect(projectBriefing("")).toBeNull();
});

test("the briefing names the firm, the checkout, the repository and the grants with their origin", () => {
  seedConsole([{
    firm: "noologic",
    firmName: "Noologic",
    project: "kafe",
    projectName: "Кафе",
    path: "/srv/kafe",
    repo: "https://example.invalid/kafe.git",
    paths: ["/opt/kafe"],
    note: "prod and stage swap places",
    grants: [{ item: "telegram", from: "project" }, { item: "firecrawl", from: "firm:noologic" }],
    skills: [{ item: "webapp-testing", from: "firm:noologic" }],
    secretNames: ["kafe_db_password"],
    ruleCount: 3,
    via: "path",
  }]);

  const briefing = projectBriefing(boardIdFor("/srv/kafe"));

  expect(briefing).toContain(PROJECT_BRIEFING_HEADING);
  expect(briefing).toContain("Кафе");
  expect(briefing).toContain("Noologic");
  expect(briefing).toContain("/srv/kafe");
  expect(briefing).toContain("https://example.invalid/kafe.git");
  expect(briefing).toContain("/opt/kafe");
  expect(briefing).toContain("prod and stage swap places");
  /* A grant the project holds itself is unqualified; an inherited one names
     where it came from, which is the question "may we use it" turns on. */
  expect(briefing).toContain("telegram, firecrawl (firm:noologic)");
  expect(briefing).toContain("webapp-testing (firm:noologic)");
  expect(briefing).toContain("3 written for this project and its firm");
});

/* A mandate is stored, replayed on rotation and carried into a handoff digest.
   A secret VALUE that reached one would be in all three. */
test("a secret appears by name and the briefing says how a value actually travels", () => {
  seedConsole([{
    firm: "noologic", firmName: "Noologic", project: "kafe", projectName: "Кафе",
    path: "/srv/kafe", secretNames: ["kafe_db_password"], via: "path",
  }]);

  const briefing = projectBriefing(boardIdFor("/srv/kafe"))!;

  expect(briefing).toContain("kafe_db_password");
  expect(briefing).toContain("secret_share");
  expect(briefing).toContain("never by being pasted");
});

test("an empty access layer is stated rather than left blank", () => {
  seedConsole([{
    firm: "noologic", firmName: "Noologic", project: "kafe", projectName: "Кафе",
    path: "/srv/kafe", grants: [], skills: [], secretNames: [], ruleCount: 0, via: "path",
  }]);

  const briefing = projectBriefing(boardIdFor("/srv/kafe"))!;

  expect(briefing).toContain("none granted");
  expect(briefing).toContain("none are shared with this project yet");
  expect(briefing).toContain("none written yet");
});

/* The memory reads are the half the console cannot answer, so the briefing has
   to send the seat to the tools that can — including the failures, which are
   the part of a project's history nobody writes down twice. */
test("the briefing sends the seat to memory, and to what broke, before it speaks", () => {
  seedConsole([{
    firm: "noologic", firmName: "Noologic", project: "kafe", projectName: "Кафе",
    path: "/srv/kafe", via: "path",
  }]);

  const briefing = projectBriefing(boardIdFor("/srv/kafe"))!;

  expect(briefing).toContain("search_transcripts");
  expect(briefing).toContain("sessions_search");
  expect(briefing).toContain("jeeves-rag");
  expect(briefing).toContain("what BROKE here");
  expect(briefing).toContain("an invented history is worse than an empty one");
});

test("the briefing stays inside the budget the delivery envelope reserves for it", () => {
  seedConsole([{
    firm: "noologic",
    firmName: "Noologic",
    project: "kafe",
    projectName: "Кафе",
    path: "/srv/kafe",
    note: "n".repeat(6_000),
    grants: Array.from({ length: 200 }, (_, index) => ({ item: `server-${index}`, from: "project" })),
    secretNames: Array.from({ length: 200 }, (_, index) => `secret_${index}`),
    ruleCount: 9,
    via: "path",
  }]);

  const briefing = projectBriefing(boardIdFor("/srv/kafe"))!;

  expect(Buffer.byteLength(briefing, "utf8")).toBeLessThanOrEqual(PROJECT_BRIEFING_BUDGET_BYTES);
  expect(briefing).toContain("briefing truncated");
});

test("a mandate takes the briefing once, and an absent briefing changes nothing", () => {
  const mandate = "own the board";
  const briefing = `${PROJECT_BRIEFING_HEADING}\n\nКафе.`;

  const once = withProjectBriefing(mandate, briefing);
  expect(once).toContain(briefing);
  /* A retry, a replay and a rotation all deliver again; none may stack a
     second copy of a block the operator keeps editing. */
  expect(withProjectBriefing(once, briefing)).toBe(once);
  expect(withProjectBriefing(mandate, null)).toBe(mandate);
});
