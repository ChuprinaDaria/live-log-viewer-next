"use client";

import { useSyncExternalStore } from "react";

/*
 * Which surface the phone's «Сесії» tab is, and which project its console
 * stands on. Same shape as the desktop's `desktopHomeModel`, one storage
 * apart: the mode is a preference and lives across visits, the project is
 * where the operator happens to be standing and lives for the session.
 *
 * The mode has a second reader — the ⋯ menu's row writes it while the board
 * is on screen — so a write announces itself on `window`, and everyone
 * reading through `useMobileHome` re-renders. No store: one boolean does not
 * need one.
 */

export type MobileHome = "console" | "board";

export const MOBILE_HOME_KEY = "llvMobileHome";
export const MOBILE_CONSOLE_PROJECT_KEY = "llvMobileConsoleProject";
/** Broadcast on a write, so the board and the menu never disagree. */
export const MOBILE_HOME_EVENT = "llv:mobile-home";

export function readMobileHome(): MobileHome {
  try {
    return localStorage.getItem(MOBILE_HOME_KEY) === "board" ? "board" : "console";
  } catch {
    return "console";
  }
}

export function writeMobileHome(mode: MobileHome): void {
  try {
    localStorage.setItem(MOBILE_HOME_KEY, mode);
  } catch {
    /* private mode: the choice lives for as long as the tab does */
  }
  try {
    window.dispatchEvent(new Event(MOBILE_HOME_EVENT));
  } catch {
    /* no window (a unit test, the server): nobody to tell */
  }
}

/** The console's project, or null when nothing has been chosen this session. */
export function readMobileConsoleProject(): string | null {
  try {
    const value = sessionStorage.getItem(MOBILE_CONSOLE_PROJECT_KEY);
    return value ? value : null;
  } catch {
    return null;
  }
}

export function writeMobileConsoleProject(project: string | null): void {
  try {
    if (project === null) sessionStorage.removeItem(MOBILE_CONSOLE_PROJECT_KEY);
    else sessionStorage.setItem(MOBILE_CONSOLE_PROJECT_KEY, project);
  } catch {
    /* the console still opens; it just forgets where it was */
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(MOBILE_HOME_EVENT, onChange);
  /* Another tab of the same Viewer is the same operator on the same device. */
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MOBILE_HOME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The stored mode. The server render and the hydrating client render both
    answer «console» — reading localStorage during hydration would render one
    tree into another — and the value is re-read the moment hydration is over
    and on every write, so the ⋯ menu's row and the board never disagree. */
export function useMobileHome(): MobileHome {
  return useSyncExternalStore(subscribe, readMobileHome, () => "console" as MobileHome);
}
