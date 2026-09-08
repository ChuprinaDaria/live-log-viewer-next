"use client";

import { AtSign } from "lucide-react";

import { useKeyboardInset } from "@/hooks/useComposer";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { DOT } from "./MobileBoard";
import type { MobileBoardConversation } from "./mobileBoardModel";

/*
 * The Чат tab's roster (TZ-UI.md: chat with the orchestrator + agents): the
 * project's agents as chips under the bar, in the board's own triage order.
 * A chip is a state dot and a title — never the engine, which is what made
 * the retired focus strip read «Claude · Claude · Claude». It exists on one
 * tab only, renders nothing without agents, and yields to the keyboard.
 */
export function MobileAgentsStrip({ agents, onOpen, onMention }: {
  agents: MobileBoardConversation[];
  onOpen: (file: FileEntry) => void;
  /** Absent → no @ cell (nothing to mention into). */
  onMention?: () => void;
}) {
  const { t } = useLocale();
  const keyboard = useKeyboardInset();
  if (!agents.length || keyboard > 0) return null;
  return (
    <div
      data-mobile2-agents
      role="group"
      aria-label={t("mobile2.chat.agents")}
      className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden border-b border-border bg-canvas px-3 snap-x snap-mandatory [scrollbar-width:none]"
    >
      {agents.map((row) => (
        <button
          key={row.path}
          type="button"
          data-mobile2-agent={row.path}
          data-mobile2-state={row.state.key}
          aria-label={t("mobile2.chat.openAgent", { title: row.title })}
          className="flex h-9 max-w-[152px] shrink-0 snap-start items-center gap-1.5 rounded-full border border-border bg-card pl-2.5 pr-3 text-body text-primary active:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={() => onOpen(row.file)}
        >
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT[row.state.dot]} ${row.state.key === "working" ? "motion-safe:animate-pulse" : ""}`} />
          <span className="min-w-0 truncate">{row.title}</span>
        </button>
      ))}
      {onMention ? (
        <button
          type="button"
          data-mobile2-open="mention"
          aria-label={t("mobile2.chat.mention")}
          className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] text-secondary active:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={onMention}
        >
          <AtSign className="h-5 w-5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
