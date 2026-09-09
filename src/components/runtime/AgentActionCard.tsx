"use client";

import { ChevronDown, MessageCircle, Bot } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import type { agentAction } from "@/lib/mcp/agentAction";
import type { ToolEvent } from "../feed/parse";
import type { ReactNode } from "react";
import { hhmm } from "../utils";

export function AgentActionCard({ action, event, name, links, payload, error, metadata }: {
  action: NonNullable<ReturnType<typeof agentAction>>;
  event: ToolEvent;
  name: string;
  links: ReactNode;
  payload: string;
  error: string;
  metadata?: ReactNode;
}) {
  const { t } = useLocale();
  const Icon = action.kind === "spawn" ? Bot : MessageCircle;
  const state = action.state === "failed" ? "error" : action.state === "pending" ? "pending"
    : action.state === "delivered" || action.state === "created" ? "success" : "unknown";
  return (
    <article data-testid="mcp-call-card" data-state={state} data-agent-action={action.kind} data-delivery={action.state} className="my-2 min-w-0 rounded-control border border-border bg-sunken">
      {state === "pending" ? <div data-testid="mcp-call-progress" className="h-0.5 animate-pulse bg-accent/30" /> : null}
      <details className="group/action min-w-0">
        <summary className="flex min-h-11 cursor-pointer list-none items-start gap-2 px-3 py-2 text-body [&::-webkit-details-marker]:hidden">
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 -rotate-90 text-muted group-open/action:rotate-0" aria-hidden />
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block break-words font-semibold text-primary">{t(action.kind === "spawn" ? "agentAction.spawn" : "agentAction.message", { name })}</span>
            <span className={`block text-caption ${state === "error" ? "text-danger" : "text-secondary"}`}>
              {t(`agentAction.${action.state}`)}
            </span>
          </span>
          <span className="shrink-0 text-caption text-muted">{hhmm(event.ts)}</span>
        </summary>
        <div className="flex min-w-0 flex-col gap-2 border-t border-border px-3 py-3">
          <div className="flex flex-wrap gap-2">{links}</div>
          <p className="text-caption text-muted">{t("agentAction.recorded")}</p>
          <div data-agent-action-text className="max-h-80 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-body leading-relaxed text-primary">{action.text || t("agentAction.noText")}</div>
          {event.mcp?.textTruncated ? <p role="status" className="text-caption text-secondary">{t("agentAction.truncated")}</p> : null}
          <details>
            <summary className="min-h-9 cursor-pointer py-2 text-caption text-muted">{t("agentAction.technical")}</summary>
            {metadata}
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-caption text-secondary">{payload}</pre>
          </details>
        </div>
      </details>
      {error ? <p role="alert" className="px-3 pb-2 text-body text-danger">{error}</p> : null}
    </article>
  );
}
