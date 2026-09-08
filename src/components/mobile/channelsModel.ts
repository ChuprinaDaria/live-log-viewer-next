"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * The chats a project listens to.
 *
 * The operator picks an account from the ones already enrolled and pastes a
 * link. Nothing here asks for a chat id: the console stores the intent, and
 * the collector fills in the id, title and kind the first time it reaches the
 * chat. So a channel is «unresolved» for a while, and the page says so rather
 * than pretending the connection is complete.
 *
 * Accounts come split into usable and not-usable with a reason, because a bot
 * token cannot read a chat — no history in a group it does not administer, no
 * joining a stranger's channel from a link. Offering one in the picker would
 * produce a channel that silently collects nothing.
 */

export interface Channel {
  kind: string;
  link: string;
  account: string;
  label?: string;
  /** Filled by the collector, not by the operator. */
  chat_id: string | null;
  title: string | null;
  chat_kind: string | null;
  resolved_at: string | null;
  added_at?: string;
  /** Which node it came from when the list is a project's effective set. */
  from?: string;
  /** Which node owns it when the list is system-wide. */
  owner?: string;
}

export interface ChannelAccount {
  id: string;
  label: string | null;
  state: "alive" | "dead" | "unknown";
  /** Present only on the ones that cannot be used, and says why. */
  why?: string;
}

export interface ChannelsRead {
  channels: Channel[] | null;
  usable: ChannelAccount[];
  notUsable: ChannelAccount[];
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  connect: (target: string, link: string, account: string, label?: string) => Promise<string | null>;
  disconnect: (target: string, link: string) => Promise<string | null>;
}

export function useChannels(): ChannelsRead {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [usable, setUsable] = useState<ChannelAccount[]>([]);
  const [notUsable, setNotUsable] = useState<ChannelAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const options = { cache: "no-store" as const, ...(signal ? { signal } : {}) };
      const [listed, accounts] = await Promise.all([
        fetch("/api/channels", options),
        fetch("/api/channels?accounts=1", options),
      ]);
      const list = await listed.json() as { channels?: Channel[]; error?: string };
      const who = await accounts.json() as { usable?: ChannelAccount[]; not_usable?: ChannelAccount[]; error?: string };
      if (!listed.ok) { setError(list.error ?? `HTTP ${listed.status}`); return; }
      setChannels(list.channels ?? []);
      setUsable(who.usable ?? []);
      setNotUsable(who.not_usable ?? []);
      setError(null);
    } catch (cause) {
      if ((cause as { name?: string }).name !== "AbortError") setError("UNREACHABLE");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const post = useCallback(async (body: Record<string, unknown>): Promise<string | null> => {
    try {
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = await response.json() as { error?: string };
      if (!response.ok) return answer.error ?? `HTTP ${response.status}`;
      /* The route answers with one node's list; the page shows every node, so
         it re-reads rather than splicing a partial answer into a whole view. */
      await load();
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    }
  }, [load]);

  return {
    channels, usable, notUsable, error, loading,
    refresh: () => load(),
    connect: (target, link, account, label) => post({ target, link, account, ...(label ? { label } : {}) }),
    disconnect: (target, link) => post({ target, link, remove: true }),
  };
}

/** What a channel is called before anyone has reached it. The link is the only
    thing the operator typed, so it stands in until the collector knows better. */
export function channelTitle(channel: Channel): string {
  return channel.title || channel.label || channel.link;
}

/** «telegram · @noologic_chat» — what it is and where it points. */
export function channelLine(channel: Channel): string {
  return [channel.kind, channel.chat_id ?? channel.link].filter(Boolean).join(" · ");
}
