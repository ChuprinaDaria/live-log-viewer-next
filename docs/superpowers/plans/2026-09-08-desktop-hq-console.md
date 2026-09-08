# Desktop HQ console — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop opens on «console + HQ chat» (firm → project tree, selected project's agents/skills/secrets/MCP, «Create agent») instead of the card board; the board stays one click away.

**Architecture:** New `src/components/desktop/` holds a pure model file, an org tree, a project console panel and a `DesktopHome` composition. `Viewer.tsx` renders `DesktopHome` for `!isMobile` unless the operator switched to the board. The HQ room, the machines form and the org/registry hooks are the phone's existing components (`MobileHqRoom`, `MobileMachinesScreen`, `useOrg`, `useMcpRegistry`, `shareSecret`) mounted under `SuppressMobileTabs`, exactly as `DesktopMenu` already does — no second implementation of anything.

**Tech Stack:** Next.js 16 / React 19 / Tailwind 4 / TypeScript strict / bun test with happy-dom. Do not change the stack.

**Spec:** `docs/superpowers/specs/2026-09-08-desktop-hq-console-design.md`

## Global Constraints

- UI copy in Ukrainian AND English: every new key goes into BOTH `src/lib/i18n/uk.ts` and `src/lib/i18n/en.ts` (`MessageKey = keyof typeof en`, so a key missing in `en.ts` is a type error).
- Light design language: white panels, `bg-card`, `border-border`, accent `text-accent`; no new icons beyond `lucide-react` / `./icons`; no decorative text.
- No fake data: an empty section says so (`t("firms.nothingApplies")` style), never a placeholder number.
- Never run the whole suite (`bun test` bare kills the operator's live host). Run only the files named in each task: `bun test src/components/desktop/<file>.test.tsx`.
- Privacy gate on push: no e-mail addresses, no absolute `/home/<user>/…` paths, no `Co-authored-by` trailers in commits or files. Commit messages: one Ukrainian sentence saying what changed, like the repo's history.
- Mobile behaviour is unchanged except Task 5's button and optgroup.
- Desktop = `useIsMobile() === false` (`src/hooks/useIsMobile.ts`, `MOBILE_LAYOUT_QUERY`).

## Test harness (copy into every new dom test)

The repo's dom tests bootstrap happy-dom by hand. Use this prelude verbatim at the top of each new `*.dom.test.tsx`:

```tsx
import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dom = new Window({ url: "http://localhost/" });
const matchMedia = (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
});
Object.assign(globalThis, {
  window: dom, document: dom.document, navigator: dom.navigator, location: dom.location, history: dom.history,
  localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
  Node: dom.Node, HTMLElement: dom.HTMLElement, Element: dom.Element, Event: dom.Event, CustomEvent: dom.CustomEvent,
  KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent, MutationObserver: dom.MutationObserver,
  ResizeObserver: dom.ResizeObserver ?? class { observe() {} unobserve() {} disconnect() {} },
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number,
  cancelAnimationFrame: (id: number) => clearTimeout(id),
  matchMedia,
});
Object.assign(dom, { matchMedia });

let root: Root | null = null;
let container: HTMLElement | null = null;
function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
});
```

`fetch` is stubbed per test with `globalThis.fetch = (async (input) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;` and restored in `afterEach`.

A minimal `FileEntry` for tests (only the fields the components read):

```ts
import type { FileEntry } from "@/lib/types";
function entry(over: Partial<FileEntry>): FileEntry {
  return {
    path: "/x/a.jsonl", root: "claude-projects", name: "a.jsonl", project: "dir-1", title: "Agent A",
    engine: "claude", kind: "session", fmt: "jsonl", parent: null, mtime: 1_700_000_000, size: 1,
    activity: "idle", proc: null, pid: null, model: "opus", pendingQuestion: null,
    ...over,
  } as FileEntry;
}
```

---

### Task 1: Pure model for the desktop home

**Files:**
- Create: `src/components/desktop/desktopHomeModel.ts`
- Test: `src/components/desktop/desktopHomeModel.test.ts`

**Interfaces:**
- Consumes: `FileEntry` (`src/lib/types.ts`), `isConversation` (`src/components/projectModel.ts`), `ProjectDetail` (`src/components/mobile/firmsModel.ts`).
- Produces:
  ```ts
  export type HomeMode = "hq" | "board";
  export const HOME_MODE_KEY = "llvDesktopHome";
  export function readHomeMode(): HomeMode;            // localStorage, default "hq", never throws
  export function writeHomeMode(mode: HomeMode): void; // localStorage, swallows errors
  export function unassignedFiles(files: readonly FileEntry[]): FileEntry[];      // conversations with no `org`
  export function projectAgents(files: readonly FileEntry[], project: string): FileEntry[]; // conversations with org.project === project, live first, then newest
  export interface EffectiveRow { item: string; own: boolean; from: string } // `from` is the raw "firm:x" | "project:y"
  export function effectiveRows(detail: ProjectDetail | null, kind: "mcp" | "skills"): EffectiveRow[];
  export function effectiveSecretRows(detail: ProjectDetail | null): EffectiveRow[];
  export function machineOf(file: FileEntry): string; // "walter" for a local transcript is NOT invented here: returns "" (unknown) unless file.path contains "/pulled/<host>/" — see below
  ```
  `own === (from === "project:" + detail.id)`. `effectiveSecretRows` reads `detail.effective?.secrets` which the console sends as `{ secret, from }` — the `ProjectDetail.effective` type in `firmsModel.ts` lacks `secrets`; add `secrets?: { secret: string; from: string }[]` to that interface.
  `machineOf`: fleetctl's `transcripts_pull` copies remote transcripts under the viewer's roots; this plan does NOT know the exact layout, so `machineOf` returns `""` for everything except a path segment matching `/pulled/([a-z0-9_-]+)/`. The UI renders nothing for `""`. (Honest emptiness rule.)

- [ ] **Step 1: Write the failing tests**

```ts
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
    expect(machineOf(entry({ path: "/home/u/.claude/projects/pulled/ryzen/x/a.jsonl" }))).toBe("ryzen");
    expect(machineOf(entry({ path: "/home/u/.claude/projects/x/a.jsonl" }))).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/components/desktop/desktopHomeModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { isConversation } from "@/components/projectModel";
import type { ProjectDetail } from "@/components/mobile/firmsModel";
import type { FileEntry } from "@/lib/types";

/*
 * What the desktop home shows, as pure functions: which sessions belong to
 * which console project, which grants act on it and where each came from,
 * and the one preference the surface keeps (HQ or the board). i18n-free.
 */

export type HomeMode = "hq" | "board";
export const HOME_MODE_KEY = "llvDesktopHome";

export function readHomeMode(): HomeMode {
  try {
    return localStorage.getItem(HOME_MODE_KEY) === "board" ? "board" : "hq";
  } catch {
    return "hq";
  }
}

export function writeHomeMode(mode: HomeMode): void {
  try {
    localStorage.setItem(HOME_MODE_KEY, mode);
  } catch {
    /* private mode: the choice lives for the session only */
  }
}

/** Conversations no console project claims — the «Без проєкту» bucket. */
export function unassignedFiles(files: readonly FileEntry[]): FileEntry[] {
  return files.filter((file) => isConversation(file) && !file.org);
}

/** The project's own conversations: live first, then newest. */
export function projectAgents(files: readonly FileEntry[], project: string): FileEntry[] {
  return files
    .filter((file) => isConversation(file) && file.org?.project === project)
    .sort((a, b) => {
      const al = a.activity === "live" ? 1 : 0;
      const bl = b.activity === "live" ? 1 : 0;
      return bl - al || b.mtime - a.mtime;
    });
}

export interface EffectiveRow {
  item: string;
  /** Granted on this project itself (revocable here) rather than inherited. */
  own: boolean;
  /** The console's origin tag: `project:<id>` or `firm:<id>`. */
  from: string;
}

export function effectiveRows(detail: ProjectDetail | null, kind: "mcp" | "skills"): EffectiveRow[] {
  if (!detail) return [];
  const own = `project:${detail.id}`;
  return (detail.effective?.[kind] ?? []).map((row) => ({ item: row.item, own: row.from === own, from: row.from }));
}

export function effectiveSecretRows(detail: ProjectDetail | null): EffectiveRow[] {
  if (!detail) return [];
  const own = `project:${detail.id}`;
  return (detail.effective?.secrets ?? []).map((row) => ({ item: row.secret, own: row.from === own, from: row.from }));
}

const PULLED = /\/pulled\/([a-z0-9_-]+)\//i;

/** The machine a transcript was pulled from, or "" when the path does not
    say — the row then shows nothing rather than guessing «walter». */
export function machineOf(file: FileEntry): string {
  const match = PULLED.exec(file.path);
  return match ? match[1]! : "";
}
```

And in `src/components/mobile/firmsModel.ts`, extend `ProjectDetail`:

```ts
export interface ProjectDetail extends ProjectRow {
  note?: string;
  chain?: string[];
  children?: string[];
  effective?: {
    mcp?: EffectiveItem[];
    skills?: EffectiveItem[];
    rules?: EffectiveRule[];
    secrets?: { secret: string; from: string }[];
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test src/components/desktop/desktopHomeModel.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/desktop/desktopHomeModel.ts src/components/desktop/desktopHomeModel.test.ts src/components/mobile/firmsModel.ts
git commit -m "Модель десктопного пульта: сесії по проєктах пульта, гранти з джерелом"
```

---

### Task 2: Org tree (firm → project, plus «Без проєкту»)

**Files:**
- Create: `src/components/desktop/OrgTree.tsx`
- Test: `src/components/desktop/OrgTree.dom.test.tsx`
- Modify: `src/lib/i18n/uk.ts`, `src/lib/i18n/en.ts` (new keys, appended at the end of each dictionary)

**Interfaces:**
- Consumes: `useOrg`, `projectTree` (`src/components/mobile/firmsModel.ts`), `unassignedFiles` (Task 1), `buildProjectSummaries` (`src/components/projectModel.ts`), `fmtAge` (`src/components/utils.ts`).
- Produces:
  ```tsx
  export interface OrgTreeProps {
    files: readonly FileEntry[];
    /** Console project id, or null. */
    selected: string | null;
    onSelect: (project: string) => void;
    /** A board project key from the «Без проєкту» bucket. */
    onOpenBoardProject: (boardProject: string) => void;
  }
  export function OrgTree(props: OrgTreeProps): JSX.Element;
  ```
  Data attributes for tests: `data-org-firm="<id>"` on a firm heading, `data-org-project="<id>"` on a project button (`aria-current="true"` when selected), `data-org-unassigned` on the bucket toggle, `data-org-unassigned-row="<key>"` on each bucket row.

i18n keys (uk / en):
```
"desktop.firmsUnreachable": "Пульт не відповідає: фірми й проєкти не читаються." / "The console is unreachable: firms and projects cannot be read."
"desktop.noFirms": "Фірм ще немає." / "No firms yet."
"desktop.unassigned": "Без проєкту" / "No project"
"desktop.unassignedHint": "Сесії, які не привʼязані до проєкту пульта. Їх перебере сортувальник." / "Sessions no console project claims. The sorter will go through them."
```

- [ ] **Step 1: Write the failing test**

```tsx
/* prelude from «Test harness» */
import { setLocale } from "@/lib/i18n";
import { OrgTree } from "./OrgTree";

const realFetch = globalThis.fetch;
function answer(url: string) {
  if (url.startsWith("/api/firms")) return { firms: [{ id: "noologic", name: "Noologic", projects: ["bot", "money"], people: [], grants: { mcp: [], skills: [] }, secrets: [], rules: 0 }] };
  if (url.startsWith("/api/projects")) return { projects: [
    { id: "bot", name: "bot", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
    { id: "money", name: "money", firm: "noologic", parent: null, grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
    { id: "eva", name: "eva-repro", firm: "noologic", parent: "bot", grants: { mcp: [], skills: [] }, secrets: [], rules: 0 },
  ] };
  return {};
}
globalThis.fetch = (async (input: RequestInfo | URL) =>
  new Response(JSON.stringify(answer(String(input))), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const flush = () => new Promise((r) => setTimeout(r, 0));

test("renders firms, projects, subfolders and the unassigned bucket", async () => {
  setLocale("uk");
  const files = [entry({ path: "/u1", project: "dir-old" }), entry({ path: "/u2", project: "dir-old" }), entry({ path: "/a", org: { firm: "noologic", firmName: "Noologic", project: "bot", projectName: "bot", via: "path" } })];
  const selected: string[] = [];
  const el = mount(<OrgTree files={files} selected="bot" onSelect={(p) => selected.push(p)} onOpenBoardProject={() => {}} />);
  await act(flush); await act(flush);
  expect(el.querySelector('[data-org-firm="noologic"]')?.textContent).toContain("Noologic");
  expect(el.querySelector('[data-org-project="bot"]')?.getAttribute("aria-current")).toBe("true");
  expect(el.querySelector('[data-org-project="eva"]')).not.toBeNull();
  const bucket = el.querySelector('[data-org-unassigned]') as HTMLButtonElement;
  expect(bucket.textContent).toContain("Без проєкту");
  expect(bucket.textContent).toContain("2");
  expect(el.querySelector('[data-org-unassigned-row]')).toBeNull();
  act(() => { bucket.click(); });
  expect(el.querySelector('[data-org-unassigned-row="dir-old"]')).not.toBeNull();
  act(() => { (el.querySelector('[data-org-project="money"]') as HTMLButtonElement).click(); });
  expect(selected).toEqual(["money"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/components/desktop/OrgTree.dom.test.tsx` — FAIL, module not found.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { Building2, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { projectTree, useOrg } from "@/components/mobile/firmsModel";
import { buildProjectSummaries } from "@/components/projectModel";
import { fmtAge } from "@/components/utils";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { unassignedFiles } from "./desktopHomeModel";

/*
 * The console's org tree as the desktop's left column: firms, their projects,
 * subfolders indented. Read from fleetctl through `useOrg`, never from the
 * transcript directories — those only feed the «Без проєкту» bucket at the
 * bottom, which is where every unclaimed session waits for the sorter.
 */

export interface OrgTreeProps {
  files: readonly FileEntry[];
  selected: string | null;
  onSelect: (project: string) => void;
  onOpenBoardProject: (boardProject: string) => void;
}

const ROW = "flex min-h-8 w-full items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] hover:bg-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function OrgTree({ files, selected, onSelect, onOpenBoardProject }: OrgTreeProps) {
  const { t } = useLocale();
  const org = useOrg();
  const [bucketOpen, setBucketOpen] = useState(false);
  const unassigned = useMemo(() => unassignedFiles(files), [files]);
  const bucketRows = useMemo(() => (bucketOpen ? buildProjectSummaries(unassigned) : []), [bucketOpen, unassigned]);

  return (
    <nav aria-label={t("firms.title")} className="flex flex-col gap-1 px-2 py-2">
      {org.error ? <p className="px-2 py-1 text-[11.5px] text-danger">{t("desktop.firmsUnreachable")}</p> : null}
      {org.firms && org.firms.length === 0 ? <p className="px-2 py-1 text-[11.5px] text-muted">{t("desktop.noFirms")}</p> : null}
      {(org.firms ?? []).map((firm) => (
        <div key={firm.id} className="flex flex-col">
          <div data-org-firm={firm.id} className="flex min-h-7 items-center gap-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted">
            <Building2 className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">{firm.name || firm.id}</span>
          </div>
          {projectTree(org.projects ?? [], firm.id).map(({ row, children }) => (
            <div key={row.id} className="flex flex-col">
              <ProjectRow id={row.id} label={row.name || row.id} depth={0} selected={selected === row.id} onSelect={onSelect} />
              {children.map((child) => (
                <ProjectRow key={child.id} id={child.id} label={child.name || child.id} depth={1} selected={selected === child.id} onSelect={onSelect} />
              ))}
            </div>
          ))}
        </div>
      ))}
      {unassigned.length ? (
        <div className="mt-2 border-t border-border pt-2">
          <button type="button" data-org-unassigned aria-expanded={bucketOpen} title={t("desktop.unassignedHint")}
            className={`${ROW} font-semibold text-muted`} onClick={() => setBucketOpen((was) => !was)}>
            <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${bucketOpen ? "rotate-90" : ""}`} aria-hidden />
            <span className="truncate">{t("desktop.unassigned")}</span>
            <span className="ml-auto tabular-nums">{unassigned.length}</span>
          </button>
          {bucketRows.map((summary) => (
            <button key={summary.project} type="button" data-org-unassigned-row={summary.project}
              className={`${ROW} pl-6 text-secondary`} onClick={() => onOpenBoardProject(summary.project)}>
              <span className="truncate">{summary.displayName}</span>
              <span className="ml-auto text-[11px] text-muted">{fmtAge(summary.smt)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

function ProjectRow({ id, label, depth, selected, onSelect }: { id: string; label: string; depth: 0 | 1; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" data-org-project={id} aria-current={selected ? "true" : undefined}
      className={`${ROW} ${depth ? "pl-7" : "pl-4"} ${selected ? "bg-accent/10 font-semibold text-accent" : "text-primary"}`}
      onClick={() => onSelect(id)}>
      <span className="truncate">{label}</span>
    </button>
  );
}
```

`buildProjectSummaries(files)` takes `FileEntry[]`; pass `[...unassigned]` if the readonly type complains.

- [ ] **Step 4: Run to verify it passes** — `bun test src/components/desktop/OrgTree.dom.test.tsx`. Also `bunx tsc --noEmit -p tsconfig.json` must be clean for the touched files (run `bun run lint` on them: `bunx eslint src/components/desktop`).

- [ ] **Step 5: Commit**

```bash
git add src/components/desktop/OrgTree.tsx src/components/desktop/OrgTree.dom.test.tsx src/lib/i18n/uk.ts src/lib/i18n/en.ts
git commit -m "Дерево фірма → проєкт з пульта, і відро «Без проєкту» під ним"
```

---

### Task 3: DesktopHome and the Viewer switch

**Files:**
- Create: `src/components/desktop/DesktopHome.tsx`
- Test: `src/components/desktop/DesktopHome.dom.test.tsx`
- Modify: `src/components/Viewer.tsx` (~line 1012 `const shell = (` block; state near line 208), `src/components/ProjectRail.tsx` (header, ~line 169–210), `src/lib/i18n/{uk,en}.ts`

**Interfaces:**
- Consumes: `OrgTree` (Task 2), `MobileHqRoom` (`src/components/mobile/MobileHqRoom.tsx`), `SuppressMobileTabs` (`src/components/mobile/MobileShell.tsx`), `readHomeMode/writeHomeMode` (Task 1).
- Produces:
  ```tsx
  export interface DesktopHomeProps {
    files: FileEntry[];
    selectedProject: string | null;            // console project id
    onSelectProject: (project: string | null) => void;
    onOpenBoard: () => void;                   // header «Дошка»
    onOpenBoardProject: (boardProject: string) => void; // bucket row → board, that project
    onOpenFile: (file: FileEntry) => void;     // Task 6 uses it; pass through now
    onCreateAgent: (project: string | null) => void; // Task 5 fills it; pass through now
    /** Task 4 mounts the project console here; null until then. */
    projectConsole?: React.ReactNode;
  }
  export function DesktopHome(props: DesktopHomeProps): JSX.Element;
  ```
  Layout: `<div className="flex h-full">` → `<aside data-desktop-console className="flex w-[280px] shrink-0 flex-col border-r border-border bg-card overflow-y-auto">` with a header row (title `t("desktop.consoleTitle")`, and `<button data-desktop-board>` = `t("desktop.board")`), then `<OrgTree/>`, then `{projectConsole}`; and `<main data-desktop-hq className="flex min-w-0 flex-1 flex-col">` → `<SuppressMobileTabs><MobileHqRoom files={files} host={null} /></SuppressMobileTabs>`.
- Viewer: new state `const [homeMode, setHomeMode] = useState<HomeMode>("hq")` hydrated in a `useEffect` from `readHomeMode()`; `const [consoleProject, setConsoleProject] = useState<string | null>(null)`; `openBoard = () => { writeHomeMode("board"); setHomeMode("board"); }`, `openHome = () => { writeHomeMode("hq"); setHomeMode("hq"); }`. In `shell`, wrap: `if (!isMobile && homeMode === "hq") return <KeepAwakeProvider><DesktopHome …/></KeepAwakeProvider>` — keep the existing `shell` for everything else. `onOpenBoardProject={(key) => { openBoard(); selectProject(key); }}`, `onOpenFile={(file) => { setHomeMode("board"); openFile(file); }}` (session-only: do NOT write "board" here, the operator did not choose the board — they opened an agent).
- ProjectRail: new optional prop `onOpenHome?: () => void`; when present render, above the Overview row, `<RailRow label={t("desktop.hqRow")} … onClick={onOpenHome} />` with `data-rail-home`. Viewer passes `onOpenHome={openHome}`.

i18n keys:
```
"desktop.consoleTitle": "Пульт" / "Console"
"desktop.board": "Дошка" / "Board"
"desktop.hqRow": "HQ · Чат" / "HQ · Chat"
```

- [ ] **Step 1: Write the failing test**

```tsx
/* prelude */
import { setLocale } from "@/lib/i18n";
import { DesktopHome } from "./DesktopHome";

/* The HQ room polls /api/orchestrator/hq; an empty seat renders the «not
   started» state, which is enough to prove the room is mounted. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.startsWith("/api/orchestrator/hq") ? { seat: null, pending: null, exists: false }
    : url.startsWith("/api/firms") ? { firms: [] } : url.startsWith("/api/projects") ? { projects: [] } : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const flush = () => new Promise((r) => setTimeout(r, 0));

test("desktop home = console column + HQ room, and «Дошка» hands off", async () => {
  setLocale("uk");
  let boards = 0;
  const el = mount(<DesktopHome files={[]} selectedProject={null} onSelectProject={() => {}} onOpenBoard={() => { boards += 1; }} onOpenBoardProject={() => {}} onOpenFile={() => {}} onCreateAgent={() => {}} />);
  await act(flush); await act(flush);
  expect(el.querySelector("[data-desktop-console]")).not.toBeNull();
  expect(el.querySelector('[data-mobile2-hq="vacant"]')).not.toBeNull();
  expect(el.querySelector("[data-mobile2-tabs]")).toBeNull();
  act(() => { (el.querySelector("[data-desktop-board]") as HTMLButtonElement).click(); });
  expect(boards).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails** — `bun test src/components/desktop/DesktopHome.dom.test.tsx`.

- [ ] **Step 3: Implement `DesktopHome.tsx`**

```tsx
"use client";

import { LayoutGrid } from "lucide-react";
import type { ReactNode } from "react";

import { MobileHqRoom } from "@/components/mobile/MobileHqRoom";
import { SuppressMobileTabs } from "@/components/mobile/MobileShell";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { OrgTree } from "./OrgTree";

/*
 * The desktop's home (spec 2026-09-08): the console column on the left — the
 * org tree and, once a project is chosen, what acts on it — and the HQ room
 * on the right. The room is the phone's component under SuppressMobileTabs,
 * the same way DesktopMenu mounts every other phone page on a wide window.
 * The board is one click away and never gone.
 */

export interface DesktopHomeProps {
  files: FileEntry[];
  selectedProject: string | null;
  onSelectProject: (project: string | null) => void;
  onOpenBoard: () => void;
  onOpenBoardProject: (boardProject: string) => void;
  onOpenFile: (file: FileEntry) => void;
  onCreateAgent: (project: string | null) => void;
  projectConsole?: ReactNode;
}

export function DesktopHome({ files, selectedProject, onSelectProject, onOpenBoard, onOpenBoardProject, projectConsole }: DesktopHomeProps) {
  const { t } = useLocale();
  return (
    <div className="flex h-full">
      <aside data-desktop-console className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="text-[13.5px] font-bold">{t("desktop.consoleTitle")}</span>
          <button type="button" data-desktop-board onClick={onOpenBoard}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-[8px] border border-border px-2 text-[11.5px] font-semibold text-secondary hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            {t("desktop.board")}
          </button>
        </div>
        <OrgTree files={files} selected={selectedProject} onSelect={(id) => onSelectProject(id === selectedProject ? null : id)} onOpenBoardProject={onOpenBoardProject} />
        {projectConsole}
      </aside>
      <main data-desktop-hq className="flex min-w-0 flex-1 flex-col">
        <SuppressMobileTabs>
          <MobileHqRoom files={files} host={null} />
        </SuppressMobileTabs>
      </main>
    </div>
  );
}
```

`onOpenFile` / `onCreateAgent` are accepted and unused until Tasks 4–6; destructure them to keep eslint quiet (`void onOpenFile;` is acceptable, or leave them out of the destructuring).

- [ ] **Step 4: Wire `Viewer.tsx`**

Near line 208 add:
```tsx
const [homeMode, setHomeMode] = useState<HomeMode>("hq");
useEffect(() => { setHomeMode(readHomeMode()); }, []);
const [consoleProject, setConsoleProject] = useState<string | null>(null);
const openBoard = useCallback(() => { writeHomeMode("board"); setHomeMode("board"); }, []);
const openHome = useCallback(() => { writeHomeMode("hq"); setHomeMode("hq"); }, []);
```
Import `{ type HomeMode, readHomeMode, writeHomeMode }` from `./desktop/desktopHomeModel` and `DesktopHome` from `./desktop/DesktopHome`.

Replace the final `return <KeepAwakeProvider>{shell}</KeepAwakeProvider>;` with:
```tsx
if (!isMobile && homeMode === "hq") {
  return (
    <KeepAwakeProvider>
      <DesktopHome
        files={files}
        selectedProject={consoleProject}
        onSelectProject={setConsoleProject}
        onOpenBoard={openBoard}
        onOpenBoardProject={(key) => { openBoard(); selectProject(key); }}
        onOpenFile={(file) => { setHomeMode("board"); openFile(file); }}
        onCreateAgent={() => undefined}
      />
      <AttentionHost mobile={false} />
      <ArtifactPreviewHost mobile={false} />
      <VoicePipHost mobile={false} />
      <VoiceBridgeRelayHost />
      <VoiceComposerHost />
      <StagingBadge />
    </KeepAwakeProvider>
  );
}
return <KeepAwakeProvider>{shell}</KeepAwakeProvider>;
```
The six extra mounts are the ones `shell` mounts unconditionally that the HQ room's feed/composer depend on (voice composer host, preview host) — copy them, do not invent others. Pass `onOpenHome={openHome}` to `ProjectRail`.

In `ProjectRail.tsx`, add prop `onOpenHome?: () => void` and, directly above the Overview `RailRow` inside `<nav>`, render:
```tsx
{onOpenHome ? (
  <RailRow label={t("desktop.hqRow")} live={0} attention={0} total={null} age="" active={false} hasLive={false} onClick={onOpenHome} />
) : null}
```
(`RailRow` is the rail's own private row component — reuse it as the Overview row does.)

- [ ] **Step 5: Verify** — `bun test src/components/desktop/DesktopHome.dom.test.tsx src/components/Viewer.orchestratorDock.dom.test.tsx src/components/ProjectRail.dom.test.tsx`. The two existing tests render the desktop shell; they will now see `DesktopHome` unless they set the board mode — add `localStorage.setItem("llvDesktopHome", "board")` at the top of `Viewer.orchestratorDock.dom.test.tsx` (before mounting) so its assertions about the dock still hold. If other `Viewer.*.dom.test.tsx` files mount the desktop shell, apply the same one-liner. Then `bunx eslint src/components/desktop src/components/Viewer.tsx src/components/ProjectRail.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/components/desktop src/components/Viewer.tsx src/components/ProjectRail.tsx src/components/Viewer.orchestratorDock.dom.test.tsx src/lib/i18n/uk.ts src/lib/i18n/en.ts
git commit -m "Десктоп відкривається на пульт і чат з HQ; дошка — за кнопкою"
```

---

### Task 4: Project console (agents, skills, MCP, secrets, «Сказати HQ»)

**Files:**
- Create: `src/components/desktop/ProjectConsole.tsx`
- Test: `src/components/desktop/ProjectConsole.dom.test.tsx`
- Modify: `src/components/desktop/DesktopHome.tsx` (mount it), `src/lib/i18n/{uk,en}.ts`

**Interfaces:**
- Consumes: `loadProject`, `ProjectDetail` (`firmsModel.ts`); `useMcpRegistry` (`mcpModel.ts`: `grant(kind, item, target, revoke?)`, `servers`, `skills`); `shareSecret(secret, scope, revoke?)` (`secretsModel.ts`); `useSecretsInventory(true)` (`secretsModel.ts`, returns `{ secrets: SecretView[] | null, … }` — read the file for the exact shape); `useHqSeat`, `hqFileOf` (`src/components/mobile/hqSeat.ts`); Task 1 functions; `engineLabel` (`src/components/feed/engineMark.tsx`), `accountIdFromPath` + `DEFAULT_ACCOUNT_ID` (`src/lib/accounts/badge.ts`), `cleanTitle` (`src/lib/title.ts`), `fmtAge`.
- Produces:
  ```tsx
  export interface ProjectConsoleProps {
    project: string;              // console project id
    files: readonly FileEntry[];
    onOpenFile: (file: FileEntry) => void;
    onCreateAgent: (project: string) => void;
  }
  export function ProjectConsole(props: ProjectConsoleProps): JSX.Element;
  ```
  Sending to HQ: `POST /api/tmux` with JSON `{ path: hqFile.path, text }` (the legacy conversation-host route; `text` is the message). The line: `t("desktop.tellHqLine", { firm: detail.firm, project: detail.name || detail.id, path: detail.path ?? "" })`.
  Data attributes: `data-project-console`, `data-console-section="agents|skills|mcp|secrets"`, `data-console-agent="<path>"`, `data-console-row="<kind>:<item>"`, `data-console-revoke="<kind>:<item>"`, `data-console-add="<kind>"` (a `<select>` of registry items not yet effective; choosing one grants immediately), `data-console-tell-hq`, `data-console-create`.

i18n keys:
```
"desktop.sectionAgents": "Агенти" / "Agents"
"desktop.sectionSkills": "Скіли" / "Skills"
"desktop.sectionMcp": "MCP" / "MCP"
"desktop.sectionSecrets": "Секрети" / "Secrets"
"desktop.noAgents": "У проєкті ще немає сесій." / "No sessions in this project yet."
"desktop.fromFirm": "від фірми" / "from firm"
"desktop.own": "власний" / "own"
"desktop.revoke": "зняти" / "revoke"
"desktop.addGrant": "+ видати" / "+ grant"
"desktop.tellHq": "Сказати HQ" / "Tell HQ"
"desktop.tellHqLine": "Відкриваю проєкт {firm} → {project} ({path})" / "Opening project {firm} → {project} ({path})"
"desktop.tellHqSent": "HQ отримав." / "HQ has it."
"desktop.tellHqNoSeat": "HQ не запущений." / "HQ is not running."
"desktop.createAgent": "Створити агента" / "Create agent"
"desktop.detailFailed": "Проєкт не читається: {reason}" / "Project could not be read: {reason}"
```

- [ ] **Step 1: Write the failing test**

```tsx
/* prelude */
import { setLocale } from "@/lib/i18n";
import { ProjectConsole } from "./ProjectConsole";

const realFetch = globalThis.fetch;
const posts: { url: string; body: unknown }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "POST") { posts.push({ url, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
  const body =
    url.startsWith("/api/projects?project=bot") ? { id: "bot", name: "bot", firm: "noologic", parent: null, path: "/w/bot", grants: { mcp: ["viewer"], skills: [] }, secrets: [], rules: 0,
        effective: { mcp: [{ item: "viewer", from: "project:bot" }, { item: "obsidian", from: "firm:noologic" }], skills: [], rules: [], secrets: [{ secret: "tg_bot", from: "firm:noologic" }] } }
    : url.startsWith("/api/mcp-registry") ? { servers: [{ name: "viewer", type: "http", granted_to: ["project:bot"], fleet_env: [] }, { name: "obsidian", type: "http", granted_to: ["firm:noologic"], fleet_env: [] }, { name: "firecrawl", type: "http", granted_to: [], fleet_env: [] }], skills: [{ id: "review", name: "review", description: "", granted_to: [] }], registry: "x" }
    : url.startsWith("/api/secrets") ? { secrets: [] }
    : url.startsWith("/api/orchestrator/hq") ? { seat: { conversationId: "hq1", path: "/hq/t.jsonl" }, pending: null, exists: true }
    : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
afterEach(() => { globalThis.fetch = realFetch; posts.length = 0; });
const flush = () => new Promise((r) => setTimeout(r, 0));

const hq = entry({ path: "/hq/t.jsonl", conversationId: "hq1" } as Partial<FileEntry>);
const agent = entry({ path: "/a.jsonl", title: "Bot worker", model: "opus", activity: "live", org: { firm: "noologic", firmName: "Noologic", project: "bot", projectName: "bot", via: "path" } });

test("lists agents and effective grants with their source, revokes own, tells HQ", async () => {
  setLocale("uk");
  const opened: string[] = [];
  const el = mount(<ProjectConsole project="bot" files={[hq, agent]} onOpenFile={(f) => opened.push(f.path)} onCreateAgent={() => {}} />);
  for (let i = 0; i < 4; i += 1) await act(flush);
  expect(el.querySelector('[data-console-agent="/a.jsonl"]')?.textContent).toContain("Bot worker");
  expect(el.querySelector('[data-console-row="mcp:viewer"]')?.textContent).toContain("власний");
  expect(el.querySelector('[data-console-row="mcp:obsidian"]')?.textContent).toContain("від фірми");
  expect(el.querySelector('[data-console-revoke="mcp:obsidian"]')).toBeNull();
  expect(el.querySelector('[data-console-row="secrets:tg_bot"]')).not.toBeNull();
  act(() => { (el.querySelector('[data-console-revoke="mcp:viewer"]') as HTMLButtonElement).click(); });
  await act(flush);
  expect(posts.find((p) => p.url === "/api/mcp-registry")?.body).toEqual({ kind: "mcp", item: "viewer", target: "project:bot", revoke: true });
  act(() => { (el.querySelector("[data-console-tell-hq]") as HTMLButtonElement).click(); });
  await act(flush);
  const sent = posts.find((p) => p.url === "/api/tmux")?.body as { path: string; text: string };
  expect(sent.path).toBe("/hq/t.jsonl");
  expect(sent.text).toBe("Відкриваю проєкт noologic → bot (/w/bot)");
  act(() => { (el.querySelector('[data-console-agent="/a.jsonl"]') as HTMLButtonElement).click(); });
  expect(opened).toEqual(["/a.jsonl"]);
});
```

`hqFileOf(files, status)` matches on the seat's `conversationId` / `path` — read `src/components/mobile/hqSeat.ts:133` and give the test entry whatever field it matches on.

- [ ] **Step 2: Run to verify it fails** — `bun test src/components/desktop/ProjectConsole.dom.test.tsx`.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { engineLabel } from "@/components/feed/engineMark";
import { loadProject, type ProjectDetail } from "@/components/mobile/firmsModel";
import { hqFileOf, useHqSeat } from "@/components/mobile/hqSeat";
import { useMcpRegistry } from "@/components/mobile/mcpModel";
import { shareSecret, useSecretsInventory } from "@/components/mobile/secretsModel";
import { fmtAge } from "@/components/utils";
import { accountIdFromPath, DEFAULT_ACCOUNT_ID } from "@/lib/accounts/badge";
import { useLocale } from "@/lib/i18n";
import { cleanTitle } from "@/lib/title";
import type { FileEntry } from "@/lib/types";

import { effectiveRows, effectiveSecretRows, machineOf, projectAgents, type EffectiveRow } from "./desktopHomeModel";

/*
 * What acts on the chosen project, and who works in it. Everything here is
 * the console's answer (`project_show`) rendered with its origin: an inherited
 * grant is labelled «від фірми» and cannot be revoked from here, an own grant
 * can. Writes go through the same routes the phone's pages use.
 */

export interface ProjectConsoleProps {
  project: string;
  files: readonly FileEntry[];
  onOpenFile: (file: FileEntry) => void;
  onCreateAgent: (project: string) => void;
}

const BTN = "inline-flex h-7 items-center gap-1 rounded-[8px] border border-border px-2 text-[11.5px] font-semibold text-secondary hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50";

export function ProjectConsole({ project, files, onOpenFile, onCreateAgent }: ProjectConsoleProps) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const registry = useMcpRegistry();
  const secrets = useSecretsInventory(true);
  const hq = useHqSeat();
  const [hqNote, setHqNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setDetailError(null);
    loadProject(project)
      .then((answer) => { if (live) setDetail(answer); })
      .catch((cause: unknown) => { if (live) setDetailError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, [project, nonce]);

  const agents = useMemo(() => projectAgents(files, project), [files, project]);
  const target = `project:${project}`;

  const revoke = async (kind: "mcp" | "skills", item: string) => {
    const error = await registry.grant(kind, item, target, true);
    if (!error) setNonce((n) => n + 1);
  };
  const add = async (kind: "mcp" | "skills", item: string) => {
    if (!item) return;
    const error = await registry.grant(kind, item, target);
    if (!error) setNonce((n) => n + 1);
  };
  const unshare = async (secret: string) => {
    const error = await shareSecret(secret, target, true);
    if (!error) setNonce((n) => n + 1);
  };
  const share = async (secret: string) => {
    if (!secret) return;
    const error = await shareSecret(secret, target);
    if (!error) setNonce((n) => n + 1);
  };

  const tellHq = async () => {
    const file = hqFileOf(files, hq.status);
    if (!file || !detail) { setHqNote(t("desktop.tellHqNoSeat")); return; }
    const text = t("desktop.tellHqLine", { firm: detail.firm, project: detail.name || detail.id, path: detail.path ?? "" });
    const response = await fetch("/api/tmux", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: file.path, text }) });
    setHqNote(response.ok ? t("desktop.tellHqSent") : `HTTP ${response.status}`);
  };

  const mcpRows = effectiveRows(detail, "mcp");
  const skillRows = effectiveRows(detail, "skills");
  const secretRows = effectiveSecretRows(detail);
  const have = (rows: EffectiveRow[]) => new Set(rows.map((row) => row.item));
  const mcpChoices = (registry.servers ?? []).map((s) => s.name).filter((name) => !have(mcpRows).has(name));
  const skillChoices = (registry.skills ?? []).map((s) => s.id).filter((id) => !have(skillRows).has(id));
  const secretChoices = (secrets.secrets ?? []).map((s) => s.name).filter((name) => !have(secretRows).has(name));

  return (
    <section data-project-console className="flex flex-col gap-3 border-t border-border px-3 py-3">
      <div className="flex items-center gap-2">
        <button type="button" data-console-create className={`${BTN} border-accent text-accent`} onClick={() => onCreateAgent(project)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />{t("desktop.createAgent")}
        </button>
        <button type="button" data-console-tell-hq className={BTN} onClick={() => void tellHq()} disabled={!detail}>{t("desktop.tellHq")}</button>
      </div>
      {hqNote ? <p role="status" className="text-[11.5px] text-muted">{hqNote}</p> : null}
      {detailError ? <p className="text-[11.5px] text-danger">{t("desktop.detailFailed", { reason: detailError })}</p> : null}

      <Section name="agents" title={t("desktop.sectionAgents")}>
        {agents.length === 0 ? <Empty text={t("desktop.noAgents")} /> : agents.map((file) => {
          const account = accountIdFromPath(file.path);
          const machine = machineOf(file);
          return (
            <button key={file.path} type="button" data-console-agent={file.path} onClick={() => onOpenFile(file)}
              className="flex w-full flex-col items-start gap-0.5 rounded-[8px] px-2 py-1.5 text-left hover:bg-quiet focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <span className="flex w-full items-center gap-1.5">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${file.activity === "live" ? "bg-success animate-pulse" : "bg-strong"}`} aria-hidden />
                <span className="min-w-0 truncate text-[12.5px] font-semibold text-primary">{cleanTitle(file.title)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted">{fmtAge(file.mtime)}</span>
              </span>
              <span className="flex w-full items-center gap-1.5 text-[11px] text-muted">
                <span>{engineLabel(file.engine) ?? file.engine}{file.model ? ` · ${file.model}` : ""}</span>
                {account !== DEFAULT_ACCOUNT_ID ? <span className="truncate">{account}</span> : null}
                {machine ? <span className="ml-auto">{machine}</span> : null}
              </span>
            </button>
          );
        })}
      </Section>

      <GrantSection name="skills" title={t("desktop.sectionSkills")} rows={skillRows} choices={skillChoices} onRevoke={(item) => void revoke("skills", item)} onAdd={(item) => void add("skills", item)} />
      <GrantSection name="mcp" title={t("desktop.sectionMcp")} rows={mcpRows} choices={mcpChoices} onRevoke={(item) => void revoke("mcp", item)} onAdd={(item) => void add("mcp", item)} />
      <GrantSection name="secrets" title={t("desktop.sectionSecrets")} rows={secretRows} choices={secretChoices} onRevoke={(item) => void unshare(item)} onAdd={(item) => void share(item)} />
    </section>
  );
}

function Section({ name, title, children }: { name: string; title: string; children: React.ReactNode }) {
  return (
    <div data-console-section={name} className="flex flex-col gap-0.5">
      <h3 className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 py-1 text-[11.5px] text-muted">{text}</p>;
}

function GrantSection({ name, title, rows, choices, onRevoke, onAdd }: { name: "skills" | "mcp" | "secrets"; title: string; rows: EffectiveRow[]; choices: string[]; onRevoke: (item: string) => void; onAdd: (item: string) => void }) {
  const { t } = useLocale();
  return (
    <Section name={name} title={title}>
      {rows.length === 0 ? <Empty text={t("firms.nothingApplies")} /> : rows.map((row) => (
        <div key={row.item} data-console-row={`${name}:${row.item}`} className="flex min-h-7 items-center gap-2 px-2 text-[12px]">
          <span className="min-w-0 truncate text-primary">{row.item}</span>
          <span className="shrink-0 text-[11px] text-muted">{row.own ? t("desktop.own") : `${t("desktop.fromFirm")} ${row.from.slice(row.from.indexOf(":") + 1)}`}</span>
          {row.own ? (
            <button type="button" data-console-revoke={`${name}:${row.item}`} className="ml-auto text-[11px] font-semibold text-danger hover:underline" onClick={() => onRevoke(row.item)}>{t("desktop.revoke")}</button>
          ) : null}
        </div>
      ))}
      {choices.length ? (
        <select data-console-add={name} value="" aria-label={t("desktop.addGrant")} onChange={(event) => onAdd(event.target.value)}
          className="mx-2 mt-1 h-7 rounded-[8px] border border-border bg-card px-1.5 text-[11.5px] text-secondary">
          <option value="">{t("desktop.addGrant")}</option>
          {choices.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      ) : null}
    </Section>
  );
}
```

Check `useSecretsInventory`'s return shape and `SecretView.name` in `secretsModel.ts` / `src/app/api/secrets/route.ts:44` and adjust the `secretChoices` line to what it actually exposes. `ProjectRow.path` is optional — `detail.path ?? ""` is right.

- [ ] **Step 4: Mount in `DesktopHome`**: below `<OrgTree …/>` render `{selectedProject ? <ProjectConsole project={selectedProject} files={files} onOpenFile={onOpenFile} onCreateAgent={onCreateAgent} /> : null}` and drop the `projectConsole` prop.

- [ ] **Step 5: Verify** — `bun test src/components/desktop/ProjectConsole.dom.test.tsx src/components/desktop/DesktopHome.dom.test.tsx` and `bunx eslint src/components/desktop`.

- [ ] **Step 6: Commit**

```bash
git add src/components/desktop src/lib/i18n/uk.ts src/lib/i18n/en.ts
git commit -m "Пульт проєкту: агенти, скіли, MCP і секрети з джерелом, і «Сказати HQ»"
```

---

### Task 5: «Створити агента» — one click, project pre-filled, firms as optgroups

**Files:**
- Modify: `src/components/mobile/MobileMachinesScreen.tsx` (props + project `<select>`), `src/components/desktop/DesktopHome.tsx` (right panel), `src/components/OverviewBoard.tsx` (mobile: a button above `grid`), `src/lib/i18n/{uk,en}.ts`
- Test: `src/components/desktop/DesktopHome.dom.test.tsx` (extend), `src/components/mobile/MobileMachinesScreen.dom.test.tsx` (new, optgroup + initialProject)

**Interfaces:**
- `MobileMachinesScreen` gains `initialProject?: string`: `useState(initialProject ?? "")` for `project`, and a `useEffect` that sets it when the prop changes. Its project `<select>` groups by firm: `(org.firms ?? []).map(firm => <optgroup key label={firm.name || firm.id}>{projectTree(org.projects ?? [], firm.id).flatMap(({row, children}) => [row, ...children]).map(row => <option …>)}</optgroup>)`.
- `DesktopHome` state `const [createFor, setCreateFor] = useState<string | null | undefined>(undefined)` (`undefined` = closed). `onCreateAgent` from `ProjectConsole` sets it. A header button `data-desktop-create` (label `t("desktop.createAgent")`) sets it to `selectedProject`. When not `undefined`, render the same fixed right panel `DesktopMenu` draws (copy its `<div className="fixed inset-0 z-50 flex justify-end bg-black/20">…` block with the close button, max-width 560) containing `<SuppressMobileTabs><MobileMachinesScreen host={null} initialProject={createFor ?? undefined} /></SuppressMobileTabs>`; Esc and the backdrop close it (`setCreateFor(undefined)`).
- Mobile: in `OverviewBoard`'s `isMobile` branch, wrap `{grid}` as `<><button type="button" data-mobile2-create-agent … onClick={() => mobileNav.push({ kind: "machines" })}>{t("desktop.createAgent")}</button>{grid}</>` — a full-width 44px button with `mx-3 mt-3` and the accent outline used by `MobileHqRoom`'s `ACTION` constant.

- [ ] **Step 1: Write the failing tests**

Extend `DesktopHome.dom.test.tsx`:
```tsx
test("«Створити агента» opens the machines form on the right", async () => {
  setLocale("uk");
  const el = mount(<DesktopHome files={[]} selectedProject={null} onSelectProject={() => {}} onOpenBoard={() => {}} onOpenBoardProject={() => {}} onOpenFile={() => {}} onCreateAgent={() => {}} />);
  await act(flush);
  act(() => { (el.querySelector("[data-desktop-create]") as HTMLButtonElement).click(); });
  await act(flush);
  expect(el.querySelector("[data-desktop-create-panel]")).not.toBeNull();
  expect(el.querySelector('select[aria-label="Проєкт"]')).not.toBeNull();
});
```
(After Task 5 `onCreateAgent` is internal to DesktopHome; drop the prop from `DesktopHomeProps` and from the Viewer call site.)

New `src/components/mobile/MobileMachinesScreen.dom.test.tsx`:
```tsx
/* prelude; fetch answering /api/machines?probe=0 → { machines: [] }, /api/firms → one firm "noologic" named "Noologic", /api/projects → bot + money (as in Task 2) */
import { MobileMachinesScreen } from "./MobileMachinesScreen";
test("projects are grouped by firm and the initial project is selected", async () => {
  const el = mount(<MobileMachinesScreen host={null} initialProject="money" />);
  await act(flush); await act(flush);
  const select = el.querySelector('select[aria-label="Проєкт"]') as HTMLSelectElement;
  expect(select.querySelector('optgroup[label="Noologic"]')).not.toBeNull();
  expect(select.value).toBe("money");
});
```
Read `MobileMachinesScreen.tsx` first: `useMachines` fetches `/api/machines` on mount; answer it with `{ machines: [] }`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** the three edits described under Interfaces. Keys: reuse `desktop.createAgent` from Task 4; nothing new.

- [ ] **Step 4: Verify** — `bun test src/components/desktop/DesktopHome.dom.test.tsx src/components/mobile/MobileMachinesScreen.dom.test.tsx src/components/OverviewBoard.render.test.tsx src/components/OverviewBoard.firstRun.dom.test.tsx` and `bunx eslint` on the four files.

- [ ] **Step 5: Commit**

```bash
git add src/components/mobile/MobileMachinesScreen.tsx src/components/mobile/MobileMachinesScreen.dom.test.tsx src/components/desktop src/components/OverviewBoard.tsx src/components/Viewer.tsx src/lib/i18n/uk.ts src/lib/i18n/en.ts
git commit -m "«Створити агента» на один клік, проєкт уже підставлений, фірми групами"
```

---

### Task 6: Agent conversation from the console, and «Перенести» on the desktop

**Files:**
- Modify: `src/components/Viewer.tsx` (done in Task 3: `onOpenFile` flips to the board without persisting), `src/components/ProjectDashboard.tsx` (~line 1281–1307 `addTransferDraft`, ~line 2333 where `onHandoff={addHandoffDraft}` is passed to the desktop scheme), `src/components/HandoffHandle.tsx` or `src/components/TaskHeader.tsx` (whichever renders the desktop handoff control — `grep -n "onHandoff" src/components/*.tsx`), `src/lib/i18n/{uk,en}.ts`
- Test: `src/components/TaskHeader.transfer.dom.test.tsx` (new; mirror the structure of `TaskHeader.killConfirm.dom.test.tsx`)

**Interfaces:**
- The component that receives `onHandoff` on the desktop gains `onTransfer?: () => void` and renders, beside the handoff control, `<button data-transfer aria-label={t("transfer.label")} title={t("transfer.label")} onClick={onTransfer}>` with the `ArrowRightLeft` icon from `lucide-react`. `ProjectDashboard` passes `onTransfer={(file) => { void addTransferDraft(file); }}` at the same call site as `onHandoff` (line ~2333) and threads it through any intermediate component the same way `onHandoff` travels (follow the prop by grep; add `onTransfer` next to every `onHandoff`).
- Behaviour after the click is the existing one: `addTransferDraft` writes a draft whose first prompt is sessionmem's brief and shows `t("transfer.ready")` (already in `uk.ts:2391`). The draft's own engine/account pickers are the account switch.

i18n: `"transfer.label": "перенести на іншу машину / акаунт" / "move to another machine / account"`.

- [ ] **Step 1: Write the failing test** — mount the component with `onTransfer` as a spy, assert `[data-transfer]` exists and the click calls it; mount without it, assert the button is absent.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the prop, the button, and the threading from `ProjectDashboard`.
- [ ] **Step 4: Verify** — the new test plus `bun test src/components/TaskHeader.killConfirm.dom.test.tsx src/components/ProjectDashboard.selection.dom.test.tsx`; `bunx eslint` on touched files.
- [ ] **Step 5: Commit** — `git commit -m "«Перенести» є і на десктопі, з того самого брифа, що на телефоні"`.

---

### Task 7: Build, deploy, look at it

**Files:** none new.

- [ ] **Step 1:** `bunx tsc --noEmit` clean; `bun run build` succeeds locally.
- [ ] **Step 2:** `git push origin main` (the pre-push privacy gate runs; do not bypass it).
- [ ] **Step 3:** On walter as `pi`: `cd ~/work/fleet && git pull --ff-only && export PATH=$HOME/.bun/bin:$PATH && bun run build`, then restart the server in tmux session `fleet` (read `.run-env.sh` there for the exact start line; `tmux send-keys -t fleet C-c` then the start command).
- [ ] **Step 4:** Open `https://walter.tailfdf1ad.ts.net` at ≥1024px: console column + HQ room; pick a project; «Створити агента»; «Дошка» and «HQ · Чат» round trip. Screenshot to `../outbox/` for the operator.
