"use client";

import { useState } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";

import { ChevronUp } from "../../icons";
import { ACTION_GUTTER, MESSAGE_ACTION } from "../actionStyles";
import { CopyButton } from "../CopyButton";
import { CodeBlock } from "../markdown";
import { tr } from "../parse";

/** Level-1 preview budget; "show all output" reveals the full capped string.
    TZ-UI.md stage 1: 24 lines was half a phone screen of raw output per call
    — on 390px the budget is 8, and the trigger names what it hides. */
const PREVIEW_LINES = 24;
const MOBILE_PREVIEW_LINES = 8;
const PREVIEW_CHARS = 4_096;

/**
 * Capped tool output with a lazy "show all" reveal, or — when the output is
 * absent — one compact dim chip that replaces the old apology paragraphs
 * (issue #9 §6). A `lang` hint upgrades the expanded body to highlighted code.
 */
export function OutputPreview({
  output,
  truncated,
  lang,
  copyLabel,
  heading,
  tone = "out",
  showAllLabel,
}: {
  output: string;
  truncated: boolean;
  lang?: string | null;
  copyLabel?: string;
  /** Small stream label above the block (e.g. "stdout"/"stderr", issue #475). */
  heading?: string;
  /** `err` tints the block and heading for the stderr stream. */
  tone?: "out" | "err";
  showAllLabel?: string;
}) {
  const [all, setAll] = useState(false);
  const isMobile = useIsMobile();
  const budget = isMobile ? MOBILE_PREVIEW_LINES : PREVIEW_LINES;
  const label = heading ? (
    <div className={`mb-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${tone === "err" ? "text-danger" : "text-muted"}`}>{heading}</div>
  ) : null;
  /* Absent output renders nothing at all: an "no output captured" apology row
     is pure noise the operator scrolls past (compact-feed pass). */
  if (!output.trim()) return null;
  const lines = output.split("\n");
  const overflow = lines.length > budget || output.length > PREVIEW_CHARS;
  const shown = all ? output : lines.slice(0, budget).join("\n").slice(0, PREVIEW_CHARS);
  /* stderr keeps a thin danger left-edge so the failing stream stays scannable
     without wrapping the whole block in its own bordered card. */
  const edge = tone === "err" ? "border-l-2 border-danger/50 pl-2" : "";
  /* One block, one copy control (issue #698). The highlighted body is a
     `CodeBlock`, which brings its own control at the same top-right anchor — a
     second one here landed on top of it and left the lower one unreachable, and
     `MESSAGE_ACTION`'s opacity-70 made that collision permanent instead of
     hover-only. So the control is delegated with this block's label, and the
     block copies `output` rather than `shown`: they are the same string in this
     branch (`all` is true), but the full-output guarantee should not rest on
     the reader noticing that. */
  const embedded = all && lang ? lang : null;
  const copy = copyLabel ?? tr("tools.copyOutput");
  return (
    <div className="group/out relative mt-1.5">
      {label}
      {embedded ? (
        <CodeBlock code={output} lang={embedded} copyLabel={copy} />
      ) : (
        /* TZ-UI.md stage 1: no inner scroll region on the phone — a capped
           `max-h` + `overflow-auto` over pre-wrapped text is a nested scroll
           trap for the finger; the 8-line budget already bounds the height. */
        <pre className={`max-w-full whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-[12px] text-secondary ${isMobile ? "" : "max-h-[420px] overflow-auto "}${ACTION_GUTTER} ${edge}`}>
          {shown}
        </pre>
      )}
      {embedded ? null : (
        <CopyButton
          text={output}
          label={copy}
          /* Issue #698: was `opacity-0` on desktop and a permanent 60% overlay
             on a coarse pointer, over an 8px gutter that a 44px button dwarfed. */
          className={`absolute right-[6px] ${MESSAGE_ACTION} group-hover/out:opacity-100 ${heading ? "top-5" : "top-[6px]"}`}
        />
      )}
      {overflow ? (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [@media(pointer:coarse)]:min-h-11"
        >
          {all ? (
            <>
              {tr("common.collapse")} <ChevronUp className="h-3 w-3" aria-hidden />
            </>
          ) : (
            (isMobile ? tr("mobile2.feed.showAllLines", { count: lines.length }) : (showAllLabel ?? tr("tools.showOutput"))) +
            (truncated ? " · " + tr("render.truncated") : "")
          )}
        </button>
      ) : truncated ? (
        <div className="mt-1 text-[11px] text-muted">{tr("render.truncated")}</div>
      ) : null}
    </div>
  );
}
