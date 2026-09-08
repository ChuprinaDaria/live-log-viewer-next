"use client";

import { useRef, useState } from "react";

import { useLocale } from "@/lib/i18n";

import type { McpServerInput } from "./mcpModel";
import { showReceipt } from "./MobileReceipt";
import { MobileSheet } from "./MobileSheet";

/*
 * The form that puts an MCP server into the registry (TZ-UI §3: the phone can
 * add one, not only look at what is already there).
 *
 * The shape travels as flags; the values do not. `env` and `headers` are
 * tokens, so the route hands them to the console over stdin, where `ps` cannot
 * read them, and the audit line keeps their key names only. This sheet is the
 * other half of that promise: a value is a password field that React never
 * holds — it stays in the DOM node until submit reads it once — it is never
 * read back from the answer, and it dies with the sheet on close.
 *
 * No confirmation step (README §2 rule 9): the primary button acts, and the
 * receipt above the dock says what happened.
 */

type Kind = "stdio" | "http" | "sse";
const KINDS: readonly Kind[] = ["stdio", "http", "sse"];

const FIELD = "min-h-11 w-full rounded-[12px] border border-border bg-card px-3 text-body text-primary";
const LABEL = "flex flex-col gap-1 px-4 pt-2 text-label font-semibold text-secondary";
/** A path, a variable name, a URL: never a sentence, so no phone autocorrect. */
const RAW = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

/** Lines to arguments: one per line is how a person writes a command, and it
    is the only encoding that survives an argument containing a comma. */
function lines(text: string): string[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Names to an object, paired with the values still standing in the DOM. A row
    missing either half is dropped: a name with no value would write an empty
    variable, which the server reads as «set, and empty» — not what was meant. */
function collect(names: readonly string[], values: readonly string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  names.forEach((name, index) => {
    const key = name.trim();
    const value = values[index] ?? "";
    if (key && value) out[key] = value;
  });
  return Object.keys(out).length ? out : undefined;
}

function Field({ label, field, value, onChange, placeholder, multiline = false }: {
  label: string; field: string; value: string; placeholder?: string; multiline?: boolean;
  onChange: (next: string) => void;
}) {
  const shared = {
    value,
    placeholder,
    "aria-label": label,
    "data-mcp-field": field,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };
  return (
    <label className={LABEL}>
      {label}
      {multiline
        ? <textarea {...shared} rows={3} className={`${FIELD} py-2 font-mono text-label`} />
        : <input {...shared} {...RAW} className={FIELD} />}
    </label>
  );
}

/** KEY + value rows. The value is a password field, and an uncontrolled one:
    this page gets opened in a café, and a token neither standing in plain text
    on the screen nor sitting in a React state tree is the whole point. */
function Pairs({ label, hook, names, onChange, hidden }: {
  label: string; hook: "env" | "header"; names: string[]; hidden: boolean;
  onChange: (next: string[]) => void;
}) {
  const { t } = useLocale();
  /* Hidden, not unmounted: the values are uncontrolled, so unmounting the rows
     would silently throw away a typed token the moment the type is switched. */
  return (
    <div hidden={hidden} className="flex flex-col gap-1.5 px-4 pt-2">
      <span className="text-label font-semibold text-secondary">{label}</span>
      {names.map((name, index) => (
        <div key={index} className="flex gap-2">
          <input
            value={name}
            onChange={(event) => onChange(names.map((was, at) => (at === index ? event.target.value : was)))}
            {...{ [`data-mcp-${hook}-key`]: String(index) }}
            aria-label={`${label} ${index + 1}`}
            placeholder="KEY"
            {...RAW}
            className={`${FIELD} flex-1 font-mono text-label`}
          />
          <input
            type="password"
            defaultValue=""
            {...{ [`data-mcp-${hook}-value`]: String(index) }}
            aria-label={t("mcp.valueHidden")}
            placeholder={t("mcp.valueHidden")}
            autoComplete="new-password"
            className={`${FIELD} flex-1`}
          />
        </div>
      ))}
      <button
        type="button"
        {...{ [`data-mcp-add-${hook}`]: "" }}
        onClick={() => onChange([...names, ""])}
        className="min-h-11 self-start rounded-[12px] px-1 text-label font-semibold text-accent"
      >
        {t("mcp.addRow")}
      </button>
    </div>
  );
}

export function MobileMcpAddSheet({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  /** The console's refusal text, or null when the server is in the registry. */
  onSubmit: (input: McpServerInput) => Promise<string | null>;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [url, setUrl] = useState("");
  const [env, setEnv] = useState<string[]>([""]);
  const [headers, setHeaders] = useState<string[]>([""]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useRef<HTMLDivElement>(null);

  /* The one read of the values, at the moment they are sent. */
  const values = (hook: "env" | "header"): string[] =>
    Array.from(form.current?.querySelectorAll<HTMLInputElement>(`[data-mcp-${hook}-value]`) ?? [], (field) => field.value);

  const stdio = kind === "stdio";
  const ready = name.trim().length > 0 && (stdio ? command.trim().length > 0 : url.trim().length > 0);

  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setFailure(null);
    const argv = lines(args);
    const pairs = stdio ? collect(env, values("env")) : collect(headers, values("header"));
    const input: McpServerInput = {
      name: name.trim(),
      type: kind,
      ...(stdio
        ? {
            command: command.trim(),
            ...(argv.length ? { args: argv } : {}),
            ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
            ...(pairs ? { env: pairs } : {}),
          }
        : {
            url: url.trim(),
            ...(pairs ? { headers: pairs } : {}),
          }),
      ...(replace ? { replace: true } : {}),
    };
    const problem = await onSubmit(input);
    setBusy(false);
    if (problem) {
      setFailure(problem);
      return;
    }
    /* The receipt names the server, never anything typed into it; the state
       that held the values goes away with this component. */
    showReceipt(t("mcp.added", { name: input.name }));
    onClose();
  };

  return (
    <MobileSheet
      name="mcpAdd"
      title={t("mcp.addTitle")}
      onClose={onClose}
      footer={
        <button
          type="button"
          data-mcp-submit
          disabled={busy || !ready}
          onClick={() => void submit()}
          className="min-h-11 flex-1 rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50"
        >
          {t("mcp.submit")}
        </button>
      }
    >
      <div ref={form} className="flex flex-col pb-2">
        <Field label={t("mcp.name")} field="name" value={name} onChange={setName} placeholder="cohere" />
        <div className={LABEL}>
          {t("mcp.type")}
          <div className="flex gap-1 rounded-[12px] bg-quiet p-1">
            {KINDS.map((option) => (
              <button
                key={option}
                type="button"
                data-mcp-type={option}
                aria-pressed={kind === option}
                onClick={() => { setKind(option); setFailure(null); }}
                className={`min-h-11 flex-1 rounded-[10px] text-label font-semibold ${
                  kind === option ? "bg-card text-primary shadow-1" : "text-secondary"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        {stdio ? (
          <>
            <Field label={t("mcp.command")} field="command" value={command} onChange={setCommand} placeholder="/opt/venv/bin/cohere-mcp" />
            <Field label={t("mcp.args")} field="args" value={args} onChange={setArgs} multiline />
            <Field label={t("mcp.cwd")} field="cwd" value={cwd} onChange={setCwd} />
          </>
        ) : (
          <Field label={t("mcp.url")} field="url" value={url} onChange={setUrl} placeholder="https://127.0.0.1:27124/mcp/" />
        )}
        <Pairs label={t("mcp.env")} hook="env" names={env} onChange={setEnv} hidden={!stdio} />
        <Pairs label={t("mcp.headers")} hook="header" names={headers} onChange={setHeaders} hidden={stdio} />
        <button type="button" data-mcp-replace role="switch" aria-checked={replace}
          onClick={() => setReplace((was) => !was)}
          className="mx-4 mt-2 flex min-h-11 items-center gap-2.5 text-left text-label font-semibold text-primary">
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border ${
            replace ? "border-accent bg-accent text-white" : "border-border"
          }`} aria-hidden>{replace ? "✓" : ""}</span>
          {t("mcp.replace")}
        </button>
        {failure ? <p role="status" data-mcp-failure className="px-4 pt-2 text-label text-danger">{failure}</p> : null}
      </div>
    </MobileSheet>
  );
}
