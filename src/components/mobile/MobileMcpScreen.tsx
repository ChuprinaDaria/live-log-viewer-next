"use client";

import { useState } from "react";

import { ChevronRight } from "@/components/icons";
import { useLocale } from "@/lib/i18n";

import { MobileMcpAddSheet } from "./MobileMcpAddSheet";
import { showReceipt } from "./MobileReceipt";
import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { serverLine, useMcpRegistry, type McpRemoveOutcome, type McpServerRow, type SkillRow } from "./mcpModel";

/*
 * MCP servers and skills, and who they are granted to (TZ-UI §3: the same
 * sharing story as the secrets page — to one project, to a firm, or to an
 * agent role).
 *
 * This screen replaces a stub that said the page was not built. What it shows
 * is what the console reports and nothing else: a server's shape, whether it
 * is reachable, the NAMES of the environment keys it needs, and its holders.
 * A token is never part of that answer — the console masks values before they
 * leave it, so there is nothing here to leak.
 *
 * Rows are statements with one control each. Tapping the holder line opens the
 * grant sheet; nothing else on a row does anything, because a page about
 * permissions should never act on a stray tap.
 */

const CARD = "flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card";

function Group({ label, count, action, children }: { label: string; count: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-1.5 px-1 text-label font-semibold text-secondary">
        {label}
        <span className="text-caption font-semibold tabular-nums text-muted">{count}</span>
        {action ? <span className="ml-auto">{action}</span> : null}
      </h2>
      <div className={CARD}>{children}</div>
    </section>
  );
}

/** Reachability, in three words rather than a colour alone: a dot nobody can
    name is not a status. */
function Reach({ status }: { status?: McpServerRow["status"] }) {
  const { t } = useLocale();
  if (!status) return null;
  return (
    <span
      data-mcp-reach={status.reachable ? "up" : "down"}
      title={status.detail}
      className={`shrink-0 text-label font-semibold ${status.reachable ? "text-success" : "text-danger"}`}
    >
      {t(status.reachable ? "mcp.up" : "mcp.down")}
    </span>
  );
}

function Holders({ holders, fleet }: { holders: string[]; fleet?: string[] }) {
  const { t } = useLocale();
  const all = [...holders, ...(fleet ?? []).map((scope) => `fleet:${scope}`)];
  if (all.length === 0) return <span className="truncate text-label text-muted">{t("mcp.grantedToNobody")}</span>;
  return <span className="truncate text-label text-muted">{all.join(", ")}</span>;
}

function ServerRow({ server, onGrant }: { server: McpServerRow; onGrant: (server: McpServerRow) => void }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      data-mcp-server={server.name}
      onClick={() => onGrant(server)}
      aria-label={t("mcp.editGrants", { item: server.name })}
      className="flex min-h-14 w-full items-center gap-2.5 px-4 py-2 text-left active:bg-sunken"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-body font-semibold text-primary">{server.name}</span>
          <Reach status={server.status} />
        </span>
        <span className="truncate text-label text-muted">{serverLine(server)}</span>
        <Holders holders={server.granted_to} fleet={server.fleet_env} />
        {/* Key NAMES, never values: this is what the server needs, not what
            it was given. */}
        {server.env_keys?.length ? (
          <span className="truncate text-caption text-muted">{server.env_keys.join(" · ")}</span>
        ) : null}
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted" aria-hidden />
    </button>
  );
}

function SkillRowView({ skill, onGrant }: { skill: SkillRow; onGrant: (skill: SkillRow) => void }) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      data-mcp-skill={skill.id}
      onClick={() => onGrant(skill)}
      aria-label={t("mcp.editGrants", { item: skill.id })}
      className="flex min-h-14 w-full items-center gap-2.5 px-4 py-2 text-left active:bg-sunken"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body font-semibold text-primary">{skill.name || skill.id}</span>
        {skill.description ? <span className="line-clamp-2 text-label text-muted">{skill.description}</span> : null}
        <Holders holders={skill.granted_to} />
      </span>
      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-muted" aria-hidden />
    </button>
  );
}

export function MobileMcpScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const registry = useMcpRegistry();
  const [pending, setPending] = useState<{ kind: "mcp" | "skills"; item: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const body = (() => {
    if (registry.error) {
      return (
        <div role="status" className="flex flex-col gap-2 px-1 text-label text-danger">
          {/* The console's own sentence, not a generic failure: «MCP … немає в
              ~/.claude.json» tells the operator what to do next. */}
          <p>{registry.error === "UNREACHABLE" ? t("list.failed") : registry.error}</p>
          <button type="button" onClick={() => void registry.refresh()} className="min-h-11 rounded-[12px] bg-card px-3">
            {t("list.retry")}
          </button>
        </div>
      );
    }
    if (!registry.servers && !registry.skills) {
      return <p role="status" className="px-1 text-label text-muted">{t("common.loading")}</p>;
    }
    return (
      <>
        {failure ? <p role="status" className="px-1 text-label text-danger">{failure}</p> : null}
        {/* Always rendered, list or no list: an empty registry is exactly when
            «+ Сервер» is needed, and hanging the button off the rows put it
            out of reach of the operator who had just removed the last one. */}
        <Group
          label={t("firms.rowMcp")}
          count={registry.servers?.length ?? 0}
          action={
            <button
              type="button"
              data-mcp-add-open
              onClick={() => { setFailure(null); setAdding(true); }}
              className="min-h-11 rounded-[12px] px-2 text-label font-semibold text-accent"
            >
              {t("mcp.add")}
            </button>
          }
        >
          {registry.servers?.length
            ? registry.servers.map((server) => (
              <ServerRow key={server.name} server={server} onGrant={(row) => { setFailure(null); setPending({ kind: "mcp", item: row.name }); }} />
            ))
            : <p className="px-4 py-3 text-label text-muted">{t("mcp.noServers")}</p>}
        </Group>
        {registry.skills?.length ? (
          <Group label={t("firms.rowSkills")} count={registry.skills.length}>
            {registry.skills.map((skill) => (
              <SkillRowView key={skill.id} skill={skill} onGrant={(row) => { setFailure(null); setPending({ kind: "skills", item: row.id }); }} />
            ))}
          </Group>
        ) : null}
        {pending ? (
          <McpGrantSheet
            subject={pending}
            onClose={() => setPending(null)}
            onApply={async (target, revoke) => {
              const problem = await registry.grant(pending.kind, pending.item, target, revoke);
              setFailure(problem);
              if (!problem) setPending(null);
            }}
            /* Skills are files on disk; the console removes servers only. */
            onRemove={pending.kind === "mcp" ? () => registry.removeServer(pending.item) : undefined}
          />
        ) : null}
        {adding ? (
          <MobileMcpAddSheet onClose={() => setAdding(false)} onSubmit={registry.addServer} />
        ) : null}
      </>
    );
  })();

  return (
    <MobileShell screen="mcp" title={<MobileBarTitle>{t("mobile2.tabs.mcp")}</MobileBarTitle>} host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-mcp>
        {body}
      </div>
    </MobileShell>
  );
}

/**
 * Where an item goes. The target is typed rather than picked from a list on
 * purpose for now: the firms screen already owns the org tree, and duplicating
 * that picker here would be a second place to keep it correct. The console
 * validates the target and refuses an unknown firm by name, so a typo answers
 * with «немає такої фірми: …» rather than silently doing nothing.
 */
export function McpGrantSheet({
  subject,
  onClose,
  onApply,
  onRemove,
}: {
  subject: { kind: "mcp" | "skills"; item: string };
  onClose: () => void;
  onApply: (target: string, revoke: boolean) => Promise<void>;
  /** Present for a server: take it out of the registry entirely. */
  onRemove?: () => Promise<McpRemoveOutcome>;
}) {
  const { t } = useLocale();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (revoke: boolean) => {
    if (!target.trim() || busy) return;
    setBusy(true);
    await onApply(target.trim(), revoke);
    setBusy(false);
  };

  /* No confirmation (README §2 rule 9): the tap that names the action does it,
     and the receipt is the safety net. The console purges the item's grants
     along with it, so nothing is left pointing at a server that is gone. */
  const remove = async () => {
    if (!onRemove || busy) return;
    setBusy(true);
    const outcome = await onRemove();
    setBusy(false);
    if (outcome.error) { setFailure(outcome.error); return; }
    /* The receipt says what it cost. Removal has no inverse here: the console
       purged the grants and the env and header values went with the server —
       this page never held them, so there is nothing to put back. */
    showReceipt(t("mcp.removedDetail", { name: subject.item, count: outcome.grantsCleaned }));
    onClose();
  };

  return (
    <div className={`${CARD} p-3`} data-mcp-grant={subject.item}>
      <p className="pb-2 text-label font-semibold text-primary">{t("mcp.grantTitle", { item: subject.item })}</p>
      <input
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        placeholder="project:money"
        aria-label={t("mcp.grantTarget")}
        className="min-h-11 w-full rounded-[12px] border border-border bg-card px-3 text-body text-primary"
      />
      <p className="pt-1 text-caption text-muted">{t("mcp.grantHint")}</p>
      <div className="flex gap-2 pt-2">
        <button type="button" disabled={busy || !target.trim()} onClick={() => void run(false)}
          className="min-h-11 flex-1 rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50">
          {t("mcp.grant")}
        </button>
        <button type="button" disabled={busy || !target.trim()} onClick={() => void run(true)}
          className="min-h-11 flex-1 rounded-[12px] bg-quiet px-3 text-label text-secondary disabled:opacity-50">
          {t("mcp.revoke")}
        </button>
        <button type="button" onClick={onClose} className="min-h-11 rounded-[12px] px-3 text-label text-muted">
          {t("common.cancel")}
        </button>
      </div>
      {failure ? <p role="status" data-mcp-failure className="pt-2 text-label text-danger">{failure}</p> : null}
      {onRemove ? (
        <p className="pt-2 text-caption text-muted">{t("mcp.removeHint")}</p>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          data-mcp-remove={subject.item}
          disabled={busy}
          onClick={() => void remove()}
          className="mt-2 min-h-11 border-t border-border pt-2 text-left text-label font-semibold text-danger disabled:opacity-50"
        >
          {t("mcp.removeServer")}
        </button>
      ) : null}
    </div>
  );
}
