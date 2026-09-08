"use client";

import type { Engine } from "@/lib/types";

import { Command, MessageCircle, Sparkle } from "../icons";

/* Mobile v2 (#1439, lane 4): the engine mark is the only avatar left on the
   phone. Proper nouns, so no locale entry. Shared by the turn header and the
   top-level tool rows (TZ-UI.md stage 1) so both answer "who writes this"
   with the same glyph. */
export const ENGINE_LABEL: Record<"codex" | "claude" | "openclaw", string> = {
  claude: "Claude",
  codex: "Codex",
  openclaw: "OpenClaw",
};

const ENGINE_ICON = { claude: Sparkle, codex: Command, openclaw: MessageCircle } as const;
const ENGINE_TONE = { claude: "text-claude", codex: "text-codex", openclaw: "text-openclaw" } as const;

export function engineLabel(engine: Engine | null): string | null {
  return engine && engine !== "shell" ? ENGINE_LABEL[engine] : null;
}

/** The engine's glyph in the engine's identity color — the single spot of
    color the stage-1 header allows (teal/coral clear only the 3:1 non-text
    floor, so the color never lands on text). Renders nothing for shell logs. */
export function EngineGlyph({ engine, className = "h-4 w-4" }: { engine: Engine | null; className?: string }) {
  if (!engine || engine === "shell") return null;
  const Icon = ENGINE_ICON[engine];
  return <Icon className={`${className} shrink-0 ${ENGINE_TONE[engine]}`} aria-hidden />;
}
