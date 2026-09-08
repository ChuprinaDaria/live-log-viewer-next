"use client";

import { Info, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { KeepAwakeMenuRow } from "@/components/KeepAwakeControl";
import { SoundToggle } from "@/components/SoundToggle";
import { useLocale } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { MobileSheetRow } from "./MobileSheet";
import { useMobileNavStore, type MobileScreenKind } from "./mobileNav";

/*
 * The tab bar's own roots (TZ-UI.md pages): settings assembled from the rows
 * the board menu used to hide, and an honest one-sentence screen for each page
 * that is not built yet. Nothing here pretends: no counters, no skeletons.
 */

export interface MobileRootContext {
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
  /** Whether this surface can show the host sheet (a project board can, the overview cannot). */
  hostSheet: boolean;
  hostTrailing?: ReactNode;
  /** The live room: the seat's conversation screen, composed by the dashboard.
      Present only when the seat is live and its transcript is here. */
  orchestratorRoom?: ReactNode;
  /** The seat's own reading, for the honest empty state. */
  seatShape?: "invitation" | "seat";
  /** Overview only: no project, so no seat. */
  onPickProject?: () => void;
}

export function renderMobileRootScreen(kind: MobileScreenKind, ctx: MobileRootContext): ReactNode | null {
  switch (kind) {
    case "settings": return <MobileSettingsScreen ctx={ctx} />;
    case "orchestrator": return ctx.orchestratorRoom ?? <MobileChatEmptyScreen ctx={ctx} />;
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

const ACTION = "inline-flex min-h-11 items-center rounded-control border border-accent px-4 text-body font-semibold text-accent active:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

/** The Чат tab with no room to show: no project (overview), no seat yet, or a
    seat that is not ready to talk. One sentence, one button, nothing else. */
function MobileChatEmptyScreen({ ctx }: { ctx: MobileRootContext }) {
  const { t } = useLocale();
  const nav = useMobileNavStore();
  const view = ctx.onPickProject
    ? { sentence: t("mobile2.chat.pickProject"), action: t("mobile2.chat.pickProjectAction"), run: ctx.onPickProject }
    : ctx.seatShape === "invitation"
      ? { sentence: t("mobile2.chat.seatVacant"), action: t("mobile2.chat.seatCreate"), run: () => nav.openSheet("rotate") }
      : { sentence: t("mobile2.chat.seatBusy"), action: t("mobile2.chat.openOrchestrator"), run: () => nav.openSheet("seat") };
  return (
    <MobileShell screen="orchestrator" title={<MobileBarTitle>{t("mobile2.board.orchestrator")}</MobileBarTitle>} host={ctx.host} renderSheet={ctx.renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center" data-mobile2-chat-empty>
        <p className="max-w-[280px] text-body leading-relaxed text-secondary">{view.sentence}</p>
        <button type="button" className={ACTION} onClick={view.run}>{view.action}</button>
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
