"use client";

import { useRef, useState } from "react";

import { useLocale, type TFunction } from "@/lib/i18n";
import type { TelegramPhoneLoginView } from "@/lib/telegram/contracts";

import { showReceipt } from "./MobileReceipt";
import { MobileSheet } from "./MobileSheet";

/*
 * Connecting a Telegram USER account from the phone, by number.
 *
 * The operator's own words: «Я з моб. Не зручно QR.» A QR code drawn on the
 * screen she is holding has nothing to scan it with, so this sheet is the
 * other door into the same enrolment — number, then the code Telegram sends to
 * the device, then the two-step password when the account has one.
 *
 * Three values are typed here and none of them lingers. The number is state,
 * because the identifier is derived from it and the receipt names it; the code
 * is cleared the moment it is sent; the password is UNCONTROLLED and read once
 * by ref at submit, so no render, no state tree and no devtools snapshot of
 * the phone ever holds it. Nothing typed here is echoed back by the route
 * either — the answer is a phase and, at the end, a handle.
 *
 * No confirmation step and no dialogs (mobile README §2 rule 9): the primary
 * button acts, and the receipt or the failure line answers.
 */

const FIELD = "min-h-11 w-full rounded-[12px] border border-border bg-card px-3 text-body text-primary";
const LABEL = "flex flex-col gap-1 px-4 pt-2 text-label font-semibold text-secondary";
/** An identifier and a number: never a sentence, so no autocorrect. */
const RAW = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

/**
 * The identifier a number suggests: its digits with a letter in front.
 *
 * The slug becomes a directory name, a vault record id and an environment
 * variable, and none of those may begin with a digit — hence the `u`. It is
 * only a suggestion; the field below stays editable and the console has the
 * final say.
 */
function slugFromPhone(phone: string): string {
  const digits = phone.replace(/\D+/g, "").slice(0, 24);
  return digits ? `u${digits}` : "";
}

type Step = "phone" | "code" | "password";

/** The refusal to show, in the operator's language. The route's own sentence
    is used only when nothing here has a better word for it. */
function failureText(t: TFunction, login: TelegramPhoneLoginView | null, said: string | null, code: string | null): string | null {
  if (login?.error?.code === "flood_wait") {
    return t("telegram.floodWait", { seconds: login.error.seconds ?? 0 });
  }
  if (login?.error) return t(`telegram.err.${login.error.code}` as Parameters<TFunction>[0]);
  if (login?.codeError) return t("telegram.codeInvalid");
  if (login?.passwordError) return t("telegram.passwordInvalid");
  if (code === "login_busy") return t("telegram.err.login_busy");
  return said;
}

export function TelegramAccountSheet({ onClose, onConnected }: {
  onClose: () => void;
  /** Fired once the console holds the new account, so the page that opened
      this sheet can re-read its picker rather than guess. */
  onConnected?: () => void;
}) {
  const { t } = useLocale();
  const [phone, setPhone] = useState("");
  const [slug, setSlug] = useState("");
  const [slugOwn, setSlugOwn] = useState(false);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("phone");
  const [login, setLogin] = useState<TelegramPhoneLoginView | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passRef = useRef<HTMLInputElement>(null);

  const name = slug.trim();
  const number = phone.trim();

  /** One step of the flow: POST, then read the phase back off the answer. */
  const send = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setSaid(null);
    setFailureCode(null);
    try {
      const response = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = await response.json() as {
        logins?: TelegramPhoneLoginView[]; error?: string; code?: string;
      };
      if (!response.ok) {
        setSaid(answer.error ?? `HTTP ${response.status}`);
        setFailureCode(answer.code ?? null);
        return;
      }
      const mine = (answer.logins ?? []).find((row) => row.slug === name) ?? (answer.logins ?? [])[0] ?? null;
      setLogin(mine);
      if (!mine) return;
      if (mine.phase === "connected") {
        /* The receipt names the account, never anything typed to reach it. */
        const who = mine.identity?.username ? `@${mine.identity.username}` : mine.identity?.name ?? number;
        showReceipt(t("telegram.connected", { who }));
        onConnected?.();
        onClose();
        return;
      }
      if (mine.phase === "awaiting_password") { setStep("password"); return; }
      if (mine.phase === "failed") { setStep("phone"); return; }
      setStep("code");
    } catch (cause) {
      setSaid(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const startable = number.length > 0 && name.length > 0 && !busy;

  const problem = failureText(t, login, said, failureCode);

  return (
    <MobileSheet
      name="telegramAccount"
      title={t("telegram.addAccount")}
      onClose={onClose}
      footer={
        step === "phone" ? (
          <button type="button" data-tg-send disabled={!startable}
            onClick={() => { if (startable) void send({ action: "start_phone", slug: name, phone: number }); }}
            className="min-h-11 flex-1 rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50">
            {t("telegram.sendCode")}
          </button>
        ) : step === "code" ? (
          <button type="button" data-tg-submit-code disabled={busy || code.trim().length === 0}
            onClick={() => {
              const entered = code.trim();
              if (busy || !entered || !login) return;
              /* Cleared before the request, so the digits do not sit in the
                 state tree waiting for an answer that may never come. */
              setCode("");
              void send({ action: "code", operationId: login.operationId, code: entered });
            }}
            className="min-h-11 flex-1 rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50">
            {t("telegram.passwordSubmit")}
          </button>
        ) : (
          <button type="button" data-tg-submit-password disabled={busy}
            onClick={() => {
              const field = passRef.current;
              if (busy || !field || !login || field.value === "") return;
              /* The one read of the value, at the moment it is sent. */
              const entered = field.value;
              field.value = "";
              void send({ action: "password", slug: name, operationId: login.operationId, password: entered });
            }}
            className="min-h-11 flex-1 rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50">
            {t("telegram.passwordSubmit")}
          </button>
        )
      }
    >
      <div className="flex flex-col pb-2">
        <label className={LABEL}>
          {t("telegram.phone")}
          <input value={phone} data-tg-phone type="tel" inputMode="tel" autoComplete="tel"
            placeholder="+380…" aria-label={t("telegram.phone")} disabled={step !== "phone"}
            onChange={(event) => {
              const next = event.target.value;
              setPhone(next);
              if (!slugOwn) setSlug(slugFromPhone(next));
            }}
            {...RAW} className={FIELD} />
        </label>

        <label className={LABEL}>
          {t("telegram.slug")}
          <input value={slug} data-tg-slug aria-label={t("telegram.slug")} placeholder="work"
            disabled={step !== "phone"}
            onChange={(event) => { setSlugOwn(true); setSlug(event.target.value); }}
            {...RAW} className={FIELD} />
        </label>

        {step === "code" ? (
          <label className={LABEL}>
            {t("telegram.code")}
            <input value={code} data-tg-code inputMode="numeric" autoComplete="one-time-code"
              aria-label={t("telegram.code")} onChange={(event) => setCode(event.target.value)}
              {...RAW} className={FIELD} />
          </label>
        ) : null}

        {step === "password" ? (
          <label className={LABEL}>
            {t("telegram.passwordLabel")}
            {/* Uncontrolled on purpose: no state, no render, no snapshot ever
                holds it; `autoComplete="off"` keeps the keychain out too. */}
            <input ref={passRef} type="password" data-tg-password defaultValue=""
              aria-label={t("telegram.passwordLabel")} autoComplete="off" {...RAW} className={FIELD} />
            <span className="text-caption font-normal text-muted">{t("telegram.passwordHint")}</span>
          </label>
        ) : null}

        {problem ? (
          <p role="status" data-tg-failure className="px-4 pt-2 text-label text-danger">{problem}</p>
        ) : null}
      </div>
    </MobileSheet>
  );
}
