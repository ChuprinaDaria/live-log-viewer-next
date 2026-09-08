"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

import { createPortal } from "react-dom";

import { ChevronDown, Loader2, Play, Square } from "@/components/icons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLocale } from "@/lib/i18n";
import type { UseComposerReturn } from "@/hooks/useComposer";
import { prewarmLiveToken } from "@/hooks/useDictation";

import type { AgentMention } from "./composer/agentMentions";
import { useAgentMentions } from "./composer/useAgentMentions";

import { recallHistory } from "./composerHistory";
import { Hint } from "./Hint";
import { ImagePickerButton, ImagePreviewStrip } from "./imageAttachments";
import { MicButtonView } from "./MicButton";

export interface SendMenuAction {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  tone?: "ok";
  onSelect: () => void;
}

/**
 * The phone's ONE inline control (docs/design/mobile-v2/README.md §2 rule 8):
 * the composer box's send slot. There is no status row and no live-tail pill
 * under it any more — the slot itself says what the one thing to do now is.
 *
 *  - `send`    the ordinary submit;
 *  - `stop`    the agent is working and the operator has typed nothing, so the
 *              useful action is stopping it — the first keystroke flips the
 *              slot back to `send` and the message queues behind the turn;
 *  - `queue`   the runtime is offline: the text is taken and delivered on
 *              reconnect, and the slot says so instead of pretending it sent;
 *  - `respawn` the agent was killed, so nothing can be sent until one is back.
 */
export type ComposerSlotKind = "send" | "stop" | "queue" | "respawn";

export interface ComposerSendSlot {
  kind: ComposerSlotKind;
  /** Accessible name of the slot in its current kind. */
  label: string;
  /** Visible on the wide kinds (`queue`, `respawn`); the icon kinds stay square. */
  text?: string;
  /** Runs the non-send kinds. `send` and `queue` submit the form instead. */
  onAct?: () => void;
  busy?: boolean;
}

/**
 * Which kind the slot takes. Killed outranks offline: a queued message needs
 * an agent to arrive at, so a killed conversation offers the respawn that gets
 * one rather than a queue that cannot drain. Below those, a running turn with
 * an empty draft is the Stop case, and everything else is an ordinary send.
 */
export function composerSlotKind({ killed, offline, working, hasDraft }: {
  killed: boolean;
  offline: boolean;
  working: boolean;
  hasDraft: boolean;
}): ComposerSlotKind {
  if (killed) return "respawn";
  if (offline) return "queue";
  if (working && !hasDraft) return "stop";
  return "send";
}

export interface ComposerBarProps {
  composer: UseComposerReturn;
  mentionAgents?: readonly AgentMention[];
  onMentionChoose?: (agent: AgentMention) => string;
  placeholder: string;
  textareaAriaLabel: string;
  imageAriaLabel: string;
  /** The left side of the bottom row: the mode/target chip and any adjacent
      controls (interrupt/compact on a live pane, a plain label on a draft).
      On the phone this is the FIRST cell of the composer box's tools row —
      the model/reasoning chip inside the box, not a row beneath it (§2 rule 8). */
  leftSlot: ReactNode;
  /** What the phone's send slot is right now (§2 rule 8). Absent, or on the
      desktop, the slot is the ordinary send button it has always been. */
  sendSlot?: ComposerSendSlot | null;
  /** Send-button accessible label, one for each dictation state. */
  sendLabelIdle: string;
  sendLabelRecording: string;
  /** Tooltip while recording (the pane composer explains stop-and-send). */
  sendTitleRecording?: string;
  /** Idle-state send-button appearance: the pane composer paints itself with
      the accent classes, the draft with an inline engine tint. */
  sendIdleClassName: string;
  sendIdleStyle?: CSSProperties;
  sendMenuLabel?: string;
  sendMenuActions?: SendMenuAction[];
  /** The phone composer moves the image picker behind the leftSlot toggle;
      this hides the inline one so the picker exists only once. */
  showImage?: boolean;
  /** Overrides both the inline picker and the paste/drop target — the task
      composer routes attachments to its durable, upload-on-add store instead of
      the in-memory `useImageAttachments`. When set, the in-memory preview strip
      is suppressed (the caller renders its own from staged refs).

      It receives EVERY file the operator hands over, images or not, so whatever
      is on the other end owes each one an answer: staged, or refused by name.
      The name says `files` for that reason — it was `onImageFiles`, and the
      task composer behind it went on screening for images alone and losing the
      rest (#1224). Both sides now screen through `@/lib/attachmentIntake`. */
  onAttachFiles?: (files: File[]) => void;
  imageDisabled?: boolean;
  imageDisabledReason?: string;
  /** When set, Send is disabled with this tooltip and no submit is attempted
      (issue #247 §5: a dead host blocks sends so no rejected receipts stack).
      The reason also renders as inline status text (issue #499): a phone has
      no hover, so a tooltip-only explanation leaves the blocked action mute. */
  sendDisabledReason?: string;
  /** Recovery route for a blocked Send (issue #499): rendered as a Re-check
      action beside the inline reason (e.g. force a runtime snapshot refresh
      while the host is unresolved/offline). */
  onSendBlockedRecover?: () => void;
  /** A caller-owned immutable generation can supply the payload while the
      editable textarea and image tray are empty. */
  sendPayloadAvailable?: boolean;
  /** Durable runtime receipt chips for the last sends on this target (issue
      #25). Rendered under the status line; absent while the runtime bus is off,
      so the composer is unchanged on the landing-disabled path. */
  receipts?: ReactNode;
  /** Previously submitted messages, newest first — queued ones ahead of sent
      ones (issue #561). ArrowUp/ArrowDown recall them while the composer is
      empty; absent (the default) leaves the arrows as plain caret movement. */
  history?: readonly string[];
  voiceControl?: ReactNode;
  voicePanel?: ReactNode;
}

const NO_HISTORY: readonly string[] = [];

function SendMenu({ label, actions, onClose, anchor }: { label: string; actions: SendMenuAction[]; onClose: () => void; anchor: RefObject<HTMLSpanElement | null> }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const trigger = anchor.current;
    const menu = rootRef.current;
    const win = trigger?.ownerDocument.defaultView;
    if (!trigger || !menu || !win) return;
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const viewport = win.visualViewport;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const bottom = top + (viewport?.height ?? win.innerHeight) - 16;
      menu.style.maxHeight = `${Math.max(44, bottom - top)}px`;
      menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, win.innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(top, Math.min(rect.top - menu.offsetHeight - 6, bottom - menu.offsetHeight))}px`;
    };
    position();
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    win.addEventListener("resize", position);
    win.addEventListener("scroll", position, true);
    win.visualViewport?.addEventListener("resize", position);
    return () => {
      win.removeEventListener("resize", position);
      win.removeEventListener("scroll", position, true);
      win.visualViewport?.removeEventListener("resize", position);
    };
  }, [anchor]);

  useEffect(() => {
    const doc = anchor.current?.ownerDocument;
    if (!doc) return;
    const away = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose();
    };
    doc.addEventListener("pointerdown", away);
    return () => doc.removeEventListener("pointerdown", away);
  }, [anchor, onClose]);
  const doc = anchor.current?.ownerDocument;
  if (!doc) return null;

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          anchor.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus({ preventScroll: true });
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
          const current = buttons.indexOf(doc.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next]?.focus({ preventScroll: true });
        }
      }}
      className="fixed z-[200] w-[220px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-surface border border-border bg-raised p-1.5"
    >
      {/* Menu group-label: sentence-case label recipe (design doc §3.6). */}
      <div className="px-2 pb-1 pt-1.5 text-label font-semibold text-secondary">
        {label}
      </div>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onClick={() => {
            action.onSelect();
            onClose();
          }}
          className={`flex min-h-11 w-full items-start gap-2 rounded-control px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${
            action.tone === "ok" ? "hover:bg-success/10" : "hover:bg-sunken"
          }`}
        >
          <Play className={`mt-[2px] h-3.5 w-3.5 shrink-0 ${action.tone === "ok" ? "text-success" : "text-muted"}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-ui font-semibold text-primary">{action.label}</span>
            {action.description ? <span className="block text-caption leading-snug text-muted">{action.description}</span> : null}
          </span>
        </button>
      ))}
    </div>, doc.body,
  );
}

/**
 * The bottom-row cluster shared by the pane composer and the spawn draft: the
 * auto-growing textarea, the mic button, the image picker, the send button,
 * the pending-image strip, and the status line. Presentational only — all
 * state lives in `useComposer`, handed in as `composer`.
 */
export function ComposerBar({
  composer,
  mentionAgents,
  onMentionChoose,
  placeholder,
  textareaAriaLabel,
  imageAriaLabel,
  leftSlot,
  sendSlot = null,
  sendLabelIdle,
  sendLabelRecording,
  sendTitleRecording,
  sendIdleClassName,
  sendIdleStyle,
  sendMenuLabel,
  sendMenuActions = [],
  showImage = true,
  onAttachFiles,
  imageDisabled = false,
  imageDisabledReason,
  sendDisabledReason,
  onSendBlockedRecover,
  sendPayloadAvailable = false,
  receipts,
  history = NO_HISTORY,
  voiceControl,
  voicePanel,
}: ComposerBarProps) {
  const {
    displayText,
    inputRef,
    attachInput,
    dictation,
    setText,
    attachments,
    voiceSending,
    insertSpoken,
    stopAndSend,
    submit,
    fieldsDisabled,
    canSend,
    dictationRecording,
    busy,
    status,
    dictationBusy,
    attachmentsBlocked,
  } = composer;
  const mentions = useAgentMentions(displayText, inputRef, setText, mentionAgents, onMentionChoose);
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [sendMenuOpen, setSendMenuOpen] = useState(false);
  const sendAnchor = useRef<HTMLSpanElement>(null);
  /* Empty-composer history recall (issue #561). -1 is "the operator's own
     draft"; any index at or above 0 is a recalled message, and typing drops
     straight back out of recall so navigation never fights editing. */
  const [historyIndex, setHistoryIndex] = useState(-1);
  const optionsRowId = useId();
  const keyboardHintId = useId();
  // Every surface gives the text its full width, with everyday actions below.
  const hasSendMenu = sendMenuActions.length > 0;
  const imageSendBlocked = imageDisabled && attachments.images.length > 0;
  /* An attachment still decoding (or one that failed to read) blocks Send with a
     visible reason, so no image is silently dropped mid-read (issue #419). */
  const attachmentBlockedReason = attachments.hasReading
    ? t(attachments.hasFiles ? "attach.blockedReading" : "img.blockedReading")
    : attachments.hasError
      ? t(attachments.hasFiles ? "attach.blockedFailed" : "img.blockedFailed")
      : undefined;
  const sendBlocked = Boolean(sendDisabledReason);
  const effectiveCanSend = canSend || (sendPayloadAvailable && !fieldsDisabled && !dictationBusy && !attachmentsBlocked);
  const sendDisabled = sendBlocked || (!effectiveCanSend && !hasSendMenu) || imageSendBlocked;
  /* Composer action buttons in the phone's composer unit are REAL 44 px boxes
     holding a smaller glyph (§2 rule 7). The old recipe — a 32 px control with
     a pseudo-element hit area — measures 32 px to anything that reads a
     bounding box, which is what the capture's 44 px gate does; desktop keeps
     the compact p-2. */
  const iconBtn = isMobile ? "h-11 w-11" : "p-2";
  /* MicButton's anchored idle face is that same 32 px visual, and MicButton is
     not this lane's file — so the unit sizes the button from its own wrapper.
     While recording the mic is already a 44 px meter and cancel pair, and
     forcing a square on those would crush the meter. */
  const micHit = "inline-flex shrink-0 [&>span>button]:h-11 [&>span>button]:w-11";

  /* The phone's send slot (§2 rule 8). `stop` and `respawn` act instead of
     submitting, so they stay live exactly where an ordinary send is not: Stop
     with an empty field, Respawn with a dead host that blocks every send. */
  const slotKind: ComposerSlotKind = isMobile && sendSlot && !dictationRecording ? sendSlot.kind : "send";
  const slotActs = slotKind === "stop" || slotKind === "respawn";
  const slotWide = slotKind === "queue" || slotKind === "respawn";
  const slotBusy = Boolean(sendSlot?.busy);
  const slotLabel = slotKind === "send"
    ? (sendBlocked ? sendDisabledReason! : dictationRecording ? sendLabelRecording : sendLabelIdle)
    : sendSlot!.label;

  const sendVisual = slotBusy || busy || voiceSending
    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    : slotKind === "stop"
      ? <Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
      : <Play className="h-4 w-4" aria-hidden />;

  /* The phone paints a 32 px visual inside the 44 px target; the desktop button
     is the control itself, unchanged. Stop takes the primary fill so it never
     reads as another accent send; a slot that cannot act takes the muted one. */
  const slotSubmits = slotKind === "send" || slotKind === "queue";
  const slotFill = slotKind === "stop"
    ? "border-primary bg-primary text-card"
    : slotSubmits && !effectiveCanSend && !hasSendMenu
      ? "border-strong bg-strong text-white"
      : `text-white ${sendIdleClassName}`;
  const sendControl = (
    <span
      ref={sendAnchor}
      className="relative inline-flex shrink-0"
      onContextMenu={(event) => {
        if (!hasSendMenu || dictationRecording || slotActs) return;
        event.preventDefault();
        setSendMenuOpen((open) => !open);
      }}
    >
      <Hint label={slotKind === "send" && !sendBlocked && dictationRecording ? (sendTitleRecording ?? sendLabelRecording) : slotLabel} align="right">
        <button
          type={slotActs || (dictationRecording && !sendBlocked) ? "button" : "submit"}
          data-mobile2-send={isMobile ? slotKind : undefined}
          onClick={
            slotActs
              ? () => sendSlot?.onAct?.()
              : dictationRecording && !sendBlocked
                ? () => void stopAndSend()
                : (event) => {
                    if (sendBlocked || !effectiveCanSend) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    /* A submitted recall is a new message, not a position in
                       the list: the next ArrowUp starts from the top again. */
                    setHistoryIndex(-1);
                  }
          }
          disabled={slotActs ? slotBusy : sendDisabled}
          aria-disabled={slotActs ? slotBusy : sendBlocked || !effectiveCanSend || imageSendBlocked}
          aria-label={slotLabel}
          /* The caller's engine tint paints the CONTROL. On the phone the
             control is the 32 px visual inside the 44 px target, so the tint
             goes on that span and never on the whole block. */
          style={isMobile || dictationRecording || slotKind !== "send" ? undefined : sendIdleStyle}
          className={
            isMobile
              ? `ml-auto flex h-11 shrink-0 items-center justify-center rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 aria-disabled:opacity-40 ${slotWide ? "min-w-11 px-0.5" : "w-11"}`
              : `inline-flex shrink-0 items-center justify-center rounded-control border text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 aria-disabled:opacity-40 ${iconBtn} ${
                  dictationRecording ? "border-danger bg-danger hover:opacity-90" : sendIdleClassName
                }`
          }
        >
          {isMobile ? (
            <span
              style={slotSubmits && !dictationRecording && effectiveCanSend ? sendIdleStyle : undefined}
              className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-control border text-ui font-semibold ${slotWide ? "px-2.5" : ""} ${
                dictationRecording ? "border-danger bg-danger text-white" : slotFill
              }`}
            >
              {sendVisual}
              {slotWide ? sendSlot?.text : null}
            </span>
          ) : (
            sendVisual
          )}
        </button>
      </Hint>
      {hasSendMenu && !slotActs && !dictationRecording ? (
        <button
          type="button"
          aria-label={sendMenuLabel ?? t("composer.moreSendOptions")}
          aria-haspopup="menu"
          aria-expanded={sendMenuOpen}
          onClick={() => setSendMenuOpen((open) => !open)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-muted hover:bg-sunken focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      {sendMenuOpen && hasSendMenu ? (
        <SendMenu anchor={sendAnchor} label={sendMenuLabel ?? t("composer.moreSendOptions")} actions={sendMenuActions} onClose={() => setSendMenuOpen(false)} />
      ) : null}
    </span>
  );

  const micControl = (
    <MicButtonView {...dictation} busy={voiceSending || sendBlocked} onText={insertSpoken} anchored />
  );
  const picker = showImage ? (
    <Hint label={imageAriaLabel}>
      <ImagePickerButton
        acceptFiles={attachments.acceptsFiles}
        ariaLabel={imageAriaLabel}
        className={`inline-flex shrink-0 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${iconBtn}`}
        onFiles={onAttachFiles ?? attachments.addFiles}
        /* An unavailable image capability no longer closes the picker
           outright where files are deliverable (#1224) — a document
           needs no such capability; a picked image is refused by name. */
        disabled={imageDisabled && !attachments.acceptsFiles}
        disabledReason={imageDisabledReason}
      />
    </Hint>
  ) : null;

  /* The phone's tools row, INSIDE the box under the field: chip, attach,
      dictate, send slot (§2 rule 8, the §4.2 sketch). Recording takes the chip
      and the picker off the row so the meter has the width it needs. */
  const unitTools = (
    <div data-mobile2-tools className="flex min-h-11 shrink-0 flex-wrap items-center gap-0.5">
      {dictationRecording ? null : leftSlot}
      {dictationRecording ? null : picker}
      {voiceControl}
      {dictationRecording ? micControl : <span className={micHit}>{micControl}</span>}
      {sendControl}
    </div>
  );

  return (
    <>
      {voicePanel}
      {mentions.popup}
      {/* On phones, staged images are the composer's first bounded row. The
          desktop tray keeps its established position below the controls. */}
      {isMobile && !onAttachFiles ? (
        <ImagePreviewStrip
          attachments={attachments.attachments}
          onRemove={attachments.remove}
          onRetry={attachments.retry}
          onClearAll={attachments.clearAll}
        />
      ) : null}
      {/* The field and its actions form one bounded unit on every surface. */}
      <div
        data-mobile2-composer={isMobile ? slotKind : undefined}
        className={
          isMobile
            ? "flex shrink-0 flex-col rounded-surface border border-border bg-sunken px-2 pb-0.5 pt-1 focus-within:border-accent/55"
            : "flex flex-col gap-1 rounded-control border border-border bg-sunken p-2 focus-within:ring-2 focus-within:ring-accent/40"
        }
      >
        <textarea
          /* The callback ref keeps `inputRef` current and re-attaches the IME
             mirror when the field remounts — which it does whenever this bar
             moves between the card and the floating PiP document. */
          ref={attachInput}
          {...mentions.aria}
          value={displayText}
          rows={2}
          aria-describedby={isMobile ? undefined : keyboardHintId}
          readOnly={Boolean(dictation.liveText)}
          onChange={(event) => {
            setHistoryIndex(-1);
            setText(event.target.value);
            mentions.updateCaret(event.target, true);
          }}
          /* Focusing the composer often precedes a dictation; minting the live
             token here hides its round-trip from the eventual mic press. */
          onFocus={() => { prewarmLiveToken(); mentions.onFocus(); }}
          onBlur={mentions.onBlur}
          onSelect={(event) => mentions.updateCaret(event.currentTarget)}
          onPaste={(event) => {
            /* EVERY pasted file, not only images (#1224). `kind` separates a
               file from the plain text of an ordinary paste, which must keep
               its default behaviour. */
            const picks = Array.from(event.clipboardData.items)
              .filter((entry) => entry.kind !== "string")
              .map((entry) => entry.getAsFile())
              .filter((entry): entry is File => entry !== null);
            if (!picks.length) return;
            event.preventDefault();
            (onAttachFiles ?? attachments.addFiles)(picks);
          }}
          onDragOver={(event) => {
            /* A file drop only fires when its dragover was cancelled — without
               this the browser navigates to the dropped file instead of
               attaching it, which is what a dragged PDF used to do. ANY file
               drag is claimed, with no per-type exception: the tray is what
               decides what it can hold, and it decides identically for a paste,
               a drop and the picker (#1224). A drag waved away here would be a
               file lost with only a cursor to explain it. */
            const items = Array.from(event.dataTransfer.items).filter((item) => item.kind === "file");
            if (!items.length) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer.files);
            if (!files.length) return;
            event.preventDefault();
            event.stopPropagation();
            (onAttachFiles ?? attachments.addFiles)(files);
          }}
          onKeyDown={(event) => {
            if (mentions.onKeyDown(event)) return;
            /* ArrowUp/ArrowDown recall previously queued and sent messages
               while the composer is empty (issue #561) — the shell convention.
               Once recall is active the arrows keep walking the list, so a
               recalled multi-line message can be stepped past; the first edit
               releases the arrows back to caret movement. */
            if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !dictationRecording && !event.metaKey && !event.ctrlKey && !event.altKey) {
              const recall = recallHistory(historyIndex, event.key, history, displayText.length === 0);
              if (recall) {
                event.preventDefault();
                setHistoryIndex(recall.index);
                setText(recall.text);
                requestAnimationFrame(() => {
                  const el = inputRef.current;
                  if (!el) return;
                  el.setSelectionRange(el.value.length, el.value.length);
                });
                return;
              }
            }
            /* Desktop Enter sends; mobile Enter and Shift+Enter add a line.
               Ctrl/Cmd+Enter also sends from a hardware keyboard on mobile. Composition guard keeps IME confirms from sending.
               Enter honors the exact admission gate of the Send button (PR
               #431): a blocked send — dead host, an attachment still decoding
               or failed, images disabled with images staged — must do nothing
               rather than submit and silently drop an attachment. During
               recording Enter means stop-and-send — a plain submit would fire
               off just the typed prefix and leave the recording running. */
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && (!isMobile || event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              if (sendBlocked || !effectiveCanSend || imageSendBlocked) return;
              setHistoryIndex(-1);
              if (dictation.phase === "rec") void stopAndSend();
              else void submit();
            }
          }}
          placeholder={placeholder}
          aria-label={textareaAriaLabel}
          disabled={fieldsDisabled}
          data-mobile2-field={isMobile ? true : undefined}
          className={
            isMobile
              /* 16 px so iOS never zooms the page to reach the field (§5). */
              ? "block w-full min-w-0 resize-none overflow-y-auto bg-transparent px-1 py-1 text-[16px] leading-[22px] text-primary placeholder:text-muted focus-visible:outline-none disabled:opacity-60"
              : "block w-full min-w-0 resize-none overflow-y-auto bg-transparent py-1 text-ui leading-[20px] text-primary placeholder:text-muted focus-visible:outline-none disabled:opacity-60"
          }
        />
        {isMobile ? unitTools : (
          <div id={optionsRowId} data-testid="composer-options-row" className="flex flex-wrap items-center gap-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{leftSlot}</div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {picker}
              {voiceControl}
              {micControl}
              {sendControl}
            </div>
          </div>
        )}
      </div>
      {!isMobile ? <p id={keyboardHintId} className="text-caption text-muted">{t("composer.keyboardHint")}</p> : null}
      {/* The task composer renders its own durable-ref strip; the in-memory one
          stays for the pane/draft composers that still upload at send time. */}
      {!isMobile && !onAttachFiles ? (
        <ImagePreviewStrip
          attachments={attachments.attachments}
          onRemove={attachments.remove}
          onRetry={attachments.retry}
          onClearAll={attachments.clearAll}
        />
      ) : null}
      {/* A blocked Send explains itself inline (issue #499): the tooltip is
          unreachable on a phone, so the reason renders as visible status text
          with the caller's recovery route beside it. */}
      {sendBlocked ? (
        <span
          data-testid="composer-send-blocked"
          role="status"
          aria-live="polite"
          className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption font-semibold text-warning"
        >
          <span className="min-w-0">{sendDisabledReason}</span>
          {onSendBlockedRecover ? (
            <button
              type="button"
              onClick={onSendBlockedRecover}
              className={isMobile
                ? "group inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control text-caption font-semibold text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                : "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-control border border-border bg-card px-2 text-caption font-semibold text-primary hover:border-accent/45 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"}
            >
              {isMobile ? (
                <span className="inline-flex h-8 items-center rounded-control border border-border bg-card px-2 group-hover:border-accent/45">
                  {t("deadHost.recheck")}
                </span>
              ) : t("deadHost.recheck")}
            </button>
          ) : null}
        </span>
      ) : null}
      {/* A decoding/failed attachment blocks Send — say why, and never silently
          drop the image (issue #419). Suppressed while a host-death reason
          already occupies the send tooltip. */}
      {!onAttachFiles && !sendBlocked && attachmentBlockedReason ? (
        <span role="status" aria-live="polite" className="text-caption font-semibold text-warning">{attachmentBlockedReason}</span>
      ) : null}
      {/* The status is the refusal surface (#1224), so it holds MORE than one
          line: a refusal names every file it rejected, one reason per line, and
          `truncate` on a single line hid all but the first few characters —
          the mechanism that exists to stop a silent discard, silenced. Lines
          break where the message puts them (`whitespace-pre-line`), long
          filenames wrap instead of overflowing, and the whole thing is capped
          and scrollable so a big batch can never grow the composer off the
          screen. */}
      {status ? (
        <span
          data-testid="composer-status"
          role="status"
          aria-live={status.kind === "err" ? "assertive" : "polite"}
          className={`block max-h-24 overflow-y-auto whitespace-pre-line break-words text-caption font-semibold ${status.kind === "ok" ? "text-success" : status.kind === "info" ? "text-warning" : "text-danger"}`}
        >
          {status.text}
        </span>
      ) : null}
      {imageDisabled && imageDisabledReason ? (
        <span role="status" className="text-caption font-semibold text-muted">{imageDisabledReason}</span>
      ) : null}
      {receipts ? <div className="flex flex-wrap gap-1.5">{receipts}</div> : null}
    </>
  );
}
