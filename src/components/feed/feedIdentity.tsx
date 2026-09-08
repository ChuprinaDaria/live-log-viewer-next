"use client";

import { createContext, useContext } from "react";

import type { Engine } from "@/lib/types";

/**
 * Session-level identity the feed's turn headers render (TZ-UI.md stage 1):
 * engine, the operator-given agent name, the session's short model name, and
 * the account id owning the transcript. All four are attributes of the SESSION
 * — no transcript item carries them — so they travel by context, the same way
 * the provenance lookup does, and per-item props stay untouched.
 *
 * Honest-data rule (TZ): a field the session does not know is `null`, and the
 * header renders no element for it — no placeholders, no derived lookalikes.
 */
export type FeedIdentity = {
  engine: Engine | null;
  /** The deliberate agent name (a user rename, issue #33) — never the
      scanner-derived summary title, which is a description, not a name. */
  agentName: string | null;
  /** Display-normalized short model name (fable, gpt-5.5, sonnet…). */
  model: string | null;
  /** Account id from the transcript path; `null` for the default root. */
  account: string | null;
};

export const NO_FEED_IDENTITY: FeedIdentity = { engine: null, agentName: null, model: null, account: null };

const FeedIdentityContext = createContext<FeedIdentity>(NO_FEED_IDENTITY);

export const FeedIdentityProvider = FeedIdentityContext.Provider;

export function useFeedIdentity(): FeedIdentity {
  return useContext(FeedIdentityContext);
}
