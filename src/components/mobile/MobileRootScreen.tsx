"use client";

import { Info, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { KeepAwakeMenuRow } from "@/components/KeepAwakeControl";
import { SoundToggle } from "@/components/SoundToggle";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { MobileHqRoom } from "./MobileHqRoom";
import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { MobileSheetRow } from "./MobileSheet";
import { useMobileNavStore, type MobileScreenKind } from "./mobileNav";

/*
 * The tab bar's own roots (TZ-UI.md pages): the HQ room, settings assembled
 * from the rows the board menu used to hide, and an honest one-sentence
 * screen for each page that is not built yet. Nothing here pretends: no
 * counters, no skeletons.
 */

export interface MobileRootContext {
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
  /** Whether this surface can show the host sheet (a project board can, the overview cannot). */
  hostSheet: boolean;
  hostTrailing?: ReactNode;
  /** Every scanned file: the HQ seat's transcript lives outside any project. */
  files: readonly FileEntry[];
}

export function renderMobileRootScreen(kind: MobileScreenKind, ctx: MobileRootContext): ReactNode | null {
  switch (kind) {
    case "settings": return <MobileSettingsScreen ctx={ctx} />;
    case "orchestrator": return <MobileHqRoom files={ctx.files} host={ctx.host} renderSheet={ctx.renderSheet} />;
    case "secrets": return <MobileNotBuiltScreen kind={kind} ctx={ctx} />;
    case "mcp": return <MobileNotBuiltScreen kind={kind} ctx={ctx} />;
    default: return null;
  }
}

function MobileSettingsScreen({ ctx }: { ctx: MobileRootContext }) {
  const { t } = useLocale();
  const nav = useMobileNavStore();
  const card = "flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card";
  return (
    <MobileShell screen="settings" title={<MobileBarTitle>{t("mobile2.settings.title")}</MobileBarTitle>} host={ctx.host} renderSheet={ctx.renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-settings>
        <div className={card}>
          <MobileSheetRow icon={<UserRound className="h-[18px] w-[18px]" aria-hidden />} label={t("mobile2.menu.accounts")} attrs={{ "data-mobile2-go": "accounts" }} onSelect={() => nav.push({ kind: "accounts" })} />
          {ctx.hostSheet ? (
            <MobileSheetRow icon={<Info className="h-[18px] w-[18px]" aria-hidden />} label={t("mobile2.menu.host")} trailing={ctx.hostTrailing} attrs={{ "data-mobile2-open": "host" }} onSelect={() => nav.openSheet("host")} />
          ) : null}
        </div>
        <div className={card}>
          <div className="flex min-h-11 items-center gap-2 px-4">
            <span className="min-w-0 flex-1 text-body font-semibold text-primary">{t("mobile2.menu.sound")}</span>
            <SoundToggle />
          </div>
          <div className="px-2.5"><KeepAwakeMenuRow /></div>
        </div>
      </div>
    </MobileShell>
  );
}

function MobileNotBuiltScreen({ kind, ctx }: { kind: "secrets" | "mcp"; ctx: MobileRootContext }) {
  const { t } = useLocale();
  const title = t(kind === "secrets" ? "mobile2.tabs.secrets" : "mobile2.tabs.mcp");
  const sentence = t(kind === "secrets" ? "mobile2.soon.secrets" : "mobile2.soon.mcp");
  return (
    <MobileShell screen={kind} title={<MobileBarTitle>{title}</MobileBarTitle>} host={ctx.host} renderSheet={ctx.renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center" data-mobile2-not-built={kind}>
        <p className="max-w-[280px] text-body leading-relaxed text-secondary">{sentence}</p>
      </div>
    </MobileShell>
  );
}
