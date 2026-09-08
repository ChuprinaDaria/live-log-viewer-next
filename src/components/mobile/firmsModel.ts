"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * The org layer as the phone reads it: firms, their projects, and the console
 * writes the page can make.
 *
 * People (Даша, Костя) are a FIELD ON THE FIRM. They are not projects and not
 * a level of the hierarchy, so nothing here ever folds them into the project
 * list — the model keeps them a separate array and the screen keeps them a
 * separate block.
 */

export interface FirmRow {
  id: string;
  name: string;
  projects: string[];
  people: string[];
  grants: { mcp: string[]; skills: string[] };
  secrets: string[];
  rules: number;
  updated_at?: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  firm: string;
  parent: string | null;
  path?: string;
  grants: { mcp: string[]; skills: string[] };
  secrets: string[];
  rules: number;
}

export interface EffectiveItem { item: string; from: string }
export interface EffectiveRule { rule: string; from: string }

export interface ProjectDetail extends ProjectRow {
  note?: string;
  chain?: string[];
  children?: string[];
  effective?: { mcp?: EffectiveItem[]; skills?: EffectiveItem[]; rules?: EffectiveRule[] };
}

export interface FirmDetail extends Omit<FirmRow, "rules"> {
  note?: string;
  rules: string[];
  docs: string[];
}

export interface OrgRead {
  firms: FirmRow[] | null;
  projects: ProjectRow[] | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...(signal ? { signal } : {}) });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

export function useOrg(): OrgRead {
  const [firms, setFirms] = useState<FirmRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const [firmsBody, projectsBody] = await Promise.all([
        readJson<{ firms: FirmRow[] }>("/api/firms", signal),
        readJson<{ projects: ProjectRow[] }>("/api/projects", signal),
      ]);
      setFirms(firmsBody.firms ?? []);
      setProjects(projectsBody.projects ?? []);
      setError(null);
    } catch (cause) {
      if ((cause as { name?: string }).name !== "AbortError") {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { firms, projects, error, loading, refresh: () => load() };
}

/** One project's detail, including where each grant and rule came from. */
export async function loadProject(project: string): Promise<ProjectDetail> {
  return readJson<ProjectDetail>(`/api/projects?project=${encodeURIComponent(project)}`);
}

export async function loadFirm(firm: string): Promise<FirmDetail> {
  return readJson<FirmDetail>(`/api/firms?firm=${encodeURIComponent(firm)}`);
}

/** Writes go through the console; resolves with its error text or null. */
export async function writeOrg(url: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = await response.json() as { error?: string };
    return response.ok ? null : answer.error ?? `HTTP ${response.status}`;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

/** The firm's projects as a tree: top-level projects, each with its
    subfolders. A subfolder is a project whose `parent` names another. */
export interface ProjectNode { row: ProjectRow; children: ProjectRow[] }

export function projectTree(projects: readonly ProjectRow[], firm: string): ProjectNode[] {
  const mine = projects.filter((row) => row.firm === firm);
  const roots = mine.filter((row) => !row.parent);
  const orphans = mine.filter((row) => row.parent && !mine.some((candidate) => candidate.id === row.parent));
  return [...roots, ...orphans].map((row) => ({
    row,
    children: mine.filter((child) => child.parent === row.id),
  }));
}

/** Where a grant came from, as a short human phrase: own, or the firm's. */
export function originLabel(from: string, firmId: string): "own" | "firm" | "other" {
  if (from.startsWith("project:")) return "own";
  return from === `firm:${firmId}` ? "firm" : "other";
}
