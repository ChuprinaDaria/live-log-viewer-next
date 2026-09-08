"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useLocale } from "@/lib/i18n";
import { activeMention, insertAgentMention, type AgentMention } from "./agentMentions";

export function useAgentMentions(text: string, input: RefObject<HTMLTextAreaElement | null>, setText: (value: string) => void, agents?: readonly AgentMention[], onChoose?: (agent: AgentMention) => string) {
  const { t } = useLocale();
  const listId = useId();
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selected, setSelected] = useState(0);
  const range = agents && focused && !dismissed && caret >= 0 ? activeMention(text, caret) : null;
  const open = range !== null;
  const query = range?.query.toLocaleLowerCase() ?? "";
  const matches = range ? agents!.filter((agent) => `${agent.name} ${agent.project} ${agent.role} ${agent.id}`.toLocaleLowerCase().includes(query)).slice(0, 30) : [];
  const index = Math.min(selected, Math.max(0, matches.length - 1));
  const menuRef = useRef<HTMLDivElement>(null);

  // The form and the board both clip their overflow. Put the picker beside the
  // field in its own document so it also works in the floating composer.
  useLayoutEffect(() => {
    if (!open || !input.current || !menuRef.current) return;
    const el = input.current;
    const menu = menuRef.current;
    const win = el.ownerDocument.defaultView;
    if (!win) return;
    const position = () => {
      const rect = el.getBoundingClientRect();
      const viewport = win.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? win.innerHeight);
      const availableAbove = rect.top - top - 8;
      const above = availableAbove >= 100;
      menu.style.left = `${Math.max(8, rect.left)}px`;
      menu.style.width = `${Math.max(0, Math.min(rect.width, win.innerWidth - rect.left - 8))}px`;
      menu.style.maxHeight = `${Math.max(44, Math.min(220, above ? availableAbove : bottom - rect.bottom - 8))}px`;
      menu.style.top = above ? "auto" : `${rect.bottom + 4}px`;
      menu.style.bottom = above ? `${win.innerHeight - rect.top + 4}px` : "auto";
    };
    position();
    win.addEventListener("resize", position);
    win.addEventListener("scroll", position, true);
    win.visualViewport?.addEventListener("resize", position);
    return () => {
      win.removeEventListener("resize", position);
      win.removeEventListener("scroll", position, true);
      win.visualViewport?.removeEventListener("resize", position);
    };
  }, [open, text, input]);

  useLayoutEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index, query]);

  const pick = (agent: AgentMention) => {
    if (!range) return;
    const token = onChoose?.(agent);
    const inserted = token
      ? { text: text.slice(0, range.start) + token + " " + text.slice(range.end), caret: range.start + token.length + 1 }
      : insertAgentMention(text, range, agent);
    setText(inserted.text);
    setDismissed(true);
    const el = input.current;
    el?.ownerDocument.defaultView?.requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(inserted.caret, inserted.caret);
    });
  };
  const updateCaret = (el: HTMLTextAreaElement, edited = false) => {
    const next = el.selectionStart === el.selectionEnd ? el.selectionStart : -1;
    // React can emit select after a prevented ArrowDown. That event must not
    // reset the option the operator just chose with the arrow key.
    if (!edited && next === caret) return;
    setCaret(next);
    setSelected(0);
    setDismissed(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!range || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(matches.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0);
      return true;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      // Enter must never send a half-chosen target, including an empty result.
      if (event.key === "Tab" && !matches.length) { setDismissed(true); return false; }
      event.preventDefault();
      if (matches[index]) pick(matches[index]);
      return true;
    }
    return false;
  };

  const popup = range && input.current ? createPortal(
    <div ref={menuRef} id={listId} role="listbox" aria-label={t("composer.mentionAgents")} className="fixed z-[200] overflow-y-auto overscroll-contain rounded-control border border-border bg-card p-1">
      <p className="px-2 py-1 text-caption text-muted">{t("composer.mentionHint")}</p>
      {matches.length ? matches.map((agent, i) => (
        <div
          key={agent.id}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === index}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => pick(agent)}
          className={`cursor-pointer rounded-control px-2 py-2 text-body ${i === index ? "bg-accent-soft text-accent" : "text-primary hover:bg-sunken"}`}
        >
          <span className="block whitespace-normal break-words font-semibold">@{agent.name}</span>
          <span className="block break-all text-caption text-muted">{[agent.project, agent.role, agent.engine, agent.id.slice(-8)].filter(Boolean).join(" · ")}</span>
        </div>
      )) : <p role="status" className="px-2 py-2 text-body text-muted">{t("composer.mentionEmpty")}</p>}
    </div>, input.current.ownerDocument.body,
  ) : null;

  return {
    popup, onKeyDown, updateCaret,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    aria: agents ? {
      "aria-autocomplete": "list" as const,
      "aria-controls": range ? listId : undefined,
      "aria-activedescendant": range && matches.length ? `${listId}-${index}` : undefined,
    } : {},
  };
}
