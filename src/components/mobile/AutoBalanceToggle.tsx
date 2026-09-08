"use client";

import { useCallback, useEffect, useState } from "react";

import { useLocale } from "@/lib/i18n";

/*
 * The switch that lets an engine leave an exhausted account on its own.
 *
 * It exists because the machinery behind it does, and had no way to be turned
 * on: the policy endpoint had no caller anywhere in the UI, so a feature that
 * moves live sessions between accounts was reachable only by editing the
 * registry by hand.
 *
 * Off by default, and it says what it does rather than what it is called.
 * «Automatic switching» is a setting name; «leave an account that hit its
 * wall» is the thing that will happen to a conversation someone is watching.
 */

interface EnginePolicy {
  enabled: boolean;
  revision: number;
  /** disabled | idle | waiting-fresh | cooldown | draining */
  state: string;
  thresholdPercent: number;
}

type Engine = "claude" | "codex";

export function AutoBalanceToggle({ engine }: { engine: Engine }) {
  const { t } = useLocale();
  const [policy, setPolicy] = useState<EnginePolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/accounts", { cache: "no-store", ...(signal ? { signal } : {}) });
      const body = await response.json() as Record<string, { autoBalance?: EnginePolicy }>;
      const found = body[engine]?.autoBalance;
      if (found) setPolicy(found);
    } catch {
      /* A settings row that cannot read its own state simply does not render;
         an error banner here would be louder than the setting is important. */
    }
  }, [engine]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const toggle = async () => {
    if (!policy || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/accounts/${engine}/policy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        /* The revision is a fence: if the controller changed the policy while
           this screen was open, the write is refused rather than silently
           overwriting a decision made elsewhere. */
        body: JSON.stringify({ automaticSwitching: !policy.enabled, expectedRevision: policy.revision }),
      });
      const body = await response.json() as EnginePolicy & { error?: string };
      if (!response.ok) { setFailure(body.error ?? `HTTP ${response.status}`); await load(); }
      else setPolicy({ ...policy, ...body });
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!policy) return null;

  return (
    <div className="flex flex-col gap-1 px-4 py-2" data-auto-balance={engine}>
      <div className="flex min-h-11 items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-primary">{t("autoBalance.title", { engine })}</span>
          <span className="block text-caption text-muted">
            {t("autoBalance.explain", { percent: policy.thresholdPercent })}
          </span>
        </span>
        <button type="button" role="switch" aria-checked={policy.enabled} disabled={busy}
          onClick={() => void toggle()}
          className={`h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${policy.enabled ? "bg-accent" : "bg-strong"}`}>
          <span className={`block h-6 w-6 rounded-full bg-card transition-transform ${policy.enabled ? "translate-x-[22px]" : "translate-x-[2px]"}`} />
        </button>
      </div>
      {failure ? <p role="status" className="text-caption text-danger">{failure}</p> : null}
    </div>
  );
}
