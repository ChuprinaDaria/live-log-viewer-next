"use client";

import { LayoutGrid, MessageSquare, Settings } from "lucide-react";

import { useKeyboardInset } from "@/hooks/useComposer";
import { useLocale, type MessageKey } from "@/lib/i18n";

import { topScreen, useMobileNav, useMobileNavStore, type MobileScreen } from "./mobileNav";

/*
 * The app's sections as three daily destinations (chat, sessions and settings). Rendered by every shell at
 * the bottom of the stack; a tap is the store's sibling switch, so no history
 * grows. Deeper screens (a conversation, a pipeline) own the whole height and
 * the bar's ‹ is the way back; while the keyboard is up the bar yields to the
 * composer.
 */

const TABS: { key: string; screen: MobileScreen; label: MessageKey; Icon: typeof MessageSquare }[] = [
  { key: "chat", screen: { kind: "orchestrator" }, label: "mobile2.tabs.chat", Icon: MessageSquare },
  { key: "sessions", screen: { kind: "board" }, label: "mobile2.tabs.sessions", Icon: LayoutGrid },
  { key: "settings", screen: { kind: "settings" }, label: "mobile2.tabs.settings", Icon: Settings },
];

export function MobileTabBar() {
  const { t } = useLocale();
  const nav = useMobileNavStore();
  const state = useMobileNav();
  const keyboard = useKeyboardInset();
  if (state.stack.length !== 1 || keyboard > 0) return null;
  const current = topScreen(state).kind;
  return (
    <nav data-mobile2-tabs aria-label={t("mobile2.tabs.aria")} className="grid shrink-0 grid-cols-3 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
      {TABS.map(({ key, screen, label, Icon }) => {
        const active = screen.kind === current;
        return (
          <button
            key={key}
            type="button"
            data-mobile2-tab={key}
            aria-current={active ? "page" : undefined}
            className="relative flex h-14 min-w-0 flex-col items-center justify-center gap-[3px] transition-colors active:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
            onClick={() => { if (!active) nav.replace(screen, "switch"); }}
          >
            {active ? <span aria-hidden className="absolute inset-x-0 top-0 mx-auto h-[2px] w-6 rounded-full bg-accent" /> : null}
            <Icon aria-hidden className={`h-5 w-5 ${active ? "text-accent" : "text-muted"}`} />
            <span className={`whitespace-nowrap px-0.5 text-[10px] leading-3 tracking-[-0.01em] ${active ? "font-bold text-accent" : "font-medium text-muted"}`}>
              {t(label)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
