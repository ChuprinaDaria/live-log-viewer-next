"use client";

import { useState } from "react";

import { ChevronDown, Loader2 } from "@/components/icons";
import { useLocale, type TFunction } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import {
  groupByProvider,
  lastCheckedAt,
  secretTitle,
  summarize,
  useSecretsInventory,
  type AccountView,
  type CliView,
  type SecretGroup,
  type SecretState,
  type SecretView,
  type SecretsFilter,
} from "./secretsModel";

/*
 * «Секрети» (TZ-UI.md): every API key, account and CLI login the operator
 * holds, and — the question the page exists to answer — which of them are dead
 * and what each one is even for.
 *
 * The page shows a key's NAME, its PURPOSE and its STATE. It never shows a
 * value and offers no affordance that could reveal one: the server sends no
 * value at all, the rows are not interactive, and the mask is printed only
 * when the inventory records a mask rather than a sentence.
 *
 * Nothing is invented. No purpose, no purpose line. No plan, no plan line. No
 * mask, no mask. A CLI with no login says it is not signed in, which is a fact
 * the inventory recorded rather than a placeholder for a missing one.
 *
 * State is a WORD, on the right of the row: живий / мертвий / не перевірено.
 * Not a dot, not a badge, not an icon — three states told apart by three words
 * need no legend and survive without colour, and 82 pills is the clutter this
 * page was asked to avoid. Dead alone also carries weight, so it reads in
 * peripheral vision.
 */

const STATE_TONE: Record<SecretState, string> = {
  alive: "text-success",
  dead: "font-semibold text-danger",
  unchecked: "text-muted",
};

function stateLabel(t: TFunction, state: SecretState): string {
  return t(state === "alive" ? "secrets.stateAlive" : state === "dead" ? "secrets.stateDead" : "secrets.stateUnchecked");
}

export function MobileSecretsScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const { inventory, error, loading } = useSecretsInventory(true);
  const [filter, setFilter] = useState<SecretsFilter>("all");
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  const secrets = inventory?.secrets ?? [];
  const totals = summarize(secrets);
  const groups = groupByProvider(secrets, filter);
  const checkedAt = lastCheckedAt(secrets);

  const toggle = (provider: string) => setOpened((was) => {
    const next = new Set(was);
    if (next.has(provider)) next.delete(provider);
    else next.add(provider);
    return next;
  });

  return (
    <MobileShell screen="secrets" title={<MobileBarTitle>{t("mobile2.tabs.secrets")}</MobileBarTitle>} host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-secrets>
        {error ? (
          <Degraded
            title={t(error === "INVENTORY_MISSING" ? "secrets.emptyMissing" : "secrets.emptyUnreadable")}
            hint={t(error === "INVENTORY_MISSING" ? "secrets.emptyMissingHint" : "secrets.emptyUnreadableHint")}
            code={error}
          />
        ) : inventory === null ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-body text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("common.loading")}
          </div>
        ) : (
          <>
            {totals.total ? (
              <div className="px-1" data-mobile2-secrets-header>
                <p className="text-body font-semibold tabular-nums text-primary">{t("secrets.aliveOf", { alive: totals.alive, total: totals.total })}</p>
                <p className="mt-0.5 text-caption tabular-nums text-secondary">
                  {t("secrets.dead", { count: totals.dead })} · {t("secrets.unchecked", { count: totals.unchecked })}
                </p>
                {checkedAt ? (
                  <p className="mt-1 flex items-center gap-1.5 text-caption text-muted">
                    {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                    {t("secrets.checkedAt", { at: checkedAt })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {totals.total ? (
              <>
                <h2 className="px-1 pb-1.5 pt-3 text-label font-semibold text-muted">{t("secrets.sectionKeys")}</h2>
                <Filter value={filter} totals={totals} onChange={setFilter} />
              </>
            ) : null}

            {totals.total === 0 ? (
              <p className="px-1 py-6 text-center text-body text-secondary" data-mobile2-secrets-empty="none">{t("secrets.emptyNone")}</p>
            ) : groups.length === 0 ? (
              <p className="px-1 py-6 text-center text-body text-secondary" data-mobile2-secrets-empty={filter}>
                {t(filter === "dead" ? "secrets.emptyDeadNone" : "secrets.emptyUncheckedNone")}
              </p>
            ) : (
              <div className="mt-2 flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card">
                {groups.map((group) => (
                  <Group
                    key={group.provider}
                    group={group}
                    /* A filter exists to show rows, so it opens what it kept:
                       tapping six more times to see the six dead keys would be
                       the filter failing at its one job. */
                    open={filter !== "all" || opened.has(group.provider)}
                    showDead={filter === "all"}
                    onToggle={filter === "all" ? () => toggle(group.provider) : null}
                  />
                ))}
              </div>
            )}

            <Accounts accounts={inventory.accounts} />
            <Clis clis={inventory.clis} />
          </>
        )}
      </div>
    </MobileShell>
  );
}

function Degraded({ title, hint, code }: { title: string; hint: string; code: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center" data-mobile2-secrets-error={code}>
      <p className="max-w-[280px] text-body text-secondary">{title}</p>
      <p className="max-w-[280px] text-caption leading-snug text-muted">{hint}</p>
    </div>
  );
}

/** Three states, three cells, one row, pinned while the list scrolls. It is
    the only control on the page besides the group headers, and it replaces
    search, sorting and a state marker on every row. */
function Filter({ value, totals, onChange }: { value: SecretsFilter; totals: ReturnType<typeof summarize>; onChange: (next: SecretsFilter) => void }) {
  const { t } = useLocale();
  const cells: { key: SecretsFilter; label: string; count: number }[] = [
    { key: "all", label: t("secrets.filterAll"), count: totals.total },
    { key: "dead", label: t("secrets.filterDead"), count: totals.dead },
    { key: "unchecked", label: t("secrets.filterUnchecked"), count: totals.unchecked },
  ];
  return (
    <div
      role="group"
      aria-label={t("secrets.filterAria")}
      className="sticky top-0 z-10 flex gap-1 rounded-control border border-border bg-canvas p-1"
      data-mobile2-secrets-filter={value}
    >
      {cells.map((cell) => (
        <button
          key={cell.key}
          type="button"
          data-mobile2-secrets-filter-cell={cell.key}
          aria-pressed={value === cell.key}
          className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 text-body font-semibold ${
            value === cell.key ? "bg-sunken text-primary" : "text-muted"
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
          onClick={() => onChange(cell.key)}
        >
          <span className="truncate">{cell.label}</span>
          <span className="shrink-0 tabular-nums text-caption text-muted">{cell.count}</span>
        </button>
      ))}
    </div>
  );
}

function Group({ group, open, showDead, onToggle }: { group: SecretGroup; open: boolean; showDead: boolean; onToggle: (() => void) | null }) {
  const { t } = useLocale();
  const header = (
    <>
      {onToggle ? <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden /> : null}
      <span className="min-w-0 flex-1 truncate text-body font-semibold text-primary">{group.provider}</span>
      {showDead && group.dead ? <span className="shrink-0 tabular-nums text-caption font-semibold text-danger">{t("secrets.dead", { count: group.dead })}</span> : null}
      <span className="shrink-0 tabular-nums text-caption text-muted">{group.rows.length}</span>
    </>
  );
  return (
    <div data-mobile2-secrets-group={group.provider}>
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          aria-label={t("secrets.groupToggle", { provider: group.provider })}
          className="flex min-h-12 w-full items-center gap-2 px-3 text-left active:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={onToggle}
        >
          {header}
        </button>
      ) : (
        <div className="flex min-h-12 w-full items-center gap-2 px-3">{header}</div>
      )}
      {open ? (
        <ul className="flex flex-col divide-y divide-border border-t border-border bg-sunken">
          {group.rows.map((row) => <Row key={`${row.provider}/${row.name}`} row={row} />)}
        </ul>
      ) : null}
    </div>
  );
}

/* A row is text, never a target: nothing on this page can be tapped into
   revealing anything, and a stray tap on a list of secrets should do nothing
   at all. */
function Row({ row }: { row: SecretView }) {
  const { t } = useLocale();
  const meta = [
    row.label ? row.name : null,
    row.host,
    row.kind && row.kind !== "token" ? row.kind : null,
    row.masked,
    row.limit ? t("secrets.limit", { value: row.limit }) : null,
  ].filter(Boolean).join(" · ");
  return (
    <li className="flex min-h-14 flex-col justify-center px-3 py-2.5 pl-5" data-mobile2-secret={row.name} data-mobile2-secret-state={row.state}>
      <div className="flex items-start gap-2">
        <span className={`min-w-0 flex-1 truncate text-body text-primary ${row.label ? "" : "font-mono text-caption"}`}>{secretTitle(row)}</span>
        <span className={`shrink-0 text-caption ${STATE_TONE[row.state]}`}>{stateLabel(t, row.state)}</span>
      </div>
      {meta ? <p className="mt-0.5 truncate font-mono text-caption text-muted">{meta}</p> : null}
      {row.purpose ? <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-secondary">{row.purpose}</p> : null}
    </li>
  );
}

function Accounts({ accounts }: { accounts: readonly AccountView[] }) {
  const { t } = useLocale();
  if (!accounts.length) return null;
  return (
    <section data-mobile2-secrets-accounts>
      <h2 className="px-1 pb-1.5 pt-5 text-label font-semibold text-muted">{t("secrets.sectionAccounts")}</h2>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card">
        {accounts.map((account) => (
          <li key={`${account.service}/${account.host ?? ""}`} className="px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className="min-w-0 flex-1 truncate text-body font-semibold text-primary">{account.service}</span>
              {account.plan ? <span className="shrink-0 text-caption text-secondary">{account.plan}</span> : null}
            </div>
            {(account.host || account.login) ? (
              <p className="mt-0.5 truncate font-mono text-caption text-muted">{[account.host, account.login].filter(Boolean).join(" · ")}</p>
            ) : null}
            {account.usage ? <p className="mt-0.5 line-clamp-2 text-caption leading-snug text-secondary">{account.usage}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Clis({ clis }: { clis: readonly CliView[] }) {
  const { t } = useLocale();
  if (!clis.length) return null;
  return (
    <section className="pb-3" data-mobile2-secrets-clis>
      <h2 className="px-1 pb-1.5 pt-5 text-label font-semibold text-muted">{t("secrets.sectionClis")}</h2>
      <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card">
        {clis.map((cli) => (
          <li key={`${cli.name}/${cli.host ?? ""}`} className="flex min-h-11 flex-col justify-center px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-body text-primary">{cli.name}</span>
              <span className={`shrink-0 text-caption ${cli.loggedInAs ? "text-secondary" : "text-muted"}`}>
                {t(cli.loggedInAs ? "secrets.cliSignedIn" : "secrets.cliSignedOut")}
              </span>
            </div>
            {(cli.host || cli.loggedInAs) ? (
              <p className="mt-0.5 truncate font-mono text-caption text-muted">{[cli.host, cli.loggedInAs].filter(Boolean).join(" · ")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
