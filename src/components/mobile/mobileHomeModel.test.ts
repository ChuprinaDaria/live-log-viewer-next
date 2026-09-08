import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  MOBILE_CONSOLE_PROJECT_KEY,
  MOBILE_HOME_KEY,
  readMobileConsoleProject,
  readMobileHome,
  writeMobileConsoleProject,
  writeMobileHome,
} from "./mobileHomeModel";

/*
 * The phone's two homes and the project the console stands on.
 *
 * The mode is durable (localStorage): the operator chose which surface the
 * «Сесії» tab is, and a reload is not a change of mind. The project is not —
 * it lives in sessionStorage so a tab switch comes back where it was, and
 * tomorrow's first look starts at the tree rather than inside whatever was
 * open last week.
 */

/** localStorage, near enough — plus a variant whose every access throws, which
    is what a browser in private mode actually does. */
function storage(initial: Record<string, string> = {}): Storage {
  const data: Record<string, string> = { ...initial };
  return {
    get length() { return Object.keys(data).length; },
    clear() { for (const key of Object.keys(data)) delete data[key]; },
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
    key: (index: number) => Object.keys(data)[index] ?? null,
  } as Storage;
}

function throwingStorage(): Storage {
  const boom = () => { throw new Error("private mode"); };
  return { get length(): number { return boom(); }, clear: boom, getItem: boom, setItem: boom, removeItem: boom, key: boom } as unknown as Storage;
}

const globals = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage; window?: unknown };
const realLocal = globals.localStorage;
const realSession = globals.sessionStorage;
const realWindow = globals.window;

beforeEach(() => {
  globals.localStorage = storage();
  globals.sessionStorage = storage();
  /* writeMobileHome tells the other readers on the page; without a window it
     must still write the value rather than throw. */
  globals.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
});

afterEach(() => {
  globals.localStorage = realLocal;
  globals.sessionStorage = realSession;
  globals.window = realWindow;
});

describe("the phone's home mode", () => {
  test("defaults to the console — the phone starts where the desktop does", () => {
    expect(readMobileHome()).toBe("console");
  });

  test("what was written is what comes back, and only «board» leaves the console", () => {
    writeMobileHome("board");
    expect(globals.localStorage!.getItem(MOBILE_HOME_KEY)).toBe("board");
    expect(readMobileHome()).toBe("board");
    writeMobileHome("console");
    expect(readMobileHome()).toBe("console");
  });

  test("a stored value nobody wrote reads as the console, not as a crash", () => {
    globals.localStorage!.setItem(MOBILE_HOME_KEY, "hq");
    expect(readMobileHome()).toBe("console");
  });

  test("private mode: reading answers the default and writing is silent", () => {
    globals.localStorage = throwingStorage();
    expect(readMobileHome()).toBe("console");
    expect(() => writeMobileHome("board")).not.toThrow();
  });
});

describe("the console's project across a tab switch", () => {
  test("nothing chosen yet is null, not an empty id", () => {
    expect(readMobileConsoleProject()).toBeNull();
  });

  test("the chosen project survives in sessionStorage and can be cleared", () => {
    writeMobileConsoleProject("bot");
    expect(globals.sessionStorage!.getItem(MOBILE_CONSOLE_PROJECT_KEY)).toBe("bot");
    expect(readMobileConsoleProject()).toBe("bot");
    writeMobileConsoleProject(null);
    expect(globals.sessionStorage!.getItem(MOBILE_CONSOLE_PROJECT_KEY)).toBeNull();
    expect(readMobileConsoleProject()).toBeNull();
  });

  test("private mode: the console still opens, it just forgets", () => {
    globals.sessionStorage = throwingStorage();
    expect(() => writeMobileConsoleProject("bot")).not.toThrow();
    expect(readMobileConsoleProject()).toBeNull();
  });
});
