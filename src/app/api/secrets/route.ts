import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextResponse, type NextRequest } from "next/server";

import { fleetctl, fleetctlInstalled, fleetctlMessage, fleetctlStatus } from "@/lib/fleetctl/client";
import { rejectCrossOrigin } from "@/lib/sameOrigin";

/*
 * The Secrets page's inventory (TZ-UI.md: the secrets page).
 *
 * The operator's console (`fleetctl`) is the source when it is installed: it
 * holds the same 82 credentials PLUS the annotations she makes — the firm and
 * project each key belongs to, and its short purpose — which the raw inventory
 * file does not carry. Without the console the file is read directly, so the
 * page still answers on a machine that has no console.
 *
 * The file is written by the operator's own inventory agent and re-read on
 * EVERY request — never cached into the build, never memoized — because the
 * agent rewrites it whenever it re-checks a key, and a page that answers
 * "which of my keys are dead" from a stale copy is worse than no page.
 *
 * Nothing here can carry a secret VALUE. Every record is projected field by
 * field into the shapes below, so a value the inventory might one day carry
 * would have to be added here deliberately to cross the boundary — it cannot
 * arrive by the file growing a field. The `masked` field is passed through
 * only when it actually looks like a mask; today it holds a human sentence,
 * which is read as the record's purpose instead.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = { "Cache-Control": "no-store" };

const INVENTORY = process.env.SECRETS_INVENTORY?.trim()
  || path.join(os.homedir(), "work", "cockpit", "secrets", "inventory.json");

/** Alive as the inventory records it: checked and up, checked and down, or
    never checked. Anything else the file might say is "unknown". */
export type SecretState = "alive" | "dead" | "unchecked";

export interface SecretView {
  name: string;
  /** The firm this key was bound to in the console, when it was. */
  firm?: string;
  /** The project inside that firm. */
  project?: string;
  /** The human name when the inventory carries one; absent otherwise. */
  label?: string;
  /** What this key is FOR, in the operator's own words. Absent when the
      inventory has neither `purpose_short` nor a prose `masked`. */
  purpose?: string;
  provider: string;
  kind?: string;
  host?: string;
  state: SecretState;
  /** Only when the inventory's `masked` is really a mask. */
  masked?: string;
  /** Quota or usage the checker recorded, as it wrote it. */
  limit?: string;
  checkedAt?: string;
  /** The file the value sits in, and the environment variable it answers to.
      Both come out of `ref`, which is an ADDRESS — the store holds no value
      and neither does this. */
  file?: string;
  envName?: string;
  /** Who this key was shared with, beyond the node that owns it:
      `global`, `firm:<id>`, `project:<id>`. */
  sharedWith?: string[];
  /** Who owns it, when the inventory says. */
  owner?: string;
}

export interface AccountView {
  service: string;
  login?: string;
  plan?: string;
  usage?: string;
  host?: string;
}

export interface CliView {
  name: string;
  /** Absent means the inventory recorded no login for this CLI. */
  loggedInAs?: string;
  host?: string;
}

export interface SecretsInventoryView {
  generatedAt: string | null;
  secrets: SecretView[];
  accounts: AccountView[];
  clis: CliView[];
}

const text = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Whether a `masked` field holds a MASK rather than a sentence.
 *
 * The inventory writes a human description there today and may write a real
 * mask later, and the page must not print one in the other's place: a
 * paragraph squeezed into the state cell is unreadable, and a mask rendered as
 * the purpose line says nothing about what the key is for. A mask is short and
 * unspaced; a sentence is neither.
 */
function looksLikeMask(value: string): boolean {
  return value.length <= 32 && !/\s/.test(value);
}

function secretView(value: unknown): SecretView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = text(record.name);
  if (!name) return null;
  const masked = text(record.masked);
  const mask = masked && looksLikeMask(masked) ? masked : undefined;
  const purpose = text(record.purpose_short) ?? (masked && !mask ? masked : undefined);
  const alive = record.alive;
  return {
    name,
    ...(text(record.label) ? { label: text(record.label)! } : {}),
    ...(purpose ? { purpose } : {}),
    provider: text(record.provider) ?? "—",
    ...(text(record.kind) ? { kind: text(record.kind)! } : {}),
    ...(text(record.host) ? { host: text(record.host)! } : {}),
    state: alive === true ? "alive" : alive === false ? "dead" : "unchecked",
    ...(mask ? { masked: mask } : {}),
    ...(text(record.limit) ? { limit: text(record.limit)! } : {}),
    ...(text(record.checked_at) ? { checkedAt: text(record.checked_at)! } : {}),
  };
}

function accountView(value: unknown): AccountView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const service = text(record.service);
  if (!service) return null;
  const plan = text(record.plan);
  return {
    service,
    ...(text(record.email_or_login) ? { login: text(record.email_or_login)! } : {}),
    /* The inventory writes "-" for a service with no plan; that is an absent
       field, not a value to print. */
    ...(plan && plan !== "-" ? { plan } : {}),
    ...(text(record.usage) ? { usage: text(record.usage)! } : {}),
    ...(text(record.host) ? { host: text(record.host)! } : {}),
  };
}

function cliView(value: unknown): CliView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = text(record.name);
  if (!name) return null;
  return {
    name,
    ...(text(record.logged_in_as) ? { loggedInAs: text(record.logged_in_as)! } : {}),
    ...(text(record.host) ? { host: text(record.host)! } : {}),
  };
}

function list<T>(value: unknown, project: (item: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.flatMap((item) => { const projected = project(item); return projected ? [projected] : []; }) : [];
}

/** The console's own record, mapped into the view the page already reads.
    `state` is its word for liveness; nothing here can carry a value, because
    the console does not return one and this projection names its fields. */
interface ConsoleSecret {
  id: string;
  label?: string;
  purpose_short?: string;
  kind?: string;
  provider?: string;
  owner?: string;
  state?: string;
  limit?: string | number | null;
  checked_at?: string;
  firm?: string | null;
  project?: string | null;
  /* Where the value physically lives, parsed by the console out of `ref`.
     This is the answer to «which machine is this key on», which the store
     always held and which never reached the screen. */
  host?: string | null;
  file?: string | null;
  env_name?: string | null;
  /* Nodes this key is shared with, beyond the one that owns it. */
  shared_with?: string[];
}

function fromConsole(record: ConsoleSecret): SecretView | null {
  if (!record.id) return null;
  return {
    name: record.id,
    ...(text(record.label) ? { label: text(record.label)! } : {}),
    ...(text(record.purpose_short) ? { purpose: text(record.purpose_short)! } : {}),
    provider: text(record.provider) ?? "—",
    ...(text(record.kind) ? { kind: text(record.kind)! } : {}),
    state: record.state === "alive" ? "alive" : record.state === "dead" ? "dead" : "unchecked",
    ...(text(record.limit) ? { limit: text(record.limit)! } : {}),
    ...(text(record.checked_at) ? { checkedAt: text(record.checked_at)! } : {}),
    ...(text(record.firm) ? { firm: text(record.firm)! } : {}),
    ...(text(record.project) ? { project: text(record.project)! } : {}),
    ...(text(record.host) ? { host: text(record.host)! } : {}),
    ...(text(record.file) ? { file: text(record.file)! } : {}),
    ...(text(record.env_name) ? { envName: text(record.env_name)! } : {}),
    ...(Array.isArray(record.shared_with) && record.shared_with.length
      ? { sharedWith: record.shared_with.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(text(record.owner) ? { owner: text(record.owner)! } : {}),
  };
}

export async function GET(): Promise<NextResponse<SecretsInventoryView | { error: string }>> {
  if (fleetctlInstalled()) {
    try {
      const answer = await fleetctl<{ secrets: ConsoleSecret[] }>({ fn: "secrets_list" });
      const secrets = (answer.secrets ?? []).flatMap((record) => {
        const view = fromConsole(record);
        return view ? [view] : [];
      });
      if (secrets.length) {
        /* Accounts and CLI logins are not the console's to hold; they stay in
           the inventory file the checker writes. */
        const file = readInventory();
        return NextResponse.json({
          generatedAt: file?.generatedAt ?? null,
          secrets,
          accounts: file?.accounts ?? [],
          clis: file?.clis ?? [],
        }, { headers });
      }
    } catch {
      /* Fall through to the file. */
    }
  }
  const file = readInventory();
  if (!file) {
    return NextResponse.json({ error: fs.existsSync(INVENTORY) ? "INVENTORY_UNPARSABLE" : "INVENTORY_MISSING" }, { status: fs.existsSync(INVENTORY) ? 500 : 404, headers });
  }
  return NextResponse.json(file, { headers });
}

/** The raw inventory file, or null when it is missing or unreadable. */
function readInventory(): SecretsInventoryView | null {
  let raw: string;
  try {
    raw = fs.readFileSync(INVENTORY, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  return {
    generatedAt: text(record.generated_at) ?? null,
    secrets: list(record.secrets, secretView),
    accounts: list(record.accounts, accountView),
    clis: list(record.clis, cliView),
  };
}

/**
 * POST /api/secrets — the page's three writes, all through the console.
 *
 *   { secret, share: "global" | "firm:<id>" | "project:<id>" }   share it
 *   { secret, unshare: "…" }                                      take it back
 *   { secret, label?, purpose?, owner?, firm?, project?, tags? }  annotate
 *   { action: "add", secret, value, provider, … }                 add one
 *
 * `add` is the ONE action that carries a value, and it carries it exactly as
 * far as the console's stdin: the console writes it into a private 0600 file
 * and puts only the ADDRESS of that file into the vault. It never becomes a
 * command-line flag, because argv is public to every process on the machine
 * (`ps`), it is never logged here, and it never comes back — the answer is
 * the inventory row, which has no value to return.
 *
 * For every OTHER action a value is still refused outright: quietly dropping
 * the field would leave the caller believing it was stored.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rejection = rejectCrossOrigin(request);
  if (rejection) { rejection.headers.set("Cache-Control", "no-store"); return rejection; }
  if (!fleetctlInstalled()) {
    return NextResponse.json(
      { error: "the operator console is not installed on this machine" },
      { status: 501, headers },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers });
  }

  const secret = typeof body.secret === "string" ? body.secret.trim() : "";
  if (!secret) return NextResponse.json({ error: "secret is required" }, { status: 400, headers });

  if (body.action === "add") return addSecret(secret, body);

  /* A value must never arrive here even by accident — refusing loudly is
     better than quietly dropping the field and leaving the caller to believe
     it was stored. */
  if ("value" in body || "token" in body || "password" in body) {
    return NextResponse.json(
      { error: "this route stores metadata, never a value; put the value in its own file and point `ref` at it" },
      { status: 400, headers },
    );
  }

  const SCOPE = /^(global|(firm|project):[a-z0-9][a-z0-9_-]{0,63})$/;
  const scope = (value: unknown): string | null =>
    typeof value === "string" && SCOPE.test(value.trim()) ? value.trim() : null;

  try {
    const share = scope(body.share);
    const unshare = scope(body.unshare);
    if (body.share !== undefined && !share) {
      return NextResponse.json({ error: "share must be global, firm:<id> or project:<id>" }, { status: 400, headers });
    }
    if (body.unshare !== undefined && !unshare) {
      return NextResponse.json({ error: "unshare must be global, firm:<id> or project:<id>" }, { status: 400, headers });
    }

    if (share) await fleetctl({ fn: "secret_share", params: { secret, target: share } });
    else if (unshare) await fleetctl({ fn: "secret_unshare", params: { secret, target: unshare } });
    else {
      const text2 = (value: unknown): string | undefined =>
        typeof value === "string" ? value : undefined;
      const params = {
        secret,
        label: text2(body.label),
        purpose_short: text2(body.purpose),
        owner: text2(body.owner),
        firm: text2(body.firm),
        project: text2(body.project),
        tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string").join(",") : undefined,
      };
      if (Object.entries(params).every(([key, value]) => key === "secret" || value === undefined)) {
        return NextResponse.json({ error: "nothing to change" }, { status: 400, headers });
      }
      await fleetctl({ fn: "secret_annotate", params });
    }

    /* Answer with the row as the console now holds it, so the page cannot
       disagree with the store about who a key is shared with. */
    const updated = await fleetctl<{ secrets: ConsoleSecret[] }>({
      fn: "secrets_list", params: { query: secret },
    });
    const row = (updated.secrets ?? []).find((record) => record.id === secret);
    return NextResponse.json({ secret: row ? fromConsole(row) : null }, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}

/** The record's id, and the name of the variable the value answers to. Both
    are checked here as well as in the console: the console is the authority,
    but a typo answering in Ukrainian from a subprocess is a worse answer than
    a 400 that names the field. */
const SECRET_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SECRET_ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** A value bigger than this is a file, not a key — a pasted PEM bundle or a
    mis-picked upload. The console would write it happily; the limit is here so
    that it is refused by size rather than stored by accident. */
const MAX_VALUE_BYTES = 8 * 1024;

const bad = (error: string): NextResponse =>
  NextResponse.json({ error }, { status: 400, headers });

/**
 * Add a secret: the metadata as flags, the value over stdin.
 *
 * Nothing in here logs the body, and nothing echoes the value back. The one
 * transformation applied to it is dropping a single trailing newline — the
 * shape a terminal pipe adds — because everything else the operator typed is
 * part of the key, and silently trimming spaces would corrupt a valid one.
 */
async function addSecret(secret: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (!SECRET_SLUG.test(secret)) return bad("secret must be a slug: [a-z0-9][a-z0-9_-] up to 64 characters");

  if (typeof body.value !== "string") return bad("value is required");
  const value = body.value.replace(/\r?\n$/, "");
  if (!value.trim()) return bad("value is empty");
  if (new TextEncoder().encode(value).length > MAX_VALUE_BYTES) {
    return bad(`value is longer than ${MAX_VALUE_BYTES} bytes — that is a file, not a key`);
  }

  const word = (input: unknown): string | undefined => {
    const trimmed = typeof input === "string" ? input.trim() : "";
    return trimmed ? trimmed : undefined;
  };
  const provider = word(body.provider);
  if (!provider) return bad("provider is required");
  const envName = word(body.envName);
  if (envName !== undefined && !SECRET_ENV_NAME.test(envName)) {
    return bad("envName must be an environment variable name: [A-Z_][A-Z0-9_]*");
  }
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;

  try {
    await fleetctl({
      fn: "secret_add",
      params: {
        secret,
        provider,
        label: word(body.label),
        /* camelCase, because the client turns it into the console's own
           `--env-name`; an underscore here would reach argparse as a flag it
           does not know. */
        envName,
        kind: word(body.kind),
        owner: word(body.owner),
        firm: word(body.firm),
        project: word(body.project),
        purposeShort: word(body.purpose),
        ...(tags?.length ? { tags } : {}),
        ...(body.replace === true ? { replace: true } : {}),
      },
      stdinParam: "value",
      stdinValue: value,
    });
    return NextResponse.json({ secret: await refreshed(secret) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: fleetctlMessage(error) }, { status: fleetctlStatus(error), headers });
  }
}

/** The row as the console now holds it, so the page cannot disagree with the
    store about a key it just changed. */
async function refreshed(secret: string): Promise<SecretView | null> {
  const updated = await fleetctl<{ secrets: ConsoleSecret[] }>({ fn: "secrets_list", params: { query: secret } });
  const row = (updated.secrets ?? []).find((record) => record.id === secret);
  return row ? fromConsole(row) : null;
}
