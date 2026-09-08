"use client";

import { Blocks, Building2, KeyRound, Radio, Server, ShieldCheck, UserRound } from "lucide-react";

import { useLocale, type MessageKey } from "@/lib/i18n";

import { renderMobileRootScreen } from "./mobile/MobileRootScreen";
import { SuppressMobileTabs } from "./mobile/MobileShell";
import { topScreen, useMobileNav, useMobileNavStore } from "./mobile/mobileNav";

/*
 * The console pages, on a desktop.
 *
 * Everything TZ-UI asked for was built for a phone: the shell switches at
 * 640 px, so on a wide window the operator saw the old board and none of it —
 * no secrets sharing, no MCP page, no permissions, no machines. The screens
 * themselves are not phone-specific; only their navigation was, and a tab bar
 * across the bottom of a 27-inch monitor is not navigation.
 *
 * So the same screens, with the destinations down the side instead. Nothing is
 * reimplemented here: `renderMobileRootScreen` is the same function the phone
 * calls, and `SuppressMobileTabs` stops each screen drawing a second
 * navigation under the first.
 *
 * The board is deliberately absent. It has a desktop layout of its own — a
 * rail, a scene, a conversation column — and squeezing it in here would mean
 * two boards that drift. This surface is for the pages that had no desktop at
 * all.
 */

/* Every destination here is a bare screen — no id, no params — so the nav
   store takes it as-is and the union stays honest. */
type ConsoleKind = "secrets" | "mcp" | "machines" | "permissions" | "roles" | "firms" | "channels";

const DESTINATIONS: { kind: ConsoleKind; label: MessageKey; Icon: typeof KeyRound }[] = [
  { kind: "secrets", label: "mobile2.tabs.secrets", Icon: KeyRound },
  { kind: "mcp", label: "mobile2.tabs.mcp", Icon: Blocks },
  { kind: "machines", label: "machines.title", Icon: Server },
  { kind: "permissions", label: "perms.title", Icon: ShieldCheck },
  { kind: "roles", label: "roles.title", Icon: UserRound },
  { kind: "firms", label: "firms.title", Icon: Building2 },
  { kind: "channels", label: "channels.title", Icon: Radio },
];

export function DesktopConsole() {
  const { t } = useLocale();
  const nav = useMobileNavStore();
  const state = useMobileNav();
  const current = topScreen(state).kind;
  /* The board is what the nav store starts on, and it draws nothing here.
     Landing on the first real destination is better than an empty column
     asking the operator to guess that they must click something. */
  const active: ConsoleKind = DESTINATIONS.find((row) => row.kind === current)?.kind ?? "secrets";

  return (
    <SuppressMobileTabs>
      <div data-desktop-console className="flex h-full min-h-0 w-full">
        <nav
          aria-label={t("mobile2.tabs.aria")}
          className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-border bg-card p-2"
        >
          {DESTINATIONS.map(({ kind, label, Icon }) => {
            const selected = kind === active;
            return (
              <button
                key={kind}
                type="button"
                aria-current={selected ? "page" : undefined}
                onClick={() => nav.replace({ kind })}
                className={`flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 text-left text-label ${
                  selected ? "bg-accent text-white" : "text-secondary hover:bg-quiet"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{t(label)}</span>
              </button>
            );
          })}
        </nav>

        {/* The screens were drawn for a 390 px column; letting them span a wide
            monitor would stretch every row into a line the eye cannot track
            back. Capped and left-aligned instead. */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="mx-auto flex h-full max-w-[720px] flex-col">
            {renderMobileRootScreen(active, {
              host: null,
              hostSheet: false,
              files: [],
            })}
          </div>
        </div>
      </div>
    </SuppressMobileTabs>
  );
}
