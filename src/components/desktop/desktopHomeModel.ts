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
