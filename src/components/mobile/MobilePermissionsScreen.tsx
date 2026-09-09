"use client";

import { useState } from "react";

import { X } from "@/components/icons";
import { useLocale } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import {
  BUCKETS,
  isMachine,
  isProtected,
  refusalNeeds,
  usePermissions,
  type Bucket,
  type PermissionsAnswer,
} from "./permsModel";

/*
 * What agents on this machine are allowed to run.
 *
 * The screen is deliberately plain, because the subject is not: these rules
 * are the only thing between an agent and the machine. Nothing here decides
 * what is dangerous — the console does, and when it refuses, its own sentence
 * is what the operator reads, with a single button that says the word the
 * refusal asked for. A page that pre-judged danger would be a second opinion
 * to keep in step, and the two would drift.
 *
 * A protected deny renders with no remove control at all: finding out that a
 * rule is load-bearing by tapping it and reading a refusal is worse than
 * seeing it cannot be tapped.
 */

const CARD = "flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card";
const TONE: Record<Bucket, string> = {
  allow: "text-success",
  deny: "text-danger",
  ask: "text-warning",
};

function RuleRow({
  rule,
  from,
  shadowed,
  locked,
  onRemove,
}: {
  rule: string;
  from?: string;
  shadowed?: boolean;
  locked?: boolean;
  onRemove?: () => void;
}) {
  const { t } = useLocale();
  return (
    <div data-perm-rule={rule} className="flex min-h-11 items-center gap-2 px-4 py-1.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`break-all font-mono text-label ${shadowed ? "text-muted line-through" : "text-primary"}`}>{rule}</span>
        {from ? <span className="break-words text-caption text-muted">{from}</span> : null}
        {shadowed ? <span className="break-words text-caption text-muted">{t("perms.shadowed")}</span> : null}
      </span>
      {locked ? (
        <span className="shrink-0 text-caption text-muted">{t("perms.protected")}</span>
      ) : onRemove ? (
        <button type="button" onClick={onRemove} aria-label={t("perms.remove", { rule })}
          className="grid h-11 w-11 shrink-0 place-items-center text-muted active:text-danger">
          <X className="h-[18px] w-[18px]" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function Bucketed({
  bucket,
  rules,
  permissions,
  onRemove,
}: {
  bucket: Bucket;
  rules: { rule: string; from?: string; shadowed?: boolean }[];
  permissions: PermissionsAnswer | null;
  onRemove?: (bucket: Bucket, rule: string) => void;
}) {
  const { t } = useLocale();
  if (rules.length === 0) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-1.5 px-1 text-label font-semibold">
        <span className={TONE[bucket]}>{t(`perms.bucket.${bucket}`)}</span>
        <span className="text-caption font-semibold tabular-nums text-muted">{rules.length}</span>
      </h2>
      <div className={CARD}>
        {rules.map((row) => (
          <RuleRow
            key={`${bucket}:${row.rule}`}
            rule={row.rule}
            from={row.from}
            shadowed={row.shadowed}
            locked={bucket === "deny" && isProtected(permissions, row.rule)}
            onRemove={onRemove && !(bucket === "deny" && isProtected(permissions, row.rule))
              ? () => onRemove(bucket, row.rule)
              : undefined}
          />
        ))}
      </div>
    </section>
  );
}

export function MobilePermissionsScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const perms = usePermissions("machine");
  const [draft, setDraft] = useState("");
  const [bucket, setBucket] = useState<Bucket>("ask");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const answer = perms.permissions;

  const add = async (confirm = false) => {
    const rule = draft.trim();
    if (!rule || busy) return;
    setBusy(true);
    const problem = await perms.write({ bucket, rule, ...(confirm ? { confirm: true } : {}) });
    setBusy(false);
    setRefusal(problem);
    if (!problem) setDraft("");
  };

  const remove = async (which: Bucket, rule: string, force = false) => {
    setBusy(true);
    const problem = await perms.write({ bucket: which, rule, remove: true, ...(force ? { force: true } : {}) });
    setBusy(false);
    setRefusal(problem);
  };

  const rows = (which: Bucket): { rule: string; from?: string; shadowed?: boolean }[] => {
    if (!answer) return [];
    if (isMachine(answer)) return answer[which].map((rule) => ({ rule }));
    const effective = answer.effective?.[which];
    if (effective) return effective.map((row) => ({ rule: row.rule, from: row.from, shadowed: row.shadowed_by_deny }));
    return (answer.own?.[which] ?? []).map((rule) => ({ rule }));
  };

  const needs = refusal ? refusalNeeds(refusal) : null;

  return (
    <MobileShell screen="permissions" title={<MobileBarTitle>{t("perms.title")}</MobileBarTitle>} host={host} renderSheet={renderSheet}>
      <div className="settings-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-permissions>
        {perms.error ? (
          <div role="status" className="flex flex-col gap-2 px-1 text-label text-danger">
            <p>{perms.error === "UNREACHABLE" ? t("list.failed") : perms.error}</p>
            <button type="button" onClick={() => void perms.refresh()} className="min-h-11 rounded-[12px] bg-card px-3">{t("list.retry")}</button>
          </div>
        ) : !answer ? (
          <p role="status" className="px-1 text-label text-muted">{t("common.loading")}</p>
        ) : (
          <>
            {answer && isMachine(answer) && answer.defaultMode ? (
              <p className="px-1 text-label text-muted">{t("perms.mode", { mode: answer.defaultMode })}</p>
            ) : null}

            {/* The refusal, verbatim, with the one button it asked for. */}
            {refusal ? (
              <div role="status" data-perm-refusal className="flex flex-col gap-2 rounded-surface border border-danger/40 bg-danger-soft px-3 py-2">
                <p className="text-label text-danger">{refusal}</p>
                {needs === "confirm" ? (
                  <button type="button" disabled={busy} onClick={() => void add(true)}
                    className="min-h-11 rounded-[12px] bg-danger px-3 text-label font-semibold text-white disabled:opacity-50">
                    {t("perms.confirmAnyway")}
                  </button>
                ) : null}
                <button type="button" onClick={() => setRefusal(null)} className="min-h-11 rounded-[12px] px-3 text-label text-secondary">
                  {t("common.cancel")}
                </button>
              </div>
            ) : null}

            <div className={`${CARD} p-3`}>
              <p className="pb-2 text-label font-semibold text-primary">{t("perms.addTitle")}</p>
              <div className="flex gap-1.5 pb-2" role="group" aria-label={t("perms.addBucket")}>
                {BUCKETS.map((which) => (
                  <button key={which} type="button" onClick={() => setBucket(which)}
                    aria-pressed={bucket === which}
                    className={`min-h-11 flex-1 rounded-[12px] px-2 text-label font-semibold ${bucket === which ? "bg-accent text-white" : "bg-quiet text-secondary"}`}>
                    {t(`perms.bucket.${which}`)}
                  </button>
                ))}
              </div>
              <input value={draft} onChange={(event) => setDraft(event.target.value)}
                placeholder="Bash(git status:*)" aria-label={t("perms.addTitle")}
                className="min-h-11 w-full rounded-[12px] border border-border bg-card px-3 font-mono text-label text-primary" />
              <button type="button" disabled={busy || !draft.trim()} onClick={() => void add(false)}
                className="mt-2 min-h-11 w-full rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50">
                {t("perms.add")}
              </button>
            </div>

            {BUCKETS.map((which) => (
              <Bucketed key={which} bucket={which} rules={rows(which)} permissions={answer}
                onRemove={(b, rule) => void remove(b, rule)} />
            ))}
          </>
        )}
      </div>
    </MobileShell>
  );
}
