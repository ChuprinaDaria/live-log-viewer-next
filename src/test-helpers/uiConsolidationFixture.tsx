// Browser-only fixture. It mounts production components against intercepted,
// synthetic API responses; no Viewer server or runtime host is started.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { useMentionBindings } from "@/components/composer/useMentionBindings";
import { ComposerBar } from "@/components/ComposerBar";
import { useComposer, useKeyboardInset } from "@/hooks/useComposer";
import { renderMobileRootScreen } from "@/components/mobile/MobileRootScreen";
import {
  getMobileNav,
  topScreen,
  useMobileNav,
} from "@/components/mobile/mobileNav";
import { McpCallCard } from "@/components/runtime/McpCallCard";
import { setLocale } from "@/lib/i18n";
import { publishConversationAvailability } from "@/lib/mcp/availability";
import type { FileEntry } from "@/lib/types";
import type { ToolEvent } from "@/components/feed/parse";
import { SelectedContextBadge } from "@/components/SelectedContextBadge";

setLocale("uk");
const screen = new URLSearchParams(location.search).get("screen") ?? "settings";
getMobileNav().replace({ kind: "settings" });

const agents = [
  {
    id: "conversation_worker_a",
    name: "Оглядач",
    project: "Проєкт А",
    role: "reviewer",
    engine: "claude",
  },
  {
    id: "conversation_worker_b",
    name: "Оглядач",
    project: "Проєкт Б",
    role: "reviewer",
    engine: "codex",
  },
];
publishConversationAvailability(
  new Set(agents.map((a) => a.id)),
  agents.map((agent) => ({
    conversationId: agent.id,
    title: agent.name,
    path: `/${agent.id}.jsonl`,
  })) as FileEntry[],
);
const action = {
  kind: "tool",
  id: "action-a",
  ts: "2026-01-01T10:00:00Z",
  srcCall: 1,
  family: "mcp",
  tool: "send_message",
  icon: "spawn",
  summary: "Send",
  chips: [],
  status: "ok",
  statusLabel: "ok",
  outputPreview: "",
  outputTruncated: false,
  open: false,
  mcp: {
    serverName: "viewer",
    toolName: "send_message",
    args: {
      conversationId: agents[0].id,
      text: "Перевір форму на телефоні.\n\nКнопки мають залишатися доступними, а список — прокручуватися до останнього рядка.",
    },
    result: { outcome: "queued", conversationId: agents[0].id },
  },
} as ToolEvent;

function Chat() {
  const [sent, setSent] = useState<string[]>([]);
  const keyboard = useKeyboardInset();
  const mentions = useMentionBindings("conversation_hq_fixture");
  const composer = useComposer({
    initialText: () => "",
    persistText: () => {},
    submit: () => {
      setSent((was) => [...was, mentions.resolve(composer.textRef.current)]);
      composer.setText("");
    },
    holdInputWhileBusy: false,
  });
  return (
    <main
      className="app-shell flex flex-col"
      style={{ paddingBottom: keyboard }}
    >
      <header className="flex h-[52px] shrink-0 items-center border-b border-border px-4 font-semibold">
        Чат HQ
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="py-3 text-body">
          Перевіряю форми, прокрутку і кнопки. Звіт буде в цій розмові.
        </p>
        <McpCallCard event={action} />
        {sent.map((text, i) => (
          <p key={i} data-sent className="whitespace-pre-wrap break-words">
            {text}
          </p>
        ))}
      </div>
      <form
        data-testid="bounded-mobile-composer"
        className="flex max-h-[min(38dvh,20rem)] shrink-0 flex-col gap-1.5 overflow-y-auto md:max-h-none border-t border-border bg-card px-2.5 py-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          composer.submit();
        }}
      >
        <SelectedContextBadge
          reference={{
            state: "selected",
            conversationId: "conversation_worker_a",
            project: "Проєкт А",
            label:
              "Огляд інтерфейсу: поля, багаторядкове введення, кнопки й акордеон повідомлень",
          }}
        />
        <ComposerBar
          sendMenuActions={[
            { id: "later", label: "Надіслати пізніше", onSelect: () => {} },
          ]}
          composer={composer}
          mentionAgents={agents}
          onMentionChoose={mentions.choose}
          placeholder="Повідомлення…"
          textareaAriaLabel="Повідомлення"
          imageAriaLabel="Додати файл"
          leftSlot={
            <button
              type="button"
              className="min-h-11 min-w-0 flex-1 rounded-full bg-accent-soft px-2 text-caption font-semibold text-accent"
            >
              6-Astra · high
            </button>
          }
          voiceControl={
            <button
              type="button"
              aria-label="Голосовий чат"
              className="h-11 w-11 shrink-0 rounded-control border border-border"
            >
              ◉
            </button>
          }
          sendLabelIdle="Надіслати"
          sendLabelRecording="Зупинити й надіслати"
          sendIdleClassName="bg-accent"
        />
      </form>
    </main>
  );
}
function Settings() {
  const state = useMobileNav();
  return (
    <main className="app-shell flex flex-col">
      {renderMobileRootScreen(topScreen(state).kind, {
        files: [],
        host: null,
        hostSheet: false,
      })}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  screen === "chat" ? <Chat /> : <Settings />,
);
