"use client";

import { useState } from "react";

import { ChevronDown, FolderPlus, Loader2 } from "@/components/icons";
import { useLocale } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import {
  loadProject,
  originLabel,
  projectTree,
  useOrg,
  writeOrg,
  type FirmRow,
  type ProjectDetail,
  type ProjectRow,
} from "./firmsModel";

/*
 * «Фірми» (TZ-UI.md): the org layer — firm → project → subfolder — with what
 * each level actually holds.
 *
 * PEOPLE ARE NOT PROJECTS. Даша and Костя are the firm's people, and they get
 * their own labelled block on the firm's card, beside the projects block and
 * never inside it. That is the single rule this screen exists to respect: the
 * hierarchy has firms, projects and subfolders in it, and nothing else.
 *
 * Every write goes to the console (fleetctl) through /api/firms and
 * /api/projects, so a change here is the same change the CLI or an agent
 * makes, with the same validation, audit line and backup.
 */

const FIELD = "min-h-11 w-full rounded-control border border-border bg-card px-3 text-body text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const ACTION = "inline-flex min-h-11 items-center rounded-control border border-accent px-4 text-body font-semibold text-accent active:bg-accent-soft disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";
const QUIET = "inline-flex min-h-11 items-center rounded-control border border-border px-3 text-body text-secondary active:bg-sunken disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function MobileFirmsScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const org = useOrg();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <MobileShell screen="firms" title={<MobileBarTitle>{t("firms.title")}</MobileBarTitle>} back host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-firms>
        {org.error && !org.firms ? (
          <p className="px-6 pt-10 text-center text-body text-secondary" data-mobile2-firms-error>{t("firms.unreachable")}</p>
        ) : org.firms === null ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-body text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("common.loading")}
          </div>
        ) : (
          <>
            {org.firms.length === 0 ? (
              <p className="px-1 pt-6 text-center text-body text-secondary">{t("firms.none")}</p>
            ) : org.firms.map((firm) => (
              <FirmCard
                key={firm.id}
                firm={firm}
                projects={org.projects ?? []}
                open={open === firm.id}
                onToggle={() => setOpen((was) => (was === firm.id ? null : firm.id))}
                onChanged={org.refresh}
              />
            ))}
            {creating ? (
              <CreateFirm onDone={() => { setCreating(false); void org.refresh(); }} onCancel={() => setCreating(false)} />
            ) : (
              <button type="button" className={`${QUIET} self-start`} data-mobile2-firm-new onClick={() => setCreating(true)}>
                <FolderPlus className="mr-1.5 h-4 w-4" aria-hidden />{t("firms.newFirm")}
              </button>
            )}
          </>
        )}
      </div>
    </MobileShell>
  );
}

function FirmCard({ firm, projects, open, onToggle, onChanged }: {
  firm: FirmRow;
  projects: readonly ProjectRow[];
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const tree = projectTree(projects, firm.id);

  return (
    <section className="overflow-hidden rounded-surface border border-border bg-card" data-mobile2-firm={firm.id}>
      <button
        type="button"
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-2 px-3 py-2 text-left active:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        onClick={onToggle}
      >
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-primary">{firm.name}</span>
          <span className="mt-0.5 block truncate font-mono text-caption text-muted">{firm.id}</span>
        </span>
        <span className="shrink-0 tabular-nums text-caption text-muted">{t("firms.projectCount", { count: firm.projects.length })}</span>
      </button>

      {open ? (
        <div className="flex flex-col border-t border-border" data-mobile2-firm-body={firm.id}>
          {/* Three bands, in this order and never merged: what the firm HAS
              (projects), WHO it is (people), and what it hands DOWN (grants
              and rules). People are not a level of the hierarchy and not a
              project, so they are their own band with their own anatomy: one
              sentence, no rows, no chevron, nothing to tap. Everything
              tappable inside a firm card is a project. */}
          <Band label={t("firms.sectionProjects")} count={tree.length || undefined} />
          {tree.length === 0 ? null : (
            <ul className="flex flex-col divide-y divide-border">
              {tree.map((node) => (
                <li key={node.row.id}>
                  <ProjectLine row={node.row} firmId={firm.id} depth={0} />
                  {node.children.map((child) => <ProjectLine key={child.id} row={child} firmId={firm.id} depth={1} />)}
                </li>
              ))}
            </ul>
          )}
          {addingProject ? (
            <div className="border-t border-border px-3 py-3">
              <CreateProject firm={firm} onDone={() => { setAddingProject(false); void onChanged(); }} onCancel={() => setAddingProject(false)} />
            </div>
          ) : (
            <RowAction label={t("firms.addProject")} attrs={{ "data-mobile2-project-new": firm.id }} onSelect={() => setAddingProject(true)} />
          )}

          {firm.people.length ? (
            <>
              <Band label={t("firms.sectionPeople")} />
              <p className="min-h-11 px-3 py-2.5 text-body leading-snug text-primary" data-mobile2-firm-people={firm.id}>
                {firm.people.join(" · ")}
              </p>
            </>
          ) : null}

          <Inherited firm={firm} />

          {editing ? (
            <div className="border-t border-border px-3 py-3">
              <EditFirm firm={firm} onDone={() => { setEditing(false); void onChanged(); }} />
            </div>
          ) : (
            <RowAction label={t("firms.editFirm")} attrs={{ "data-mobile2-firm-edit": firm.id }} onSelect={() => setEditing(true)} />
          )}
        </div>
      ) : null}
    </section>
  );
}

/** A section band: what the rows under it are. Not a control, so it carries no
    touch target and no chevron. */
function Band({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex min-h-7 items-center gap-2 border-t border-border bg-sunken px-3 text-label font-semibold text-muted">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === undefined ? null : <span className="shrink-0 tabular-nums text-caption">{count}</span>}
    </div>
  );
}

function RowAction({ label, attrs, onSelect }: { label: string; attrs?: Record<string, string>; onSelect: () => void }) {
  return (
    <button
      type="button"
      {...attrs}
      className="flex min-h-12 w-full items-center border-t border-border px-3 text-left text-body font-medium text-accent active:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

/** What the firm hands down to every project under it. Absent lines are not
    printed: a firm with no skills has no skills line, not a zero. */
function Inherited({ firm }: { firm: FirmRow }) {
  const { t } = useLocale();
  const rows: { label: string; value: string }[] = [];
  if (firm.grants.mcp.length) rows.push({ label: t("firms.rowMcp"), value: firm.grants.mcp.join(", ") });
  if (firm.grants.skills.length) rows.push({ label: t("firms.rowSkills"), value: firm.grants.skills.join(", ") });
  if (firm.secrets.length) rows.push({ label: t("firms.rowSecrets"), value: firm.secrets.join(", ") });
  if (firm.rules) rows.push({ label: t("firms.rowRules"), value: String(firm.rules) });
  if (!rows.length) return null;
  return (
    <>
      <Band label={t("firms.sectionInherited")} />
      <dl className="flex flex-col divide-y divide-border" data-mobile2-firm-facts>
        {rows.map((row) => (
          <div key={row.label} className="flex min-h-11 items-start gap-3 px-3 py-2.5">
            <dt className="w-[84px] shrink-0 text-label font-medium text-secondary">{row.label}</dt>
            <dd className="min-w-0 flex-1 text-body leading-snug text-primary">{row.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** One project or subfolder. Tapping it asks the console what actually
    applies here and where each item came from. */
function ProjectLine({ row, firmId, depth }: { row: ProjectRow; firmId: string; depth: number }) {
  const { t } = useLocale();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (detail) return;
    setBusy(true);
    try {
      setDetail(await loadProject(row.id));
    } catch {
      setDetail(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-mobile2-project={row.id}>
      <button
        type="button"
        aria-expanded={open}
        className={`flex min-h-12 w-full items-center gap-2 py-2 pr-3 text-left active:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${depth ? "pl-8" : "pl-3"}`}
        onClick={() => void toggle()}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-primary">{row.name}</span>
          {row.path ? <span className="mt-0.5 block truncate font-mono text-caption text-muted">{row.path}</span> : null}
        </span>
        {depth ? <span className="shrink-0 text-caption text-muted">{t("firms.subfolder")}</span> : null}
      </button>
      {open ? (
        <div className={`border-t border-border bg-sunken py-2 pr-3 ${depth ? "pl-8" : "pl-3"}`} data-mobile2-project-detail={row.id}>
          {busy ? (
            <p className="flex items-center gap-2 text-caption text-muted"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />{t("common.loading")}</p>
          ) : detail?.effective ? (
            <Effective detail={detail} firmId={firmId} />
          ) : (
            <p className="text-caption text-muted">{t("firms.noDetail")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What applies at this level, grouped by WHERE it came from, with the source
 * printed once as a band over its group.
 *
 * The alternative — a marker on every item — puts twenty little labels on a
 * phone to say one thing three times. Position carries it too: own first,
 * inherited below, and the band says the origin in words, so nothing depends
 * on colour.
 */
function Effective({ detail, firmId }: { detail: ProjectDetail; firmId: string }) {
  const { t } = useLocale();
  const sections: { label: string; items: { text: string; from: string }[] }[] = [
    { label: t("firms.rowMcp"), items: (detail.effective?.mcp ?? []).map((item) => ({ text: item.item, from: item.from })) },
    { label: t("firms.rowSkills"), items: (detail.effective?.skills ?? []).map((item) => ({ text: item.item, from: item.from })) },
    { label: t("firms.rowRules"), items: (detail.effective?.rules ?? []).map((item) => ({ text: item.rule, from: item.from })) },
  ].filter((section) => section.items.length > 0);
  if (!sections.length) return <p className="text-caption text-muted">{t("firms.nothingApplies")}</p>;

  const sourceName = (from: string): string => {
    const origin = originLabel(from, firmId);
    if (origin === "own") return t("firms.sourceOwn");
    if (origin === "firm") return t("firms.sourceFirm", { firm: firmId });
    return from;
  };

  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => {
        /* Own first, then whatever it inherits from: the nearest source is
           the one that decided, so it reads first. */
        const order = [...new Set(section.items.map((item) => item.from))]
          .sort((a, b) => Number(originLabel(a, firmId) !== "own") - Number(originLabel(b, firmId) !== "own"));
        return (
          <div key={section.label}>
            <p className="pb-1 text-label font-semibold text-muted">{section.label}</p>
            <div className="overflow-hidden rounded-control border border-border bg-card">
              {order.map((from) => (
                <div key={from}>
                  <p className="flex min-h-7 items-center border-b border-border bg-sunken px-2.5 text-label font-semibold text-muted">
                    {sourceName(from)}
                  </p>
                  <ul className="flex flex-col divide-y divide-border">
                    {section.items.filter((item) => item.from === from).map((item) => (
                      <li
                        key={`${section.label}/${item.text}`}
                        className={`px-2.5 py-2 text-body leading-snug ${originLabel(from, firmId) === "own" ? "text-primary" : "text-secondary"}`}
                      >
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CreateFirm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useLocale();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [people, setPeople] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    const error = await writeOrg("/api/firms", {
      create: true,
      firm: id.trim(),
      name: name.trim() || undefined,
      people: people.split(",").map((person) => person.trim()).filter(Boolean),
    });
    setBusy(false);
    setFailure(error);
    if (!error) onDone();
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-surface border border-border bg-card p-3"
      data-mobile2-firm-form
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      <input className={FIELD} value={id} onChange={(event) => setId(event.target.value)} placeholder={t("firms.fieldId")} aria-label={t("firms.fieldId")} autoCapitalize="none" autoCorrect="off" />
      <input className={FIELD} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("firms.fieldName")} aria-label={t("firms.fieldName")} />
      <input className={FIELD} value={people} onChange={(event) => setPeople(event.target.value)} placeholder={t("firms.fieldPeople")} aria-label={t("firms.fieldPeople")} />
      {failure ? <p className="text-caption leading-snug text-danger">{failure}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={ACTION} disabled={busy || !id.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("firms.create")}
        </button>
        <button type="button" className={QUIET} onClick={onCancel}>{t("firms.cancel")}</button>
      </div>
    </form>
  );
}

function CreateProject({ firm, onDone, onCancel }: { firm: FirmRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useLocale();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    const error = await writeOrg("/api/projects", {
      create: true,
      project: id.trim(),
      firm: firm.id,
      name: name.trim() || undefined,
      path: directory.trim() || undefined,
      ...(parent ? { parent } : {}),
    });
    setBusy(false);
    setFailure(error);
    if (!error) onDone();
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-control border border-border bg-card p-3"
      data-mobile2-project-form={firm.id}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      <input className={FIELD} value={id} onChange={(event) => setId(event.target.value)} placeholder={t("firms.fieldProjectId")} aria-label={t("firms.fieldProjectId")} autoCapitalize="none" autoCorrect="off" />
      <input className={FIELD} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("firms.fieldName")} aria-label={t("firms.fieldName")} />
      <input className={FIELD} value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder={t("firms.fieldPath")} aria-label={t("firms.fieldPath")} autoCapitalize="none" autoCorrect="off" />
      {firm.projects.length ? (
        <select className={FIELD} value={parent} onChange={(event) => setParent(event.target.value)} aria-label={t("firms.fieldParent")}>
          <option value="">{t("firms.noParent")}</option>
          {firm.projects.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
        </select>
      ) : null}
      {failure ? <p className="text-caption leading-snug text-danger">{failure}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={ACTION} disabled={busy || !id.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("firms.create")}
        </button>
        <button type="button" className={QUIET} onClick={onCancel}>{t("firms.cancel")}</button>
      </div>
    </form>
  );
}

/** The firm's editable fields. People stay a list of people; rules are one
    per line, because a rule with a comma in it is ordinary. */
function EditFirm({ firm, onDone }: { firm: FirmRow; onDone: () => void }) {
  const { t } = useLocale();
  const [name, setName] = useState(firm.name);
  const [people, setPeople] = useState(firm.people.join(", "));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    const error = await writeOrg("/api/firms", {
      firm: firm.id,
      name: name.trim() || undefined,
      people: people.split(",").map((person) => person.trim()).filter(Boolean),
    });
    setBusy(false);
    setFailure(error);
    if (!error) onDone();
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-control border border-border bg-card p-3"
      data-mobile2-firm-editor={firm.id}
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
    >
      <input className={FIELD} value={name} onChange={(event) => setName(event.target.value)} aria-label={t("firms.fieldName")} placeholder={t("firms.fieldName")} />
      <input className={FIELD} value={people} onChange={(event) => setPeople(event.target.value)} aria-label={t("firms.fieldPeople")} placeholder={t("firms.fieldPeople")} />
      {failure ? <p className="text-caption leading-snug text-danger">{failure}</p> : null}
      <button type="submit" className={`${ACTION} self-start`} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("firms.save")}
      </button>
    </form>
  );
}
