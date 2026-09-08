import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * The operator's console (`~/work/fleetctl`) as the Viewer calls it.
 *
 * The console is the configuration layer's ONE writer: roles, firms, projects,
 * grants. Its CLI and its MCP server are two wrappers over a single registry,
 * so a change made here is the same change an agent makes in a terminal, with
 * the same validation, the same atomic write, the same audit line and the same
 * daily backup. The Viewer therefore never writes those files itself — it
 * shells out to the console, and reads back what the console says.
 *
 * Every call names an actor, so the audit log records that the change came
 * from the dashboard rather than from a person at a keyboard.
 */

export const FLEETCTL_DIR = process.env.FLEETCTL_DIR?.trim() || path.join(os.homedir(), "work", "fleetctl");
const FLEETCTL_BIN = path.join(FLEETCTL_DIR, "fleetctl");
export const FLEETCTL_ACTOR = "fleet-dashboard";

/** Long enough for a console call that rewrites a store and its backup; short
    enough that a hung console cannot hold a request open. */
const TIMEOUT_MS = 20_000;

export class FleetctlError extends Error {
  readonly code: "MISSING" | "FAILED" | "UNREADABLE";
  constructor(code: "MISSING" | "FAILED" | "UNREADABLE", message: string) {
    super(message);
    this.name = "FleetctlError";
    this.code = code;
  }
}

export function fleetctlInstalled(): boolean {
  try {
    return fs.statSync(FLEETCTL_BIN).isFile();
  } catch {
    return false;
  }
}

/** CLI flags from a parameter map. `undefined` omits a flag; a list becomes
    the comma form the console documents; `stdinParam` sends one value over
    stdin instead, which is how a 12 000-character prompt travels. */
function flagsFor(params: Record<string, string | number | boolean | readonly string[] | undefined>): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const flag = `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
    if (value === true) { args.push(flag); continue; }
    if (value === false) continue;
    args.push(`${flag}=${Array.isArray(value) ? value.join(",") : String(value)}`);
  }
  return args;
}

export interface FleetctlCall {
  fn: string;
  params?: Record<string, string | number | boolean | readonly string[] | undefined>;
  /** Name of the parameter whose value is piped over stdin. */
  stdinParam?: string;
  stdinValue?: string;
  /* Parameters that must not become argv. A flag is visible in `ps` to
     everyone on the machine, so an MCP server's `env` and `headers` — its
     tokens — travel as a JSON object on stdin instead, which the console
     merges over the flags. Values sent this way are also absent from the
     console's audit line, which records key names only. */
  stdinJson?: Record<string, unknown>;
}

export async function fleetctl<T>(call: FleetctlCall): Promise<T> {
  if (!fleetctlInstalled()) throw new FleetctlError("MISSING", "fleetctl is not installed on this machine");
  const args = [call.fn, ...flagsFor(call.params ?? {}), "--json", `--actor=${FLEETCTL_ACTOR}`];
  /* One stdin, so one channel: the console refuses both flags together and
     there is no sane merge of a raw string with a JSON object. */
  if (call.stdinParam && call.stdinJson) {
    throw new FleetctlError("FAILED", "a call cannot use both stdin channels at once");
  }
  if (call.stdinParam) args.push(`--stdin=${call.stdinParam}`);
  else if (call.stdinJson) args.push("--stdin-json");
  return new Promise<T>((resolve, reject) => {
    const child = execFile(
      FLEETCTL_BIN,
      args,
      { cwd: FLEETCTL_DIR, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          /* The console's own last line is the useful half of a failure — a
             rejected model, an unknown role, a firm that still has children.
             It is operator-facing text about the operator's own config, so it
             travels as the error rather than being flattened to "failed". */
          const said = (stderr || stdout || error.message).trim().split("\n").filter(Boolean).pop() ?? "fleetctl failed";
          reject(new FleetctlError("FAILED", said.slice(0, 400)));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as T);
        } catch {
          reject(new FleetctlError("UNREADABLE", "fleetctl answered something that is not JSON"));
        }
      },
    );
    /* A console that refuses a flag exits before it reads, and the write then
       fails with EPIPE. An unhandled `error` on a stream is a PROCESS event —
       it would take the Viewer down over one bad call (AGENTS.md). The child's
       exit is already the answer, so the write failure is absorbed here and
       the execFile callback above does the rejecting. */
    child.stdin?.on("error", () => {});
    if (call.stdinParam) {
      child.stdin?.end(call.stdinValue ?? "");
    } else if (call.stdinJson) {
      child.stdin?.end(JSON.stringify(call.stdinJson));
    } else {
      child.stdin?.end();
    }
  });
}

/** HTTP status for a console failure: a missing console is this machine's
    configuration, a rejected call is the caller's. */
export function fleetctlStatus(error: unknown): number {
  if (error instanceof FleetctlError) return error.code === "MISSING" ? 501 : error.code === "UNREADABLE" ? 502 : 400;
  return 500;
}

export function fleetctlMessage(error: unknown): string {
  return error instanceof FleetctlError ? error.message : error instanceof Error ? error.message : String(error);
}
