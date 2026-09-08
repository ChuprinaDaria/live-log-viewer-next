"use client";

import { useLayoutEffect } from "react";

import { caretAtEnd, clampHeight, shouldPin } from "@/lib/composerScroll";

export interface AutosizePinnedOptions {
  /** Maximum field height in pixels; beyond it the field scrolls internally. */
  maxPx: number;
  /** Minimum field height in pixels (a multi-line default before any text). */
  minPx?: number;
  /** Budget of the surrounding form, including context, attachments and tools. */
  containerMaxPx?: number;
  /** True while a live dictation drives the field: pin to the newest words on
      every update regardless of the (readOnly) caret position. */
  pinned: boolean;
}

/**
 * Grows a textarea to fit its content up to `maxPx`, then pins the scroll to
 * the newest text so live dictation and end-of-field typing never scroll the
 * latest words out of view — while leaving the scroll untouched when the caret
 * is parked mid-text for editing. Re-measures on every `value` change (covers
 * restored drafts, dictation inserts, and typing).
 *
 * The shared seam behind every composer surface (`useComposer` for the pane /
 * draft / bulk / task-create composers, and the task edit field directly), so
 * the grow-and-pin behavior is identical everywhere the mic lives.
 */
export function useAutosizePinned(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  { maxPx, minPx = 0, containerMaxPx, pinned }: AutosizePinnedOptions,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const form = containerMaxPx === undefined ? null : el.closest("form");
    let chrome = 0;
    const measure = () => {
      const prevTop = el.scrollTop;
      const atEnd = caretAtEnd(el.selectionStart, el.selectionEnd, el.value.length);
      el.style.height = "0px";
      // Measure every row around the collapsed field. A context badge or a
      // staged attachment is real chrome too; a fixed tools-only allowance
      // pushes Send below the form's bottom when the keyboard is closed.
      chrome = form?.scrollHeight ?? 0;
      const ceiling = form && containerMaxPx !== undefined
        ? Math.min(maxPx, Math.max(44, containerMaxPx - chrome)) : maxPx;
      el.style.height = clampHeight(el.scrollHeight, ceiling, minPx) + "px";
      el.scrollTop = shouldPin({ pinned, caretAtEnd: atEnd }) ? el.scrollHeight : prevTop;
    };
    measure();
    // A panel resize changes line wrapping without changing the draft. Observe
    // width only: our own height writes must not start a resize feedback loop.
    let width = el.getBoundingClientRect().width;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const next = el.getBoundingClientRect().width;
      const nextChrome = form ? form.scrollHeight - el.offsetHeight : 0;
      if (next === width && nextChrome === chrome) return;
      width = next;
      measure();
    });
    observer?.observe(el);
    if (form) observer?.observe(form);
    return () => observer?.disconnect();
  }, [ref, value, maxPx, minPx, containerMaxPx, pinned]);
}
