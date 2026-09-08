import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";

import { fleetctl, fleetctlInstalled } from "@/lib/fleetctl/client";

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
