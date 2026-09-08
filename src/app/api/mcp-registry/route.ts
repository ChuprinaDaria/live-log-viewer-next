import { NextRequest, NextResponse } from "next/server";

import { fleetctl, fleetctlInstalled, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * MCP servers and skills as the operator's console holds them — NOT the
 * Viewer's own MCP server, which lives in `src/lib/mcp` and answers agents.
 * The two share a word and nothing else, hence the route name.
 *
 * The console reads the registry the agent CLIs actually load, reports whether
 * each server is reachable, and says who each one is granted to: a firm, a
 * project, an agent role, or the fleet's own seats. Granting is the same verb
 * for servers and skills, so one route covers both and the UI does not grow
 * two nearly-identical pages.
 *
 * Values never travel. The console masks `env` and `headers` down to their key
 * names before anything leaves it, so a server can be shown, probed and
 * granted without its token being readable here or on the wire.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const KINDS = ["mcp", "skills"] as const;
type Kind = (typeof KINDS)[number];

const isKind = (value: unknown): value is Kind =>
  typeof value === "string" && (KINDS as readonly string[]).includes(value);

/** firm:<id> | project:<id> | agent:<role> | fleet:hq | fleet:worker */
const TARGET = /^((firm|project|agent):[a-z0-9][a-z0-9_-]{0,63}|fleet:(hq|worker))$/;

const SERVER_NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
const SERVER_TYPES = ["stdio", "http", "sse"] as const;
type ServerType = (typeof SERVER_TYPES)[number];
/** A shell-safe environment name, and an HTTP field name (RFC 9110 token, the
    conservative half of it — what a header is actually called). */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[A-Za-z0-9-]+$/;
/** A token is short; 4 KiB is room for a certificate, not for a file. */
const MAX_VALUE_BYTES = 4 * 1024;
const MAX_ENTRIES = 32;
const MAX_ARGS = 64;

/** Servers the dashboard and the console are themselves reached through: the
    phone would be removing the hand that holds it. */
const FLEET_OWN = ["viewer", "fleetctl"];
/** The fleet's seats live in the run environment, not the org store, and the
    console's purge does not read them — so a removal would leave a grant
    pointing at a server that is gone. Refuse instead, and name the variable. */
const FLEET_ENV_VARS = ["LLV_MCP_GRANT", "LLV_HQ_MCP_GRANT"] as const;

/** A refusal the page can act on: the sentence for the operator, the field for
    the form. Both halves are free of anything the caller sent as a value. */
class BadInput extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown, code: string, what: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadInput(code, `${what} must be a string`);
  const trimmed = value.trim();
  if (Buffer.byteLength(trimmed, "utf8") > MAX_VALUE_BYTES) {
    throw new BadInput(code, `${what} is longer than ${MAX_VALUE_BYTES / 1024} KiB`);
  }
  return trimmed;
}

/** Whether this server may be taken out at all. Read at request time: the run
    environment is edited by hand and reloaded with the fleet, not with us. */
function inUse(name: string): string | null {
  if (FLEET_OWN.includes(name)) {
    return `«${name}» is one of the fleet's own servers — removing it from here would cut the dashboard off from the console`;
  }
  for (const variable of FLEET_ENV_VARS) {
    const granted = (process.env[variable] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    if (granted.includes(name)) {
      return `«${name}» is granted to the fleet through ${variable}; take it out of the run environment first`;
    }
  }
  return null;
}

/** env / headers: names checked against their own alphabet, values weighed but
    never read into a message — an error that quotes a token leaks it. */
function pairs(value: unknown, code: "env" | "headers", key: RegExp): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new BadInput(code, `${code} must be an object of name to value`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return undefined;
  if (entries.length > MAX_ENTRIES) throw new BadInput(code, `${code} takes at most ${MAX_ENTRIES} entries`);
  const out: Record<string, string> = {};
  for (const [name, item] of entries) {
    if (!key.test(name)) throw new BadInput(code, `${code}: «${name}» is not a valid name`);
    if (typeof item !== "string") throw new BadInput(code, `${code}: ${name} must be a string`);
    if (Buffer.byteLength(item, "utf8") > MAX_VALUE_BYTES) throw new BadInput(code, `${code}: ${name} is longer than ${MAX_VALUE_BYTES / 1024} KiB`);
    out[name] = item;
  }
  return out;
}

function argList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new BadInput("args", "args must be a list of strings");
  if (value.length > MAX_ARGS) throw new BadInput("args", `args takes at most ${MAX_ARGS} entries`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new BadInput("args", "args must be a list of strings");
    if (Buffer.byteLength(item, "utf8") > MAX_VALUE_BYTES) throw new BadInput("args", "an argument is longer than 4 KiB");
    if (item.length) out.push(item);
  }
  return out.length ? out : undefined;
}

interface ConsoleAdd {
  params: Record<string, string | boolean | undefined>;
  stdinJson?: Record<string, unknown>;
}

/** The console call an add body describes, or a refusal. Flags carry the
    shape; the stdin object carries what argv must never hold. */
function addCall(body: Record<string, unknown>): ConsoleAdd {
  const name = text(body.name, "name", "name");
  if (!SERVER_NAME.test(name)) {
    throw new BadInput("name", "name must start with a letter or digit and use only letters, digits, _ . -");
  }
  const kind = text(body.type, "type", "type") || "stdio";
  if (!(SERVER_TYPES as readonly string[]).includes(kind)) {
    throw new BadInput("type", `type must be one of ${SERVER_TYPES.join(", ")}`);
  }
  const type = kind as ServerType;
  const command = text(body.command, "command", "command");
  const cwd = text(body.cwd, "cwd", "cwd");
  const url = text(body.url, "url", "url");
  if (type === "stdio" && !command) throw new BadInput("command", "a stdio server needs a command");
  if (type !== "stdio") {
    if (!url) throw new BadInput("url", `a ${type} server needs a url`);
    if (!/^https?:\/\//i.test(url)) throw new BadInput("url", "url must be http:// or https://");
  }
  const env = type === "stdio" ? pairs(body.env, "env", ENV_KEY) : undefined;
  const headers = type === "stdio" ? undefined : pairs(body.headers, "headers", HEADER_NAME);
  const args = type === "stdio" ? argList(body.args) : undefined;

  /* Arguments join the secrets on stdin, not because they are secret but
     because the flag encoding joins a list with commas — an argument that
     contains one would arrive at the console as two. */
  const overStdin: Record<string, unknown> = {};
  if (args) overStdin.args = args;
  if (env) overStdin.env = env;
  if (headers) overStdin.headers = headers;

  return {
    params: {
      name,
      type,
      ...(type === "stdio" ? { command, ...(cwd ? { cwd } : {}) } : { url }),
      ...(body.replace === true ? { replace: true } : {}),
    },
    ...(Object.keys(overStdin).length ? { stdinJson: overStdin } : {}),
  };
}

function noConsole(): NextResponse {
  return NextResponse.json(
    { error: "the operator console is not installed on this machine" },
    { status: 501, headers },
  );
}

/**
 * GET /api/mcp-registry            servers and skills, with who holds each
 * GET /api/mcp-registry?probe=0    skip the reachability check
 *
 * Probing is on by default because «is it up» is the question this page is
 * opened to answer; it is cheap by design — a binary that exists, a socket
 * that opens — and sends no authorization anywhere.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!fleetctlInstalled()) return noConsole();
  const probe = request.nextUrl.searchParams.get("probe") !== "0";
  try {
    const [servers, skills] = await Promise.all([
      fleetctl<Record<string, unknown>>({ fn: "mcp_list", params: { probe } }),
      fleetctl<Record<string, unknown>>({ fn: "skills_list" }),
    ]);
    return NextResponse.json({ ...servers, ...skills }, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}

/** The list the page should now render, so a write and the view of it cannot
    disagree. The probe is skipped: nothing here changes whether a server is
    up, and adding one asks the console to answer, not to dial out.
 *
 * `done` is what already happened on disk. If the re-read fails after a write
 * went through, the write still went through — answering with a failure would
 * send the operator back to repeat an action that is already done, and the
 * second attempt would meet «уже є». So the answer says what happened and
 * hands back a null list, which the page reads as «ask again». */
async function refreshed(result: unknown, done: Record<string, unknown> = {}): Promise<NextResponse> {
  try {
    const [servers, skills] = await Promise.all([
      fleetctl<Record<string, unknown>>({ fn: "mcp_list", params: { probe: false } }),
      fleetctl<Record<string, unknown>>({ fn: "skills_list" }),
    ]);
    return NextResponse.json({ result, ...done, ...servers, ...skills }, { headers });
  } catch (error) {
    if (Object.keys(done).length === 0) throw error;
    return NextResponse.json({ result, ...done, servers: null, skills: null }, { headers });
  }
}

/**
 * POST /api/mcp-registry
 *
 *   { kind, item, target }                 grant it
 *   { kind, item, target, revoke: true }   take it back
 *   { action: "add", name, type, … }       write it into the registry
 *   { action: "remove", name }             take it out, grants and all
 *
 * `kind` is "mcp" or "skills"; `item` is a server name or a skill id. A skill
 * cannot be granted to `fleet:*` — those two targets are environment variables
 * the fleet server reads at startup and they carry MCP grants only. The console
 * enforces that; this route passes the refusal through rather than pre-judging
 * it, so there is one place that decides and not two.
 *
 * Adding is the one call on this page that carries values rather than names.
 * They go to the console over stdin (`stdinJson`), never as flags: a flag is
 * argv, and argv is readable by every process on the machine. They are not
 * echoed back either — the answer is the console's masked list, the same one
 * the page already reads.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rejection = rejectCrossOrigin(request);
  if (rejection) { rejection.headers.set("Cache-Control", "no-store"); return rejection; }
  if (!fleetctlInstalled()) return noConsole();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers });
  }

  if (body.action !== undefined) {
    try {
      if (body.action === "add") {
        const call = addCall(body);
        const result = await fleetctl({ fn: "mcp_add", ...call });
        return await refreshed(result, { added: true });
      }
      if (body.action === "remove") {
        const name = text(body.name, "name", "name");
        if (!SERVER_NAME.test(name)) throw new BadInput("name", "name is not an MCP server name");
        const held = inUse(name);
        if (held) throw new BadInput("mcp_in_use", held, 409);
        const result = await fleetctl({ fn: "mcp_remove", params: { name } });
        return await refreshed(result, { removed: true });
      }
      throw new BadInput("action", "action must be add or remove");
    } catch (error) {
      if (error instanceof BadInput) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
      }
      /* The console's own sentence — it is secret-free by design, and it is
         the half of a failure the operator can act on. */
      return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
    }
  }

  if (!isKind(body.kind)) {
    return NextResponse.json({ error: "kind must be mcp or skills" }, { status: 400, headers });
  }
  const item = typeof body.item === "string" ? body.item.trim() : "";
  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (!item) return NextResponse.json({ error: "item is required" }, { status: 400, headers });
  if (!TARGET.test(target)) {
    return NextResponse.json(
      { error: "target must be firm:<id>, project:<id>, agent:<role>, fleet:hq or fleet:worker" },
      { status: 400, headers },
    );
  }

  const verb = body.revoke === true
    ? (body.kind === "mcp" ? "mcp_revoke" : "skill_revoke")
    : (body.kind === "mcp" ? "mcp_grant" : "skill_grant");

  try {
    const result = await fleetctl({ fn: verb, params: { target, item } });
    return await refreshed(result);
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}
