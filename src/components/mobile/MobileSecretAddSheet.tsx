"use client";

import { useId, useRef, useState } from "react";

import { useLocale } from "@/lib/i18n";

import { useOrg } from "./firmsModel";
import { showReceipt } from "./MobileReceipt";
import type { SecretAddFailure, SecretAddInput } from "./secretsModel";
import { MobileSheet } from "./MobileSheet";

/*
 * The form that puts a key into the vault (TZ-UI: the secrets page).
 *
 * The page it opens from shows ADDRESSES — machine, file, variable — and that
 * stays true after this sheet exists. The value travels one way: out of the
 * password field, into the POST, into a 0600 file the console writes. It is
 * never rendered, never returned, and never held in React state, which is why
 * the field is uncontrolled and read once, by ref, at submit: a controlled
 * input would put the key in the state tree, in every render, and in every
 * devtools snapshot of the phone.
 *
 * No confirmation step (README §2 rule 9): the primary button acts and the
 * receipt answers. The new row appears with «не перевірявся» — liveness is
 * check.py's word, not this form's.
 */

const FIELD = "min-h-11 w-full rounded-[12px] border border-border bg-card px-3 text-body text-primary";
const LABEL = "flex flex-col gap-1 px-4 pt-2 text-label font-semibold text-secondary";
/** A slug, a variable name, a provider: never a sentence, so no autocorrect. */
const RAW = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

type Scope = "none" | "firm" | "project";

/** A label becomes an id the way a person would write one: lowercase, and one
    underscore wherever the punctuation was. Purely a suggestion — the field
    below it stays editable, and the console has the final say. */
function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}

/** The variable an id answers to by default. A variable cannot begin with a
    digit and `parse_ref` reads back only `[A-Z][A-Z0-9_]*`, so `2fa_token`
    gets a `K_` in front rather than becoming an unusable `2FA_TOKEN`. The
    field shows the result — it is what ends up in the ref. */
function envNameFor(slug: string): string {
  const upper = slug.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return /^[A-Z]/.test(upper) ? upper : upper ? `K_${upper}` : "";
}

function Field({ label, field, value, onChange, placeholder, list }: {
  label: string; field: string; value: string; placeholder?: string; list?: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className={LABEL}>
      {label}
      <input value={value} placeholder={placeholder} list={list} aria-label={label}
        data-secret-field={field} onChange={(event) => onChange(event.target.value)}
        {...RAW} className={FIELD} />
    </label>
  );
}

export function MobileSecretAddSheet({
  providers,
  onClose,
  onSubmit,
}: {
  /** Providers already in the inventory, offered as a datalist. Free text
      stays possible — a new provider is exactly what a new key often is. */
  providers: readonly string[];
  onClose: () => void;
  /** The console's refusal, or null when the key is in the vault. */
  onSubmit: (input: SecretAddInput) => Promise<SecretAddFailure | null>;
}) {
  const { t } = useLocale();
  const org = useOrg();
  const listId = useId();
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [provider, setProvider] = useState("");
  const [purpose, setPurpose] = useState("");
  const [envName, setEnvName] = useState("");
  const [scope, setScope] = useState<Scope>("none");
  const [target, setTarget] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<SecretAddFailure | null>(null);
  /* Set the moment she types either field herself: a derived suggestion that
     keeps overwriting what was typed is worse than no suggestion. */
  const [slugOwn, setSlugOwn] = useState(false);
  const [envOwn, setEnvOwn] = useState(false);
  const value = useRef<HTMLInputElement>(null);

  const setSlugAndEnv = (next: string) => {
    setSlug(next);
    if (!envOwn) setEnvName(envNameFor(next));
  };

  const ready = slug.trim().length > 0 && provider.trim().length > 0 && !busy;

  const submit = async () => {
    const field = value.current;
    if (!ready || !field) return;
    setBusy(true);
    setFailure(null);
    /* The one read of the value, at the moment it is sent. */
    const typed = field.value;
    const project = scope === "project" ? org.projects?.find((row) => row.id === target) : undefined;
    const name = slug.trim();
    const problem = await onSubmit({
      secret: name,
      value: typed,
      provider: provider.trim(),
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
      ...(envName.trim() ? { envName: envName.trim() } : {}),
      /* The firm travels with the project: the console refuses a project bound
         to another firm, and the tree here already knows which one it is. */
      ...(scope === "firm" && target ? { firm: target } : {}),
      ...(project ? { project: project.id, firm: project.firm } : {}),
      /* Absent, not false, when it was not asked for: the console reads a flag
         that is there, and «replace: false» is a flag that is there. */
      ...(replace ? { replace: true } : {}),
    });
    setBusy(false);
    if (problem) {
      setFailure(problem);
      /* Clear it rather than leave her guessing whether the field still holds
         what the console just refused. */
      field.value = "";
      return;
    }
    /* The receipt names the key, never anything typed into it; the component
       that briefly touched the value unmounts with the sheet. */
    showReceipt(t("secrets.added", { name }));
    onClose();
  };

  /* The console answers a duplicate in CLI terms («додайте --replace»); the
     route tags that one refusal with a code, and here it becomes the sentence
     naming the checkbox above. Everything else passes through as it was said. */
  const failureText = failure === null ? null
    : failure.code === "secret_exists" ? t("secrets.exists") : failure.error;

  const scopes: readonly { key: Scope; label: string }[] = [
    { key: "none", label: t("secrets.scopeNone") },
    { key: "firm", label: t("secrets.scopeFirm") },
    { key: "project", label: t("secrets.scopeProject") },
  ];
  const options = scope === "firm" ? org.firms ?? [] : scope === "project" ? org.projects ?? [] : [];

  return (
    <MobileSheet
      name="secretAdd"
      title={t("secrets.addTitle")}
      onClose={onClose}
      footer={
        <button type="button" data-secret-submit disabled={!ready} onClick={() => void submit()}
          className="min-h-11 flex-1 rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50">
          {t("secrets.submit")}
        </button>
      }
    >
      <div className="flex flex-col pb-2">
        <Field label={t("secrets.label")} field="label" value={label} placeholder="Cohere · RAG"
          onChange={(next) => { setLabel(next); if (!slugOwn) setSlugAndEnv(slugify(next)); }} />
        <Field label={t("secrets.id")} field="id" value={slug} placeholder="cohere_mcp"
          onChange={(next) => { setSlugOwn(true); setSlugAndEnv(next); }} />
        <Field label={t("secrets.provider")} field="provider" value={provider} placeholder="cohere"
          list={listId} onChange={setProvider} />
        <datalist id={listId}>
          {providers.map((name) => <option key={name} value={name} />)}
        </datalist>
        <Field label={t("secrets.purpose")} field="purpose" value={purpose}
          onChange={setPurpose} />
        <Field label={t("secrets.envName")} field="envName" value={envName} placeholder="COHERE_MCP"
          onChange={(next) => { setEnvOwn(true); setEnvName(next); }} />

        <label className={LABEL}>
          {t("secrets.value")}
          {/* Uncontrolled on purpose: no state, no render, no snapshot ever
              holds it; `autoComplete="off"` keeps the keychain out too. */}
          <input ref={value} type="password" defaultValue="" data-secret-value
            aria-label={t("secrets.value")} autoComplete="off" {...RAW} className={FIELD} />
          <span className="text-caption font-normal text-muted">{t("secrets.valueHint")}</span>
        </label>

        <div className={LABEL}>
          {t("secrets.scope")}
          <div className="flex gap-1 rounded-[12px] bg-quiet p-1" role="radiogroup" aria-label={t("secrets.scope")}>
            {scopes.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                data-secret-scope={option.key}
                aria-checked={scope === option.key}
                onClick={() => { setScope(option.key); setTarget(""); }}
                className={`min-h-11 flex-1 rounded-[10px] text-label font-semibold ${
                  scope === option.key ? "bg-card text-primary shadow-1" : "text-secondary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {scope === "none" ? null : (
          <label className={LABEL}>
            {scope === "firm" ? t("secrets.scopeFirm") : t("secrets.scopeProject")}
            <select
              value={target}
              data-secret-scope-target
              aria-label={scope === "firm" ? t("secrets.scopeFirm") : t("secrets.scopeProject")}
              onChange={(event) => setTarget(event.target.value)}
              className={FIELD}
            >
              <option value="">—</option>
              {options.map((row) => <option key={row.id} value={row.id}>{row.name || row.id}</option>)}
            </select>
          </label>
        )}
        <button type="button" data-secret-replace role="switch" aria-checked={replace}
          onClick={() => setReplace((was) => !was)}
          className="mx-4 mt-2 flex min-h-11 items-center gap-2.5 text-left text-label font-semibold text-primary">
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${
            replace ? "border-accent bg-accent text-white" : "border-border"
          }`} aria-hidden>{replace ? "✓" : ""}</span>
          {t("secrets.replace")}
        </button>
        {failureText ? <p role="status" data-secret-failure className="px-4 pt-2 text-label text-danger">{failureText}</p> : null}
      </div>
    </MobileSheet>
  );
}
