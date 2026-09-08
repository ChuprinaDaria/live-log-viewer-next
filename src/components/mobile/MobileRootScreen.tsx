"use client";

import { Building2, Info, MessagesSquare, Server, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { KeepAwakeMenuRow } from "@/components/KeepAwakeControl";
import { SoundToggle } from "@/components/SoundToggle";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { MobileHqRoom } from "./MobileHqRoom";
import { MobileFirmsScreen } from "./MobileFirmsScreen";
import { MobileMcpScreen } from "./MobileMcpScreen";
import { AutoBalanceToggle } from "./AutoBalanceToggle";
import { MobileChannelsScreen } from "./MobileChannelsScreen";
import { MobileMachinesScreen } from "./MobileMachinesScreen";
import { MobilePermissionsScreen } from "./MobilePermissionsScreen";
import { MobileRolesScreen } from "./MobileRolesScreen";
import { MobileSecretsScreen } from "./MobileSecretsScreen";
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
    case "secrets": return <MobileSecretsScreen host={ctx.host} renderSheet={ctx.renderSheet} />;
    case "roles": return <MobileRolesScreen host={ctx.host} renderSheet={ctx.renderSheet} />;
    case "firms": return <MobileFirmsScreen host={ctx.host} renderSheet={ctx.renderSheet} />;
    case "permissions": return <MobilePermissionsScreen host={ctx.host} renderSheet={ctx.renderSheet} />;
    case "channels": return <MobileChannelsScreen host={ctx.host} renderSheet={ctx.renderSheet} />;
    case "machines": return <MobileMachinesScreen host={ctx.host} renderSheet={ctx.renderSheet} />;
    case "mcp": return <MobileMcpScreen host={ctx.host} renderSheet={ctx.renderSheet} />;
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
        {/* The configuration console's own pages: the role catalog and the org
            layer, both edited through fleetctl rather than beside it. */}
        <div className={card}>
          <MobileSheetRow icon={<Server className="h-[18px] w-[18px]" aria-hidden />} label={t("machines.title")} attrs={{ "data-mobile2-go": "machines" }} onSelect={() => nav.push({ kind: "machines" })} />
          <MobileSheetRow icon={<SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />} label={t("roles.title")} attrs={{ "data-mobile2-go": "roles" }} onSelect={() => nav.push({ kind: "roles" })} />
          <MobileSheetRow icon={<Building2 className="h-[18px] w-[18px]" aria-hidden />} label={t("firms.title")} attrs={{ "data-mobile2-go": "firms" }} onSelect={() => nav.push({ kind: "firms" })} />
          <MobileSheetRow icon={<ShieldCheck className="h-[18px] w-[18px]" aria-hidden />} label={t("perms.title")} attrs={{ "data-mobile2-go": "permissions" }} onSelect={() => nav.push({ kind: "permissions" })} />
          <MobileSheetRow icon={<MessagesSquare className="h-[18px] w-[18px]" aria-hidden />} label={t("channels.title")} attrs={{ "data-mobile2-go": "channels" }} onSelect={() => nav.push({ kind: "channels" })} />
        </div>
        <div className={card}>
          <div className="flex min-h-11 items-center gap-2 px-4">
            <span className="min-w-0 flex-1 text-body font-semibold text-primary">{t("mobile2.menu.sound")}</span>
            <SoundToggle />
          </div>
          <div className="px-2.5"><KeepAwakeMenuRow /></div>
        </div>
        {/* Leaving an exhausted account is a thing that happens TO a running
            conversation, so it lives beside the other switches rather than
            hidden in an accounts screen the phone does not have. */}
        <div className={card}>
          <AutoBalanceToggle engine="claude" />
          <AutoBalanceToggle engine="codex" />
        </div>
      </div>
    </MobileShell>
  );
}

