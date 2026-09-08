/*
 * Telegram Mini App container support.
 *
 * The dashboard is opened from a bot button, inside Telegram's embedded
 * browser, and three of that browser's facts break an ordinary phone layout:
 *
 *  - `100vh`/`100dvh` LIE. The webview reports the full screen while the app
 *    is shown at half height until it is expanded, and the visible area moves
 *    as the keyboard and the header do. `viewportStableHeight` is the height
 *    that actually stays, so the shell is sized from it.
 *  - `env(safe-area-inset-*)` is 0 there. The notch and the gesture bar are
 *    still in the way, and Telegram reports them itself in `safeAreaInset` and
 *    `contentSafeAreaInset`.
 *  - a vertical swipe inside a list closes the whole app unless it is disabled.
 *
 * Everything here is behind the presence of `window.Telegram.WebApp`, so an
 * ordinary browser sees no change at all: the variables stay unset and the CSS
 * falls back to what it always used.
 */

export interface TelegramInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** The slice of Telegram's API this app uses. Every member is optional: the
    Mini App API grew over versions, and an older client simply has fewer of
    them — a missing method is a feature that is not there, never an error. */
export interface TelegramWebApp {
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  onEvent?: (event: string, handler: () => void) => void;
  offEvent?: (event: string, handler: () => void) => void;
  viewportStableHeight?: number;
  viewportHeight?: number;
  colorScheme?: "light" | "dark";
  themeParams?: Record<string, string | undefined>;
  safeAreaInset?: TelegramInsets;
  contentSafeAreaInset?: TelegramInsets;
}

export function telegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const app = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return app && typeof app === "object" ? app : null;
}

const px = (value: number): string => `${Math.max(0, Math.round(value))}px`;

/** A number Telegram actually reported, or null. Older clients answer with
    `undefined`, and a zero height is a client that has not measured yet. */
function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function inset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The CSS custom properties the shell reads, computed from one reading of the
 * Telegram API.
 *
 * `--app-height` is the height that stays put; the safe insets are the sum of
 * the window's own inset (notch, gesture bar) and the inset Telegram's own
 * chrome adds on top of it, because both eat the same edge.
 */
export function telegramShellVariables(app: TelegramWebApp): Record<string, string> {
  const height = positive(app.viewportStableHeight) ?? positive(app.viewportHeight);
  const safe = app.safeAreaInset ?? {};
  const content = app.contentSafeAreaInset ?? {};
  return {
    ...(height === null ? {} : { "--app-height": px(height) }),
    "--tg-safe-top": px(inset(safe.top) + inset(content.top)),
    "--tg-safe-bottom": px(inset(safe.bottom) + inset(content.bottom)),
  };
}

/**
 * Telegram's own colours, for the surfaces OUTSIDE this app's token system.
 *
 * The palette itself is not adopted: the token set is contrast-checked, and a
 * bot theme can pair colours this app would fail on. What is adopted is the
 * SCHEME — light or dark — which the tokens already switch on, plus the page
 * background, so the strip behind a short page matches the client instead of
 * flashing white in a dark chat.
 */
export function telegramThemeAttributes(app: TelegramWebApp): { theme: "light" | "dark" | null; background: string | null } {
  const scheme = app.colorScheme === "dark" ? "dark" : app.colorScheme === "light" ? "light" : null;
  const background = app.themeParams?.bg_color ?? app.themeParams?.secondary_bg_color ?? null;
  return {
    theme: scheme,
    background: typeof background === "string" && /^#[0-9a-f]{3,8}$/i.test(background) ? background : null,
  };
}
