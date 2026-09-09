import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "bun:test";

/*
 * Every door into a launch, enumerated — because twice now a guard that was
 * described as covering "all the points" turned out to have one more.
 *
 * Two rounds of review found doors nobody had listed: `/api/flows`, which
 * reserves a reviewer without going through the spawn command at all, and the
 * HQ seat spawn, which replaces the seat command's dependencies wholesale and
 * so silently kept the console default the seat lane had already left. Neither
 * was a subtle bug — both were unlisted callers. So the list is not prose here,
 * it is a check: a new caller of `executeSpawnRequest` fails this file until
 * someone writes down which role resolution it gets and why.
 *
 * The rule the table encodes:
 *
 *   a SEAT launch resolves locally (built-in definitions, no console call ever),
 *   because a console that is down must not stop the fleet from launching the
 *   agent that would repair the console;
 *
 *   every other launch resolves through the shared console catalog, because
 *   that is what makes an additional console role launchable at all — and none
 *   of them is load-bearing for recovery.
 */

const SOURCE_ROOT = path.join(import.meta.dir, "..", "..");

/** Each caller of `executeSpawnRequest`, and the resolution it must get. */
const ENTRY_POINTS: Record<string, { resolution: "console-catalog" | "local"; why: string }> = {
  "app/api/spawn/route.ts": {
    resolution: "console-catalog",
    why: "The operator's own HTTP lane, and the one MCP `spawn_agent` dispatches to. It passes no dependencies at all, which is what keeps the resolution seam out of reach of any request body, header or query.",
  },
  "lib/telegram/reportSpawn.ts": {
    resolution: "console-catalog",
    why: "The scheduled report launch. Its body carries no role, so the catalog is never consulted for it in practice; it takes the default because it is an ordinary launch, not a seat.",
  },
  "lib/orchestrator/seatCommand.ts": {
    resolution: "local",
    why: "Taking and rotating an orchestrator seat. Recovery depends on it, so it never waits on the console — and it resolves the same way its own preflight measures the mandate envelope.",
  },
  "app/api/orchestrator/hq/route.ts": {
    resolution: "local",
    why: "The HQ seat, through a spawn that replaces the seat command's own. Same seat contract as above; it needs the choice restated because substituting `spawn` also substitutes the dependencies the seat command would have passed.",
  },
};

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    found.push(full);
  }
  return found;
}

/** Call sites, not mentions: the declaration and the prose about it do not
    count, and neither does a type position. */
function callsSpawnCommand(contents: string): boolean {
  return /(?<!function\s)\bexecuteSpawnRequest\s*\(/.test(contents.replace(/^\s*\*.*$/gm, ""));
}

test("every caller of the spawn command is listed with the role resolution it gets", () => {
  const callers = sourceFiles(SOURCE_ROOT)
    .filter((file) => path.relative(SOURCE_ROOT, file) !== path.join("lib", "agent", "spawnCommand.ts"))
    .filter((file) => callsSpawnCommand(readFileSync(file, "utf8")))
    .map((file) => path.relative(SOURCE_ROOT, file).split(path.sep).join("/"))
    .sort();
  /* A new door fails here, with its own path in the message, rather than in a
     third review round. Add it to the table above WITH its reason. */
  expect(callers).toEqual(Object.keys(ENTRY_POINTS).sort());
});

test("each listed caller passes exactly the resolution the table claims", () => {
  for (const [file, entry] of Object.entries(ENTRY_POINTS)) {
    const contents = readFileSync(path.join(SOURCE_ROOT, file), "utf8");
    const overrides = /resolveRole\s*:\s*localRoleResolution/.test(contents);
    expect(overrides, `${file} — ${entry.why}`).toBe(entry.resolution === "local");
    /* Nothing may reach for the seam through a value the caller was handed:
       the local resolution is named by the module, or it is not used. */
    const named = [...contents.matchAll(/resolveRole\s*:\s*([A-Za-z_$][\w$.]*)/g)].map((match) => match[1]);
    expect(named.filter((name) => name !== "localRoleResolution"), `${file} names a resolver of its own`).toEqual([]);
  }
});

test("the spawn command's own default is the shared console catalog", () => {
  const contents = readFileSync(path.join(SOURCE_ROOT, "lib", "agent", "spawnCommand.ts"), "utf8");
  /* A caller that says nothing gets the catalog — so forgetting the seam is
     never what turns an operator launch into a built-in-only one. */
  expect(/resolveRole:\s*resolveSpawnRoleFromCatalog/.test(contents)).toBe(true);
  expect(/dependencies\.resolveRole\s*\?\?\s*resolveSpawnRoleFromCatalog/.test(contents)).toBe(true);
});
