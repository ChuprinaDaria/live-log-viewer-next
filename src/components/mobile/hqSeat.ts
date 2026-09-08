"use client";

import { useCallback, useEffect, useState } from "react";

import type { FileEntry } from "@/lib/types";

/*
 * The standing HQ seat as the phone reads it (see `@/lib/orchestrator/hq`):
 * a slow status poll, the one confirm that seats it, and the transcript it
 * owns once the scanner has it. The conversation itself streams through the
 * feed's own channel.
 */

export interface HqSeatRecord {
  conversationId: string;
  path: string | null;
}

export interface HqStatus {
  seat: HqSeatRecord | null;
  pending: HqSeatRecord | null;
  exists: boolean;
}

export interface HqSeatRead {
  /** Null until the first answer. */
  status: HqStatus | null;
  failed: boolean;
  /** The confirm is in flight. */
  starting: boolean;
  /** The last confirm's refusal, in the server's words. */
  error: string | null;
  start: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const HQ_POLL_MS = 6_000;
const REQUEST_KEY = "llvHqStart";

function seatRecord(value: unknown): HqSeatRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { conversationId?: unknown; path?: unknown };
  if (typeof record.conversationId !== "string" || !record.conversationId) return null;
  return { conversationId: record.conversationId, path: typeof record.path === "string" ? record.path : null };
}

async function fetchHq(signal?: AbortSignal): Promise<HqStatus> {
  const response = await fetch("/api/orchestrator/hq", signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`hq read failed: ${response.status}`);
  const body = await response.json() as { seat?: unknown; pending?: unknown; exists?: unknown };
  return { seat: seatRecord(body.seat), pending: seatRecord(body.pending), exists: body.exists === true };
}

/** One request id per attempt, kept until the seat answers, so a retry after
    a dropped connection replays the same designation instead of seating twice. */
function requestId(): string {
  try {
    const stored = sessionStorage.getItem(REQUEST_KEY);
    if (stored) return stored;
    const fresh = `hq-${crypto.randomUUID()}`;
    sessionStorage.setItem(REQUEST_KEY, fresh);
    return fresh;
  } catch {
    return `hq-${crypto.randomUUID()}`;
  }
}

function forgetRequestId(): void {
  try {
    sessionStorage.removeItem(REQUEST_KEY);
  } catch {
    // nothing to forget
  }
}

export function useHqSeat(): HqSeatRead {
  const [status, setStatus] = useState<HqStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchHq());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      fetchHq(controller.signal)
        .then((next) => { setStatus(next); setFailed(false); })
        .catch((cause: unknown) => {
          if ((cause as { name?: string }).name !== "AbortError") setFailed(true);
        });
    };
    load();
    const timer = setInterval(load, HQ_POLL_MS);
    return () => { clearInterval(timer); controller.abort(); };
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/orchestrator/hq", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientRequestId: requestId() }),
      });
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      if (response.ok) {
        forgetRequestId();
      } else {
        setError(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
      await refresh();
    }
  }, [refresh]);

  return { status, failed, starting, error, start, refresh };
}

/** The seat's transcript among the scanned files, or null while the scanner
    has not picked it up yet. */
export function hqFileOf(files: readonly FileEntry[], status: HqStatus | null): FileEntry | null {
  const seat = status?.seat;
  if (!seat) return null;
  return files.find((file) => file.conversationId === seat.conversationId || (seat.path !== null && file.path === seat.path)) ?? null;
}
