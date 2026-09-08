"use client";

import { useLocale } from "@/lib/i18n";
import { LaunchForm } from "@/components/machines/LaunchForm";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";

/*
 * Start an agent: on which machine, in which project, under which account.
 *
 * The form itself lives in `LaunchForm` (`src/components/machines/`), shared
 * verbatim with the desktop console column — this screen is only the phone's
 * shell around it: the tab bar chrome and nothing of its own.
 */

export function MobileMachinesScreen({
  host, renderSheet, initialProject,
}: {
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
  initialProject?: string;
}) {
  const { t } = useLocale();
  return (
    <MobileShell screen="machines" title={<MobileBarTitle>{t("machines.title")}</MobileBarTitle>} host={host} renderSheet={renderSheet}>
      <div className="settings-scroll flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-machines>
        <LaunchForm initialProject={initialProject} />
      </div>
    </MobileShell>
  );
}
