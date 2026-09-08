import { expect, test } from "bun:test";

import { telegramShellVariables, telegramThemeAttributes, type TelegramWebApp } from "@/components/telegram/telegramWebApp";

/* The container maths, which is the whole fix: the height that stays rather
   than the one the viewport units claim, and both insets that eat the same
   edge added together. An older client reports fewer of these, and a missing
   number must leave the variable unset so the CSS fallback wins — never write
   a zero height and collapse the app. */

test("the shell is sized by the height that stays, with the client's own insets", () => {
  const app: TelegramWebApp = {
    viewportHeight: 700,
    viewportStableHeight: 640,
    safeAreaInset: { top: 47, bottom: 34 },
    contentSafeAreaInset: { top: 56, bottom: 0 },
  };
  expect(telegramShellVariables(app)).toEqual({
    "--app-height": "640px",
    /* 47 of notch plus 56 of Telegram's own header: both are above the app. */
    "--tg-safe-top": "103px",
    "--tg-safe-bottom": "34px",
  });
});

test("a client that reports no stable height falls back to the live one, and one that reports neither writes no height at all", () => {
  expect(telegramShellVariables({ viewportHeight: 580 })["--app-height"]).toBe("580px");
  const older = telegramShellVariables({});
  expect(older["--app-height"]).toBeUndefined();
  expect(older["--tg-safe-top"]).toBe("0px");
});

test("a zero or negative height is not a measurement and never becomes one", () => {
  expect(telegramShellVariables({ viewportStableHeight: 0, viewportHeight: 0 })["--app-height"]).toBeUndefined();
  expect(telegramShellVariables({ safeAreaInset: { top: -12 } })["--tg-safe-top"]).toBe("0px");
});

test("the scheme is adopted and the palette is not, and a junk colour is refused", () => {
  expect(telegramThemeAttributes({ colorScheme: "dark", themeParams: { bg_color: "#17212B", text_color: "#ffffff" } }))
    .toEqual({ theme: "dark", background: "#17212B" });
  expect(telegramThemeAttributes({ colorScheme: "light", themeParams: { bg_color: "javascript:alert(1)" } }))
    .toEqual({ theme: "light", background: null });
  expect(telegramThemeAttributes({})).toEqual({ theme: null, background: null });
});
