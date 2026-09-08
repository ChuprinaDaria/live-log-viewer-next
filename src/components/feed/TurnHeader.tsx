"use client";

import type { ReactNode } from "react";

import type { Engine } from "@/lib/types";

import { MESSAGE_ACTION } from "./actionStyles";
import { CopyButton } from "./CopyButton";
import { EngineGlyph, engineLabel } from "./engineMark";
import { useFeedIdentity } from "./feedIdentity";
import { mobileClock } from "./cards/ToolCard";
import { tr } from "./parse";
import { SpeakButton } from "./SpeakButton";

/**
 * The one header an agent turn carries on the phone (TZ-UI.md stage 1):
 *
 *   row 1 (44px): engine glyph (the only color) · name · time · actions
 *   row 2 (meta): engine · model chip · account — only the fields that exist
 *
 * Row 1's name is the deliberate agent name when the session has one, else
 * the engine's; row 2 then names the engine only when row 1 was taken by the
 * agent name. No field — no element, no row 2 at all when it would be empty
 * (the honest-data rule; no dashes, no placeholders).
 */
export function TurnHeader({
  ts,
  engine: itemEngine,
  speakText,
  copyText,
}: {
  ts?: unknown;
  /** Engine of the head item when it knows one (prose); else the session's. */
  engine?: Engine;
  speakText?: string;
  copyText?: string;
}) {
  const identity = useFeedIdentity();
  const engine = itemEngine ?? identity.engine;
  const engineName = engineLabel(engine);
  const agentName = identity.agentName?.trim() || null;
  const name = agentName ?? engineName;
  const time = mobileClock(ts);
  const model = identity.model?.trim() || null;
  const account = identity.account?.trim() || null;
  const metaEngine = agentName ? engineName : null;
  const meta: ReactNode[] = [];
  if (metaEngine) meta.push(<span key="engine" className="shrink-0">{metaEngine}</span>);
  if (model)
    meta.push(
      <span
        key="model"
        className="shrink-0 rounded-full bg-sunken px-1.5 py-px text-caption font-semibold text-secondary"
        title={tr("mobile2.feed.sessionModel")}
      >
        {model}
      </span>,
    );
  if (account) meta.push(<span key="account" className="min-w-0 truncate">{account}</span>);
  return (
    <div data-mobile-turn-header>
      <div data-mobile-message-header className="flex h-11 w-full items-center gap-1.5 text-label text-muted">
        <EngineGlyph engine={engine ?? null} />
        {name ? <span className="min-w-0 flex-1 truncate font-semibold text-secondary">{name}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {time ? <span className="tabular-nums">{time}</span> : null}
          {speakText ? <SpeakButton text={speakText} /> : null}
          {copyText ? <CopyButton text={copyText} label={tr("feed.copyMd")} className={MESSAGE_ACTION} /> : null}
        </span>
      </div>
      {meta.length ? (
        <div data-mobile-turn-meta className="flex items-center gap-1 pb-1 text-caption text-muted">
          {meta.flatMap((node, i) =>
            i ? [<span key={`dot-${i}`} className="shrink-0 text-muted/60" aria-hidden>·</span>, node] : [node],
          )}
        </div>
      ) : null}
    </div>
  );
}
