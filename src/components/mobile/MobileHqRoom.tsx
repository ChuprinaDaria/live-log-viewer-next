"use client";

import type { ReactNode } from "react";

import { Loader2 } from "@/components/icons";
import { OrchestratorConversation } from "@/components/orchestrator/OrchestratorConversation";
import { useKeyboardInset } from "@/hooks/useComposer";
import { useLocale } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { hqFileOf, useHqSeat } from "./hqSeat";

/*
 * The Чат tab: the fleet's standing orchestrator, the same room on the
 * overview and inside every project. Live → its conversation (the seat's own
 * feed and composer, composed exactly as the desktop dock composes them) under
 * whatever strip the surface passes. Not live → one sentence and one button.
 */

const ACTION = "inline-flex min-h-11 items-center rounded-control border border-accent px-4 text-body font-semibold text-accent active:bg-accent-soft disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export function MobileHqRoom({ files, host, renderSheet, strip }: {
  /** Every scanned file, whatever project the surface shows. */
  files: readonly FileEntry[];
  host: MobileShellHost | null;
  renderSheet?: SheetRenderer;
  /** The surface's agents strip, when it has one. */
  strip?: ReactNode;
}) {
  const { t } = useLocale();
  const hq = useHqSeat();
  const kbInset = useKeyboardInset();
  const file = hqFileOf(files, hq.status);
  const seated = Boolean(hq.status?.seat && hq.status.exists);
  const waiting = hq.starting || Boolean(hq.status?.pending) || (seated && !file);

  let body: ReactNode;
  if (file) {
    body = (
      <>
        {strip}
        <OrchestratorConversation file={file} projectName={t("mobile2.hq.name")} />
      </>
    );
  } else if (hq.status === null && !hq.failed) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 text-body text-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("common.loading")}
      </div>
    );
  } else if (waiting) {
    body = (
      <div className="flex flex-1 items-center justify-center gap-2 text-body text-secondary" data-mobile2-hq="starting">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("mobile2.hq.starting")}
      </div>
    );
  } else {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center" data-mobile2-hq="vacant">
        <p className="max-w-[280px] text-body leading-relaxed text-secondary">{t(hq.failed ? "mobile2.hq.unreachable" : "mobile2.hq.vacant")}</p>
        {hq.failed ? null : (
          <button type="button" className={ACTION} onClick={() => void hq.start()} disabled={hq.starting}>
            {t("mobile2.hq.start")}
          </button>
        )}
        {hq.error ? <p className="max-w-[280px] text-caption text-danger">{hq.error}</p> : null}
      </div>
    );
  }

  return (
    <MobileShell screen="orchestrator" title={<MobileBarTitle>{t("mobile2.hq.name")}</MobileBarTitle>} host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" style={kbInset > 0 ? { paddingBottom: kbInset } : undefined}>
        {body}
      </div>
    </MobileShell>
  );
}
