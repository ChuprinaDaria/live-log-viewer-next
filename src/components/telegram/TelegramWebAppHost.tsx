"use client";

import { useEffect } from "react";

import { telegramShellVariables, telegramThemeAttributes, telegramWebApp } from "./telegramWebApp";

/*
 * Adapts the shell to Telegram's embedded browser, and does nothing anywhere
 * else (see `telegramWebApp.ts` for why each step is needed).
 *
 * Renders no markup: it writes CSS custom properties and two attributes on the
 * document element, which the shell's own CSS already reads with a fallback.
 * So an ordinary browser — where `window.Telegram` does not exist — takes not
 * one different code path and paints exactly what it painted before.
 */
export function TelegramWebAppHost() {
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    /* The bridge is a third-party script, so its execution and this effect are
       not ordered against each other. Inside Telegram the global appears
       within a tick or two; outside it never appears, and the retries end. A
       bounded wait is the difference between "the adapter lost a race" and
       "the app opened at half height". */
    let attempts = 0;
    const attach = () => {
      if (cancelled) return;
      const app = telegramWebApp();
      if (app) { stop = adapt(app); return; }
      if (attempts++ < 20) window.setTimeout(attach, 100);
    };
    attach();
    return () => { cancelled = true; stop?.(); };
  }, []);

  return null;
}

/** Wires one live WebApp to the document, and returns the detach. */
function adapt(app: NonNullable<ReturnType<typeof telegramWebApp>>): () => void {
    const root = document.documentElement;
    /* A hook for anything that must differ inside Telegram, and evidence in
       the DOM that the adapter ran. */
    root.dataset.tg = "1";

    const applyViewport = () => {
      for (const [name, value] of Object.entries(telegramShellVariables(app))) {
        root.style.setProperty(name, value);
      }
    };
    const applyTheme = () => {
      const { theme, background } = telegramThemeAttributes(app);
      /* The scheme is adopted, the palette is not: the token set switches on
         this attribute and its contrast is tested, where a bot-supplied colour
         pair is not. */
      if (theme) root.dataset.theme = theme;
      if (background) root.style.setProperty("--tg-page-background", background);
    };

    /* Order matters: ready() tells the client the app is up, expand() takes
       the full sheet height instead of the half-height it opens at, and only
       then is `viewportStableHeight` the number worth reading. */
    app.ready?.();
    app.expand?.();
    /* Without this a vertical drag inside any list is read as the
       swipe-to-close gesture and the app disappears mid-scroll. */
    app.disableVerticalSwipes?.();
    applyViewport();
    applyTheme();

    /* The viewport moves whenever the keyboard, the client's header or a
       rotation changes it, and the theme moves when the operator switches
       Telegram's own. Both are events rather than a one-time reading. */
    const viewportEvents = ["viewportChanged", "safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged"];
    for (const event of viewportEvents) app.onEvent?.(event, applyViewport);
    app.onEvent?.("themeChanged", applyTheme);
    return () => {
      for (const event of viewportEvents) app.offEvent?.(event, applyViewport);
      app.offEvent?.("themeChanged", applyTheme);
    };
}
