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
- Never run the whole suite (`bun test` bare kills the operator's live host). Run only the files named in each task. ESLint is broken in this checkout (React plugin vs ESLint 10) — use `bunx tsc --noEmit -p tsconfig.json` as the static gate instead.
- Privacy gate on push: no e-mail addresses, no absolute `/home/<user>/…` paths, no `Co-authored-by` trailers in commits or files. Commit messages: one Ukrainian sentence saying what changed, like the repo's history.
- Mobile behaviour is unchanged except the shared launch form (Task 5) and the phone entry button (Task 7).
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

### Task 4: fleetctl — fresh code on the target, and what code each machine holds

**Files (repo `/home/dchuprina/projects/agents`, i.e. `../` from fleet):**
- Modify: `fleetctl/fleetlib/spawn.py` (`session_spawn`, `session_transfer`), `fleetctl/fleetlib/registry.py` (the two `Func` entries + one new), `fleetctl/README.md` (one paragraph under the sessions section)
- Create: `fleetctl/fleetlib/code.py`, `fleetctl/tests/test_code.py`, `fleetctl/tests/test_spawn_fresh.py`

**Interfaces:**
- Consumes: `hosts.load/get/_probe/is_local`, `spawn._run(entry, cmd, timeout=…)` (returns an object with `.returncode/.stdout/.stderr`), `orgs.load/get_project` (project node has `path`, `paths`, `repo`).
- Produces:
  ```python
  # fleetlib/code.py
  def project_code(project: str, host: str | None = None) -> dict
  # → {"project": id, "hosts": [{"host", "path", "exists": bool, "branch": str, "head": str, "dirty": bool, "detail": str}]}
  #   one row per registered host (or the one named); a host that does not answer → exists False, detail = probe detail
  def freshen(entry: dict, where: str, repo: str) -> dict
  # → {"action": "cloned" | "pulled" | "unchanged" | "kept", "detail": str}
  #   where missing & repo → git clone repo where ; where missing & no repo → raise NotFound (the existing message)
  #   where is a git checkout → git pull --ff-only ; failure (diverged, dirty) → raise FleetError with git's stderr[:200], nothing launched
  #   where exists but is not a checkout → "kept" (plain directory, launch as before)
  ```
  `session_spawn(..., fresh: bool = False)` and `session_transfer(..., fresh: bool = False)`: when `fresh`, call `freshen` before the directory check and put its result under `"code"` in the return dict. Registry: `Param("fresh", "bool", "оновити код перед стартом: pull, або clone якщо теки нема", default=False)` on both; new `Func("project_code", "Який код проєкту лежить на кожній машині: гілка, коміт, чи брудна тека", code.project_code, [Param("project", …, required=True), Param("host", "str", "лише ця машина")])`, read-only (`mutates=False`).
  Git commands run on the target through `_run`, quoted with `shlex.quote`, e.g. `cd <where> && git rev-parse --is-inside-work-tree` / `git rev-parse --abbrev-ref HEAD` / `git rev-parse --short HEAD` / `git status --porcelain | head -1`.

- [ ] **Step 1: Tests first.** `fleetctl/tests/test_code.py` monkeypatches `fleetlib.code._run` with a fake that records commands and answers from a dict keyed by substring (`"is-inside-work-tree" → "true"`, `"abbrev-ref" → "main"`, `"--short HEAD" → "abc1234"`, `"porcelain" → ""`), and `hosts.load` with two hosts (`walter` local, `ryzen` ssh). Cases: (a) `project_code` lists both hosts, walter exists with branch `main`, head `abc1234`, `dirty False`; ryzen `exists False` when its probe says unreachable. (b) `freshen` with missing dir and repo → issues `git clone <repo> <where>` and returns `cloned`. (c) missing dir, no repo → `NotFound`. (d) checkout → `git pull --ff-only`, returns `pulled`; pull failing (returncode 1) → `FleetError`. (e) plain directory → `kept`, no git command issued. `test_spawn_fresh.py`: monkeypatch `spawn._run`, `spawn.hosts._probe`, `spawn.hosts.engine_path`, `spawn.orgs.load`; assert `session_spawn(..., fresh=True)` calls `code.freshen` once before the tmux commands and echoes its result under `"code"`; `fresh=False` never calls it. Run: `cd ../fleetctl && python3 -m pytest tests -q` (if pytest is absent: `python3 -m unittest discover -s tests -q`; write the tests with `unittest` so both work).
- [ ] **Step 2:** run, see them fail (ImportError / TypeError on `fresh`).
- [ ] **Step 3:** implement `code.py`, the two `fresh` parameters, the registry entries, the README paragraph.
- [ ] **Step 4:** tests pass; `cd ../fleetctl && ./fleetctl functions | grep -E "project_code|session_spawn"` shows the new function and the `--fresh` flag (`./fleetctl session_spawn --help`).
- [ ] **Step 5:** commit in the agents repo: `git -C .. add fleetctl && git -C .. commit -m "Свіжий код перед стартом сесії: pull або clone, і що лежить на кожній машині"`.

---

### Task 5: Launch form shared by phone and desktop — machine, LLM, model, subscription

**Files:**
- Create: `src/components/machines/LaunchForm.tsx`, `src/components/machines/launchForm.ts` (the hook), `src/components/machines/LaunchForm.dom.test.tsx`
- Modify: `src/components/mobile/MobileMachinesScreen.tsx` (becomes a thin shell around `LaunchForm`), `src/components/mobile/machinesModel.ts` (`SpawnInput.fresh?: boolean`), `src/app/api/machines/route.ts` (pass `fresh` through: `fresh: body.fresh === true`), `src/lib/i18n/{uk,en}.ts`

**Interfaces:**
- Consumes: `useMachines/useOrg/projectTree`, `ENGINE_MODELS` + `defaultModelFor` (`src/lib/agent/models.ts`), the console's `session_spawn(fresh)` from Task 4.
- Produces:
  ```tsx
  export interface LaunchFormProps {
    /** Console project id to start with; the picker stays editable. */
    initialProject?: string;
    /** "start" or "move"; move needs a source machine and a tmux session. */
    initialMode?: "start" | "move";
    initialSession?: { host: string; tmux: string };
    /** Compact = desktop column (labels beside controls, 32px rows); default = phone (44px rows). */
    compact?: boolean;
    onStarted?: (result: SpawnResult, moved: boolean) => void;
  }
  export function LaunchForm(props: LaunchFormProps): JSX.Element;
  ```
  Fields, in this order, each a labelled control with `aria-label` = its label: **Machine** (`machines.machine`, radio-like buttons from the registry, unreachable ones disabled with their `status.detail` as title), **Project** (`machines.project`, `<select>` with `<optgroup>` per firm), **LLM** (`machines.engine`, Claude / Codex from `enginesPresent(machine)`), **Model** (`machines.model` — NEW key: "Модель"/"Model", `<select>` over `ENGINE_MODELS[engine]`, default `defaultModelFor(engine)`; changing the engine resets it), **Subscription** (`machines.account` — the machine's profiles from `accountsOn`; label the empty choice `machines.machineDefault`), **Fresh code** (`machines.fresh` NEW: "Оновити код перед стартом (pull / clone)" / "Refresh code before start (pull / clone)", a checkbox, checked by default), **First prompt** (`machines.prompt`, hidden in move mode), and the verb button (`machines.start` / `machines.move`). The spawn call sends `{ host, project, engine, model, account?, fresh, prompt? }`. The result block after a start shows `started.cwd`, and `started.code?.action` when the console reports one (NEW key `machines.code`: "Код: {action}" / "Code: {action}").
  Move mode keeps the existing source-machine + session pickers (moved verbatim from `MobileMachinesScreen`).
  `MobileMachinesScreen` renders `<MobileShell screen="machines" …><LaunchForm initialProject={initialProject} /></MobileShell>` and nothing else of its own.

- [ ] **Step 1: Failing test** (`LaunchForm.dom.test.tsx`, prelude from «Test harness»; `fetch` answers `/api/machines?probe=0` and `/api/machines` with `{ machines: [{ id: "walter", ssh: null, engines: ["claude","codex"], is_local: true, status: { reachable: true, detail: "" } }, { id: "ryzen", ssh: "ryzen", engines: ["claude"], status: { reachable: false, detail: "спить" } }] }`, `?host=walter&accounts=1` with `{ profiles: ["daria", "kostya"] }`, `/api/firms` + `/api/projects` as in Task 2; POST `/api/machines` records the body and answers `{ session: { host: "walter", project: "bot", engine: "claude", tmux: "fc-bot-1", cwd: "/w/bot", attach: "", code: { action: "pulled" } } }`):
  - projects grouped by firm, `initialProject="money"` preselected;
  - the ryzen button is disabled with title "спить";
  - picking walter loads accounts; picking `kostya`;
  - model select defaults to `opus`; switching LLM to Codex changes the default to `gpt-6-astra`;
  - clicking «Запустити» POSTs `{ host: "walter", project: "money", engine: "codex", model: "gpt-6-astra", account: "kostya", fresh: true }` and the page shows "pulled".
- [ ] **Step 2:** run, fails.
- [ ] **Step 3:** implement; move the state/effects out of `MobileMachinesScreen.tsx` into `launchForm.ts` (`useLaunchForm(props)`) and the JSX into `LaunchForm.tsx`; delete the duplicated code from the mobile screen.
- [ ] **Step 4:** `bun test src/components/machines/LaunchForm.dom.test.tsx`; `bunx eslint src/components/machines src/components/mobile/MobileMachinesScreen.tsx src/app/api/machines/route.ts`.
- [ ] **Step 5:** commit: `Форма запуску одна на телефон і десктоп: машина, LLM, модель, підписка, свіжий код`.

---

### Task 6: Project console — launch first, sessions with «перенести», accordions for the rest

**Files:**
- Create: `src/components/desktop/ProjectConsole.tsx`, `src/components/desktop/ProjectConsole.dom.test.tsx`
- Modify: `src/components/desktop/DesktopHome.tsx` (mount it under the tree; drop the `projectConsole` slot and the `onCreateAgent` prop — Viewer call site too), `src/app/api/projects/route.ts` (GET `?project=x&code=1` → `fleetctl({ fn: "project_code", params: { project } })`), `src/lib/i18n/{uk,en}.ts`

**Interfaces:**
- Consumes: `LaunchForm` (Task 5), Task 1 functions, `loadProject`, `useMcpRegistry`, `shareSecret`, `useSecretsInventory`, `useHqSeat` + `hqFileOf`, `engineLabel`, `accountIdFromPath` + `DEFAULT_ACCOUNT_ID`, `cleanTitle`, `fmtAge`.
- Produces:
  ```tsx
  export interface ProjectConsoleProps { project: string; files: readonly FileEntry[]; onOpenFile: (file: FileEntry) => void }
  export function ProjectConsole(props: ProjectConsoleProps): JSX.Element;
  ```
  Layout, top to bottom, inside `<section data-project-console>`:
  1. Project name + firm, and «Сказати HQ» (`data-console-tell-hq`; POST `/api/tmux` `{ path: hqFile.path, text: t("desktop.tellHqLine", {firm, project, path}) }`; `t("desktop.tellHqNoSeat")` when there is no seat).
  2. **«Запустити сесію»** — `<LaunchForm compact initialProject={project} />` open by default (`data-console-launch`).
  3. **Сесії** — `projectAgents(files, project)`: live ones listed (`data-console-agent="<path>"`, title / engine · model / account small / machine when `machineOf` names one / age; tap → `onOpenFile`), each with a «перенести» button (`data-console-move="<path>"`) that re-renders the launch form in move mode with `initialSession={{ host: machineOf(file) || "walter", tmux: file.conversationId ?? "" }}` — read `FileEntry` for the field that carries the tmux/session id; if none exists on the entry, the button opens move mode with the source machine only and the session picker empty (honest, not invented).
  4. Accordions, all collapsed by default, native `<details>` with `data-console-accordion="old|code|skills|mcp|secrets"`:
     - **Архів проєкту** — NOT raw rows. Loads `GET /api/archive?project=<console id>` (Task 9) on first open and shows sessionmem cards: title, `ended_at` age, machine, a «можна продовжити» badge when `resumable`, then the `summary` sentence; a nested `<details>` per card reveals `did / broke / decided / left` and a «повний транскрипт» button that calls `onOpenFile` with the matching `FileEntry` when one exists in `files` (by `transcript_path === file.path`), otherwise says `t("archive.transcriptElsewhere")`. Cards missing a summary show `t("archive.noCard")`. Keys: `desktop.sectionArchive` "Архів проєкту"/"Project archive".
     - **Код на машинах** — loads `GET /api/projects?project=<id>&code=1` on first open; one row per host: host, `branch @ head`, «брудна» badge when dirty, `detail` when it does not exist. NEW keys: `desktop.sectionCode` "Код на машинах"/"Code on machines", `desktop.codeMissing` "теки немає"/"no directory", `desktop.codeDirty` "незакомічені зміни"/"uncommitted changes".
     - **Скіли / MCP / Секрети** — `effectiveRows` / `effectiveSecretRows` with source label («власний» / «від фірми X»), revoke on own rows (`data-console-revoke="<kind>:<item>"` → `registry.grant(kind, item, "project:<id>", true)` / `shareSecret(item, "project:<id>", true)`), an add `<select data-console-add="<kind>">` of registry items not yet effective.
  i18n keys (uk / en): `desktop.launchTitle` "Запустити сесію"/"Start a session", `desktop.sectionSessions` "Сесії"/"Sessions", `desktop.sectionOld` "Старі сесії"/"Old sessions", `desktop.move` "перенести"/"move", `desktop.noAgents` "У проєкті ще немає сесій."/"No sessions in this project yet.", `desktop.sectionSkills` "Скіли"/"Skills", `desktop.sectionMcp` "MCP"/"MCP", `desktop.sectionSecrets` "Секрети"/"Secrets", `desktop.fromFirm` "від фірми"/"from firm", `desktop.own` "власний"/"own", `desktop.revoke` "зняти"/"revoke", `desktop.addGrant` "+ видати"/"+ grant", `desktop.tellHq` "Сказати HQ"/"Tell HQ", `desktop.tellHqLine` "Відкриваю проєкт {firm} → {project} ({path})"/"Opening project {firm} → {project} ({path})", `desktop.tellHqSent` "HQ отримав."/"HQ has it.", `desktop.tellHqNoSeat` "HQ не запущений."/"HQ is not running.", `desktop.detailFailed` "Проєкт не читається: {reason}"/"Project could not be read: {reason}", plus the three code keys above.

- [ ] **Step 1: Failing test** (prelude; `fetch` answers `/api/projects?project=bot` with the Task-6-shaped detail `{ id:"bot", name:"bot", firm:"noologic", path:"/w/bot", effective:{ mcp:[{item:"viewer",from:"project:bot"},{item:"obsidian",from:"firm:noologic"}], skills:[], rules:[], secrets:[{secret:"tg_bot",from:"firm:noologic"}] } }`, `&code=1` with `{ hosts:[{ host:"walter", path:"/w/bot", exists:true, branch:"main", head:"abc1234", dirty:false, detail:"" }] }`, `/api/mcp-registry`, `/api/secrets`, `/api/orchestrator/hq` (seat `{ conversationId:"hq1", path:"/hq/t.jsonl" }`), `/api/machines*`, `/api/firms`, `/api/projects` as in Task 5's test; POSTs recorded). Files: an HQ entry, one live agent `org.project = "bot"`, one old agent. Assert: launch form present with project preselected `bot`; live agent row present and clicking it calls `onOpenFile`; old agent NOT in the live list but present after opening `[data-console-accordion="old"]`; opening `code` accordion fetches `&code=1` and shows `main @ abc1234`; `mcp:viewer` says «власний» and has a revoke button, `mcp:obsidian` says «від фірми» and has none; revoke POSTs `{ kind:"mcp", item:"viewer", target:"project:bot", revoke:true }`; «Сказати HQ» POSTs `{ path:"/hq/t.jsonl", text:"Відкриваю проєкт noologic → bot (/w/bot)" }`.
- [ ] **Step 2:** run, fails. **Step 3:** implement. **Step 4:** `bun test src/components/desktop/ProjectConsole.dom.test.tsx src/components/desktop/DesktopHome.dom.test.tsx`; eslint on `src/components/desktop src/app/api/projects/route.ts`.
- [ ] **Step 5:** commit: `Пульт проєкту: запуск на будь-якій машині першим, сесії з «перенести», решта в акордеонах`.

---

### Task 7: Mobile entry, desktop «перенести» in the board, and the plan's loose ends

**Files:**
- Modify: `src/components/OverviewBoard.tsx` (mobile branch: a 44px «Запустити сесію» button above `grid` → `mobileNav.push({ kind: "machines" })`, `data-mobile2-launch`), `src/components/mobile/mobileNav.ts` (add `"machines"`, `"permissions"`, `"channels"` to `SCREEN_KINDS` so a reload on those screens restores them), `src/components/ProjectDashboard.tsx` + the desktop component that renders the handoff control (`grep -n "onHandoff" src/components/*.tsx`): thread `onTransfer` beside `onHandoff` and render a `data-transfer` button with `ArrowRightLeft`, calling the existing `addTransferDraft(file)` (ProjectDashboard ~line 1285); NEW key `transfer.label` "перенести на іншу машину / акаунт" / "move to another machine / account".
- Test: `src/components/OverviewBoard.mobileLaunch.dom.test.tsx` (button present on the phone and pushes the machines screen — assert via `getMobileNav()` state), and a `*.transfer.dom.test.tsx` beside the component that gains `onTransfer` (button present with the prop, absent without, click calls it).
- [ ] Steps: failing tests → implement → `bun test` the two new files plus `src/components/OverviewBoard.render.test.tsx src/components/mobile/mobileNav.test.ts` → eslint → commit `Запуск сесії з телефона на один тап, і «перенести» на десктопній дошці`.

---

### Task 8: Build, deploy, look at it

- [ ] **Step 1:** `bunx tsc --noEmit` clean; `bun run build` succeeds locally (fleet).
- [ ] **Step 2:** STOP and ask the operator before pushing: `git push origin desktop-hq` then merge to main (the pre-push privacy gate runs; do not bypass it). The agents repo (fleetctl change) is pushed the same way.
- [ ] **Step 3:** On walter as `pi`: `cd ~/work && git pull --ff-only` (fleetctl), then `cd ~/work/fleet && git pull --ff-only && export PATH=$HOME/.bun/bin:$PATH && bun run build`, restart the server in tmux session `fleet` (read `.run-env.sh` there for the exact start line).
- [ ] **Step 4:** Open the tailnet URL at ≥1024px: console column + HQ room; pick a project; launch form with the four pickers; «Дошка» and «HQ · Чат» round trip. Screenshot to `../outbox/`.

---

### Task 9: Archive of sessions — summaries, not a pile

**Why (operator, 2026-09-08):** «всі старі сесії, яких уже не можна відновити, просто дають самарі, ключові моменти, історію для векторів у Qdrant; окремо — архів сесій, підписаних машина / проєкт; тицяєш акордеон — коротке самарі, за бажанням повний транскрипт; не треба звалища старих сесій у дашборді».
`sessionmem` (`../sessionmem`, on walter `~/work/sessionmem`) already does the digestion: hourly `sync` = index + cards (`summary/did/broke/decided/left`, Cohere) + vectors into Qdrant. This task only READS it and replaces the two «pile» surfaces.

**Files:**
- Create: `src/app/api/archive/route.ts`, `src/lib/archive/sessionmemArchive.ts` (+ `.test.ts`), `src/components/archive/ArchiveScreen.tsx` (+ `.dom.test.tsx`), `src/components/archive/archiveModel.ts` (+ `.test.ts`)
- Modify: `src/components/desktop/OrgTree.tsx` (replace the «Без проєкту» bucket and its rows with ONE row `data-org-archive` labelled `t("archive.title")` + the count of archived sessions from `/api/archive?count=1`; delete `data-org-unassigned*`; update `OrgTree.dom.test.tsx` accordingly), `src/components/mobile/MobileRootScreen.tsx` + `mobileNav.ts` (new screen kind `"archive"`, in `SCREEN_KINDS`, a settings row `t("archive.title")`), `src/components/DesktopMenu.tsx` (menu item `archive`), `src/components/desktop/DesktopHome.tsx` (the `data-org-archive` row opens the archive in the right-side panel used for the launch form), `src/lib/i18n/{uk,en}.ts`

**Interfaces:**
- `src/lib/archive/sessionmemArchive.ts` (server): `readArchive(opts: { project?: string; cwdPrefixes?: string[]; limit?: number }): Promise<ArchiveCard[]>` — runs `python3 -c <SCRIPT>` inside `SESSIONMEM_DIR` exactly like `src/app/api/sessionmem/brief/route.ts` does (same env, same 20 s timeout), where the script opens `index.connect()` and selects from `sessions` (+ card columns; read `lib/api.py:_session_out` for the column names) ordered by `ended_at DESC`, filtered by `cwd LIKE prefix || '%'` for each prefix, limit 200. Machine: `host` = `/pulled/<host>/` in `transcript_path` else `os.hostname()` (sessionmem indexes local files only — honest).
  ```ts
  export interface ArchiveCard { sessionId: string; title: string; project: string; cwd: string; host: string; engine: "claude" | "codex"; endedAt: number | null; msgCount: number; resumable: boolean; transcriptPath: string | null; summary: string; did: string[]; broke: string[]; decided: string[]; left: string[] }
  ```
- `GET /api/archive` → `{ cards: ArchiveCard[] }`; `?project=<console id>` resolves the console project's `path` + `paths` via `fleetctl project_show` and passes them as `cwdPrefixes`; `?count=1` → `{ count }`. Errors → `{ error }` with 503 when sessionmem is absent (`NOT_INSTALLED`, like the brief route).
- `archiveModel.ts` (pure): `groupArchive(cards): { host: string; projects: { project: string; cards: ArchiveCard[] }[] }[]` — machine → project → cards, newest first inside; `cardAge(card, now)`.
- `ArchiveScreen({ host, renderSheet, project? })`: `MobileShell screen="archive"`; groups as headings (`data-archive-host`, `data-archive-project`); each card a native `<details data-archive-card="<sessionId>">`: summary line = title · age · «можна продовжити» badge when resumable; open = `summary` paragraph + four short lists (only non-empty ones, labelled `archive.did/broke/decided/left`: "Зробили"/"Зламалось"/"Вирішили"/"Лишилось" — en "Did"/"Broke"/"Decided"/"Left") + «Повний транскрипт» (`data-archive-transcript`) → opens `#f=` deep link of the transcript when a `FileEntry` with that path exists (use the app's own deep-link helper the search palette uses — `grep -n "f=" src/components/search/*.tsx`), else disabled with `t("archive.transcriptElsewhere")` "транскрипт на іншій машині"/"transcript is on another machine". Empty archive → `t("archive.empty")` "Архів порожній."/"The archive is empty."; missing card → `t("archive.noCard")` "самарі ще не зроблено"/"no summary yet". Title key `archive.title` "Архів сесій"/"Session archive".
- Tests: `sessionmemArchive.test.ts` covers only the pure parts (row → `ArchiveCard`, host derivation) with the python call injected; `archiveModel.test.ts` covers grouping and order; `ArchiveScreen.dom.test.tsx` mounts with `fetch` answering two cards on two hosts and asserts headings, the resumable badge, the details content and the disabled transcript button.

- [ ] Steps: tests first (RED) → implement → `~/.bun/bin/bun test` the four new/changed test files + `src/components/desktop/OrgTree.dom.test.tsx src/components/mobile/mobileNav.test.ts` → tsc gate → commit `Архів сесій: самарі з sessionmem по машинах і проєктах замість звалища старих сесій`.
