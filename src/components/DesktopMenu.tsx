"use client";

import { Archive, Blocks, Building2, KeyRound, Menu, Radio, Server, ShieldCheck, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useLocale, type MessageKey } from "@/lib/i18n";

import { renderMobileRootScreen } from "./mobile/MobileRootScreen";
import { SuppressMobileTabs } from "./mobile/MobileShell";

/*
 * The desktop header's missing menu.
 *
 * Everything TZ-UI asked for was built behind the mobile shell, which switches
 * in under 640 px. On a wide window the pages existed and had no door: the
 * operator saw the board and no way to secrets, MCP, permissions or machines.
 *
 * So a door, and nothing else. The board keeps its layout, its header keeps
 * its row; one button opens a list, a choice opens that screen over the board
 * and Esc closes it. The screens are the same ones the phone renders —
 * `renderMobileRootScreen`, unchanged — with their tab bar suppressed, because
 * a second navigation inside a panel is not navigation.
 */

type MenuKind = "secrets" | "mcp" | "machines" | "permissions" | "roles" | "firms" | "channels" | "archive";

const GROUPS: { title: MessageKey; items: { kind: MenuKind; label: MessageKey; Icon: typeof KeyRound }[] }[] = [
  { title: "settings.work", items: [
    { kind: "firms", label: "firms.title", Icon: Building2 },
    { kind: "roles", label: "roles.title", Icon: UserRound },
    { kind: "archive", label: "archive.title", Icon: Archive },
  ] },
  { title: "settings.access", items: [
    { kind: "secrets", label: "mobile2.tabs.secrets", Icon: KeyRound },
    { kind: "permissions", label: "perms.title", Icon: ShieldCheck },
    { kind: "mcp", label: "mobile2.tabs.mcp", Icon: Blocks },
    { kind: "channels", label: "channels.title", Icon: Radio },
    { kind: "machines", label: "machines.title", Icon: Server },
  ] },
];

export function DesktopMenu() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState<MenuKind | null>(null);

  useEffect(() => {
    if (!open && !screen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      /* One Esc closes one thing: the panel first, then the list. */
      if (screen) setScreen(null);
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, screen]);

  return (
    <>
      <button
        type="button"
        data-desktop-menu
        aria-label={t("mobile2.tabs.aria")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-quiet hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Menu className="h-4 w-4" aria-hidden />
      </button>

      {open ? (
        <>
          {/* Click-away sits under the list and over everything else. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="menu"
            className="fixed left-3 top-11 z-50 flex w-52 flex-col gap-0.5 rounded-surface border border-border bg-card max-h-[calc(100dvh-4rem)] overflow-y-auto p-1.5"
          >
            {GROUPS.map((group) => (
              <div key={group.title} role="group" aria-label={t(group.title)}>
                <p className="px-2.5 pb-1 pt-2 text-caption font-semibold text-muted">{t(group.title)}</p>
                {group.items.map(({ kind, label, Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    onClick={() => { setScreen(kind); setOpen(false); }}
                    className="flex min-h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[12.5px] text-secondary hover:bg-quiet hover:text-primary"
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">{t(label)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {screen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={() => setScreen(null)}>
          {/* The screens were drawn for a narrow column; a panel keeps them
              that shape instead of stretching every row across the monitor. */}
          <div
            className="flex h-full w-full max-w-[560px] flex-col border-l border-border bg-canvas"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-10 shrink-0 items-center justify-end border-b border-border bg-card px-2">
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setScreen(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-muted hover:bg-quiet hover:text-primary"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <SuppressMobileTabs>
                {renderMobileRootScreen(screen, { host: null, hostSheet: false, files: [] })}
              </SuppressMobileTabs>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
