"use client";

import { useCallback, useEffect, useState } from "react";

import { getLocale, translate, type MessageKey } from "@/lib/i18n";

/*
 * The HQ room's signature as the dashboard reads and sets it (see
 * `@/lib/orchestrator/hqIdentity`): a name and an optional picture, one GET on
 * mount and one POST per change. The picture goes up as base64 in the same
 * JSON — an avatar is a few hundred KB at most, and a multipart body would buy
 * nothing but a second code path.
 */

export interface HqIdentityRead {
  name: string;
  avatarUrl: string | null;
}

const MAX_BYTES = 3 * 1024 * 1024;
const MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export interface HqIdentityState {
  /** Null until the first answer. */
  identity: HqIdentityRead | null;
  failed: boolean;
  refresh: () => Promise<void>;
  /** Resolves with an error to show, or null when it landed. */
  saveName: (name: string) => Promise<string | null>;
  saveAvatar: (file: File) => Promise<string | null>;
  clearAvatar: () => Promise<string | null>;
}

function identityOf(value: unknown): HqIdentityRead | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { name?: unknown; avatarUrl?: unknown };
  if (typeof record.name !== "string") return null;
  return { name: record.name, avatarUrl: typeof record.avatarUrl === "string" ? record.avatarUrl : null };
}

/** The server's refusal in the operator's language: the route's `code` is what
    the message is chosen by, so a translated string never has to be parsed. */
const say = (key: MessageKey): string => translate(getLocale(), key);

function refusalText(code: unknown, fallback: string): string {
  if (code === "name_invalid") return say("hq.identity.nameInvalid");
  if (code === "avatar_size") return say("hq.identity.tooBig");
  if (code === "avatar_type" || code === "avatar_mismatch") return say("hq.identity.badType");
  return fallback;
}

async function post(body: Record<string, unknown>): Promise<{ identity: HqIdentityRead | null; error: string | null }> {
  try {
    const response = await fetch("/api/orchestrator/hq/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) return { identity: null, error: refusalText(answer?.code, typeof answer?.error === "string" ? answer.error : `HTTP ${response.status}`) };
    return { identity: identityOf(answer), error: null };
  } catch (cause) {
    return { identity: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** The file's bytes as base64, without the `data:…;base64,` preamble. */
function readBase64(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma === -1 ? null : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function useHqIdentity(): HqIdentityState {
  const [identity, setIdentity] = useState<HqIdentityRead | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/orchestrator/hq/identity");
      if (!response.ok) throw new Error(`identity read failed: ${response.status}`);
      setIdentity(identityOf(await response.json()));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const apply = useCallback(async (body: Record<string, unknown>): Promise<string | null> => {
    const { identity: next, error } = await post(body);
    if (next) setIdentity(next);
    return error;
  }, []);

  const saveName = useCallback((name: string) => apply({ name }), [apply]);
  const clearAvatar = useCallback(() => apply({ clearAvatar: true }), [apply]);

  const saveAvatar = useCallback(async (file: File): Promise<string | null> => {
    /* Refused here first: a 3 MB file the server would reject anyway should
       never be read into memory and base64'd on a phone. */
    if (!MIMES.includes(file.type)) return say("hq.identity.badType");
    if (file.size > MAX_BYTES) return say("hq.identity.tooBig");
    const base64 = await readBase64(file);
    if (base64 === null) return say("hq.identity.badType");
    return apply({ avatar: { mime: file.type, base64 } });
  }, [apply]);

  return { identity, failed, refresh, saveName, saveAvatar, clearAvatar };
}
