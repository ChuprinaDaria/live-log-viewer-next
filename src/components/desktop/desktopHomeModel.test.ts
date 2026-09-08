import { describe, expect, test } from "bun:test";
import type { FileEntry } from "@/lib/types";
import type { ProjectDetail } from "@/components/mobile/firmsModel";
import { effectiveRows, effectiveSecretRows, machineOf, projectAgents, unassignedFiles } from "./desktopHomeModel";

function entry(over: Partial<FileEntry>): FileEntry {
  return { path: "/x/a.jsonl", root: "claude-projects", name: "a.jsonl", project: "dir-1", title: "A", engine: "claude", kind: "session", fmt: "jsonl", parent: null, mtime: 100, size: 1, activity: "idle", proc: null, pid: null, model: null, pendingQuestion: null, ...over } as FileEntry;
}
const org = (project: string) => ({ firm: "noologic", firmName: "Noologic", project, projectName: project, via: "path" as const });

describe("unassignedFiles", () => {
  test("keeps conversations without org, drops subagents and attributed ones", () => {
    const files = [
      entry({ path: "/1", org: org("bot") }),
      entry({ path: "/2" }),
      entry({ path: "/3", kind: "agent" }),
    ];
    expect(unassignedFiles(files).map((f) => f.path)).toEqual(["/2"]);
  });
});

describe("projectAgents", () => {
  test("filters by org.project, live first then newest", () => {
    const files = [
      entry({ path: "/old", org: org("bot"), mtime: 10 }),
      entry({ path: "/new", org: org("bot"), mtime: 20 }),
      entry({ path: "/live", org: org("bot"), mtime: 5, activity: "live" }),
      entry({ path: "/other", org: org("money"), mtime: 99 }),
    ];
    expect(projectAgents(files, "bot").map((f) => f.path)).toEqual(["/live", "/new", "/old"]);
  });
});

describe("effectiveRows", () => {
  const detail = {
    id: "bot", name: "bot", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0,
    effective: {
      mcp: [{ item: "viewer", from: "project:bot" }, { item: "obsidian", from: "firm:noologic" }],
      skills: [{ item: "review", from: "firm:noologic" }],
      secrets: [{ secret: "openai_bot", from: "project:bot" }],
    },
  } as ProjectDetail;
  test("marks own vs inherited", () => {
    expect(effectiveRows(detail, "mcp")).toEqual([
      { item: "viewer", own: true, from: "project:bot" },
      { item: "obsidian", own: false, from: "firm:noologic" },
    ]);
    expect(effectiveRows(detail, "skills")).toEqual([{ item: "review", own: false, from: "firm:noologic" }]);
    expect(effectiveSecretRows(detail)).toEqual([{ item: "openai_bot", own: true, from: "project:bot" }]);
  });
  test("null detail gives no rows", () => {
    expect(effectiveRows(null, "mcp")).toEqual([]);
    expect(effectiveSecretRows(null)).toEqual([]);
  });
});

describe("machineOf", () => {
  test("names a pulled host and nothing else", () => {
    expect(machineOf(entry({ path: "/w/.claude/projects/pulled/ryzen/x/a.jsonl" }))).toBe("ryzen");
    expect(machineOf(entry({ path: "/w/.claude/projects/x/a.jsonl" }))).toBe("");
  });
});
