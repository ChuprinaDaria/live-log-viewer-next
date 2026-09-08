import crypto from "node:crypto";
import path from "node:path";

import { activeClaudeAccountId, listClaudeAccounts, type ClaudeAccount } from "@/lib/accounts/claude";
import { realClaudeLoginPorts } from "@/lib/accounts/claudeLogin";
import { withAccountMutationLockAsync } from "@/lib/accounts/accountMutation";
import { chooseAutoBalance } from "./quotaPolicy";
import type { MigrationEvidence } from "./contracts";
import { activeCodexAccountId, listCodexAccounts, type CodexAccount } from "@/lib/accounts/codex";
import { managedCodexRuntime, type CodexQuotaProbe } from "@/lib/accounts/codexRuntime";
import type { AppServerResetCredits } from "@/lib/accounts/codexAppServer";
import { agentRegistry, type AgentRegistry } from "@/lib/agent/registry";
import { logQuotaEvent } from "@/lib/events";
import { fetchClaudeLimits, readCodexLimits } from "@/lib/limits";

import type { DurableQuotaObservation, MigrationEngine } from "./contracts";
import type { QuotaObservation, QuotaResetCredits } from "./quotaPolicy";

export interface QuotaProbePort {
  list(engine: MigrationEngine): Array<ClaudeAccount | CodexAccount>;
  active(engine: MigrationEngine): string;
  probe(engine: MigrationEngine, account: ClaudeAccount | CodexAccount, now: number): Promise<QuotaObservation>;
}

/** The durable projection of a reset-credit summary (issue #1373): the count
    and the soonest expiry among the available credits. Opaque credit ids stop
    here. */
export function quotaResetCreditsFrom(summary: AppServerResetCredits | null): QuotaResetCredits | null {
  if (!summary) return null;
  const expiries = (summary.credits ?? [])
    .filter((credit) => credit.status === "available" && credit.expiresAt !== null)
    .map((credit) => credit.expiresAt as number);
  return { availableCount: summary.availableCount, expiresAt: expiries.length ? Math.min(...expiries) : null };
}

/** One Codex app-server probe reconciled into the observation the registry
    keeps. Shared by the periodic controller tick, the operator's per-account
    re-read (#1418) and the post-redemption re-read (#1373), so every path
    records a reading of the same shape and provenance. */
export async function codexObservationFromProbe(account: CodexAccount, probe: CodexQuotaProbe, now: number): Promise<QuotaObservation> {
  const limits = await readCodexLimits({
    account,
    liveReader: async () => probe.rateLimits,
    now: () => now,
  });
  return {
    engine: "codex",
    accountId: account.id,
    authenticated: probe.authenticated,
    authCheckedAt: now,
    limits: limits.data,
    provenance: {
      source: limits.source,
      reason: probe.authenticated ? limits.reason : "unsupported-account-type",
      staleSince: null,
    },
    observedAt: now,
    envelope: probe.envelope,
    resetCredits: quotaResetCreditsFrom(probe.resetCredits),
  };
}

/** The registry's record of one observation. */
export function durableQuotaObservation(observation: QuotaObservation, bootId: string): DurableQuotaObservation {
  return {
    engine: observation.engine,
    accountId: observation.accountId,
    authenticated: observation.authenticated,
    authCheckedAt: new Date(observation.authCheckedAt ?? observation.observedAt).toISOString(),
    limits: observation.limits,
    provenance: observation.provenance,
    observedAt: new Date(observation.observedAt).toISOString(),
    bootId,
    resetCredits: observation.resetCredits ?? null,
  };
}

const productionProbe: QuotaProbePort = {
  list: (engine) => engine === "claude" ? listClaudeAccounts() : listCodexAccounts(),
  active: (engine) => engine === "claude" ? activeClaudeAccountId() : activeCodexAccountId(),
  async probe(engine, account, now) {
    if (engine === "claude") {
      const candidate = account as ClaudeAccount;
      const auth = await realClaudeLoginPorts.status(candidate.home).catch(() => ({ loggedIn: false, indeterminate: true }));
      /* An indeterminate status read observed nothing about the account —
         throwing routes it to the carry-forward path instead of recording a
         sign-out that never happened. */
      if (auth.indeterminate) throw new Error("quota-auth-indeterminate");
      const limits = auth.loggedIn
        ? await fetchClaudeLimits(path.join(candidate.home, ".credentials.json"))
        : { data: null, source: "unavailable" as const, reason: "live authentication check failed" };
      return {
        engine,
        accountId: candidate.id,
        authenticated: auth.loggedIn,
        authCheckedAt: now,
        limits: limits.data,
        provenance: { source: limits.source, reason: limits.reason, staleSince: null },
        observedAt: now,
      };
    }
    const candidate = account as CodexAccount;
    try {
      const probe = await managedCodexRuntime().probeQuota(candidate);
      return await codexObservationFromProbe(candidate, probe, now);
    } catch (error) {
      // The reader owns redacted server-local detail and returns a closed code
      // suitable for the durable quota registry.
      const limits = await readCodexLimits({ account: candidate, liveReader: async () => Promise.reject(error) });
      /* An empty transcript fallback after a failed live probe observed
         nothing — rethrow so the controller keeps the last known reading. */
      if (!limits.data) throw error;
      return {
        engine,
        accountId: candidate.id,
        authenticated: false,
        authCheckedAt: now,
        limits: limits.data,
        provenance: { source: limits.source, reason: limits.reason, staleSince: null },
        observedAt: now,
        envelope: null,
      };
    }
  },
};

/** The live provider probe, exported so an operator-triggered re-read
    (issue #1418) goes through exactly the reader the controller uses. */
export const liveQuotaProbe: QuotaProbePort = productionProbe;

/* One hung provider (e.g. a wedged Codex app-server) must not delay or blank
   the other accounts' readings: every account is probed concurrently and a
   probe that outlives this deadline is treated as failed for this tick. */
export const PROBE_TIMEOUT_MS = 15_000;

export function probeTimeout(timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("quota-probe-timeout")), timeoutMs);
    timer.unref?.();
  });
}

/** How the controller asks for a switch. A port, not a direct call, for the
    same reason the probe is one: the decision and the act are separable, and
    a test may watch the act without an account tree behind it. */
export type MigrationRequestPort = (
  engine: MigrationEngine,
  targetId: string,
  evidence: MigrationEvidence,
  routeRevision: number,
  registry: AgentRegistry,
) => Promise<void>;

const productionMigrationRequest: MigrationRequestPort = async (engine, targetId, evidence, routeRevision, registry) => {
  /* Imported here rather than at module scope: the coordinator pulls in the
     migration machinery, and this module is loaded by the tick loop. */
  const { createMigrationIntent } = await import("./coordinator");
  await createMigrationIntent(engine, targetId, "auto", crypto.randomUUID(), routeRevision, "active", registry, evidence);
};

export class QuotaController {
  constructor(
    private readonly registry: AgentRegistry = agentRegistry(),
    private readonly probe: QuotaProbePort = productionProbe,
    private readonly bootId: string = crypto.randomUUID(),
    private readonly now: () => number = () => Date.now(),
    private readonly probeTimeoutMs: number = PROBE_TIMEOUT_MS,
    private readonly requestMigration: MigrationRequestPort = productionMigrationRequest,
  ) {}

  /* A failed probe must not erase the last successful reading — the panel
     always shows the most recent known limits plus when they were observed.
     The carried observation keeps the previous limits and timestamps and is
     marked as cache provenance, which keeps it ineligible for auto-balance
     decisions (those require a fresh live observation). */
  private carryForward(engine: MigrationEngine, accountId: string, reason: string, now: number): QuotaObservation {
    const previous = this.registry.readOnlySnapshot().quotaObservations[engine][accountId];
    if (previous?.limits) {
      return {
        engine,
        accountId,
        authenticated: previous.authenticated,
        authCheckedAt: Date.parse(previous.authCheckedAt) || now,
        limits: previous.limits,
        provenance: {
          source: "cache",
          reason,
          staleSince: previous.provenance.staleSince ?? previous.observedAt,
        },
        observedAt: Date.parse(previous.observedAt) || now,
        envelope: null,
        resetCredits: previous.resetCredits ?? null,
      };
    }
    return {
      engine,
      accountId,
      authenticated: false,
      authCheckedAt: now,
      limits: null,
      provenance: { source: "unavailable", reason, staleSince: null },
      observedAt: now,
      envelope: null,
    };
  }

  async tick(engine: MigrationEngine): Promise<void> {
    await withAccountMutationLockAsync(async () => this.tickLocked(engine));
  }

  private async tickLocked(engine: MigrationEngine): Promise<void> {
    const now = this.now();
    const accounts = this.probe.list(engine);
    const observations = await Promise.all(accounts.map(async (account) => {
      try {
        const observation = await Promise.race([this.probe.probe(engine, account, now), probeTimeout(this.probeTimeoutMs)]);
        /* An authenticated account whose limits fetch came back empty-handed
           (rate-limited, provider hiccup) keeps its last known numbers. A live
           `authenticated: false` answer is a real state change — sign-out must
           surface, so it records as returned. */
        if (observation.authenticated && !observation.limits) {
          return this.carryForward(engine, account.id, observation.provenance.reason ?? "quota-probe-empty", now);
        }
        return observation;
      } catch (error) {
        const reason = error instanceof Error && error.message === "quota-probe-timeout" ? "quota-probe-timeout" : "quota-probe-failed";
        return this.carryForward(engine, account.id, reason, now);
      }
    }));
    observations.forEach((observation, index) => {
      const account = accounts[index]!;
      logQuotaEvent({
        engine,
        accountId: observation.accountId,
        accountKind: account.kind,
        envelope: observation.envelope ?? null,
        probePhase: "account-rate-limits",
        provenance: observation.provenance.source,
        reasonCode: observation.provenance.reason,
      });
    });
    const recorded: DurableQuotaObservation[] = observations.map((observation) => durableQuotaObservation({ ...observation, engine }, this.bootId));

    /* The auto-balance decision, and the sustain window that gates it.
     *
     * This is the joint that was missing: the policy, the chooser and the
     * intent all existed, and the controller passed `signature: null` — which
     * makes `recordQuotaEvaluation` clear the sustain window on every tick, so
     * it could never close and nothing ever switched. Auto-balance was written
     * and disconnected.
     *
     * The signature names the decision, not the moment: the same «leave A for
     * B» on two consecutive ticks, a minute apart, is what counts as sustained.
     * A different decision, or none, resets the window — which is the point.
     * A single dip below the threshold is noise; a minute of it is a wall.
     *
     * `chooseAutoBalance` refuses on its own when the policy is off, during
     * cooldown, or on anything but a fresh live reading, so nothing here has
     * to re-decide what is safe. */
    const snapshot = this.registry.readOnlySnapshot();
    const activeId = snapshot.engineRouting[engine]?.activeAccountId ?? null;
    const policy = snapshot.autoBalance[engine];
    const decision = activeId ? chooseAutoBalance(engine, activeId, observations, policy, now) : null;

    const outcome = this.registry.recordQuotaEvaluation({
      engine,
      observations: recorded,
      signature: decision ? `${activeId}->${decision.targetId}` : null,
      evidence: decision?.evidence ?? null,
      bootId: this.bootId,
      now: new Date(now).toISOString(),
      minimumGapMs: 60_000,
    });

    if (!decision || !outcome.sustained) return;

    /* The window closed on the same decision twice: switch. Failure here is
       logged and swallowed — a quota tick that throws stops every later tick,
       and an account that did not migrate is a smaller problem than limits
       that stop being read at all. */
    try {
      await this.requestMigration(engine, decision.targetId, decision.evidence, outcome.routeRevision, this.registry);
      logQuotaEvent({
        engine, accountId: decision.targetId, accountKind: "managed",
        envelope: null, probePhase: "account-rate-limits",
        provenance: "live", reasonCode: `auto-balance-switched:${activeId}->${decision.targetId}`,
      });
    } catch (error) {
      logQuotaEvent({
        engine, accountId: decision.targetId, accountKind: "managed",
        envelope: null, probePhase: "account-rate-limits",
        provenance: "live",
        reasonCode: `auto-balance-failed:${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}
