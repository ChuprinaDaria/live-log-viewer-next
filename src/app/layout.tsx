import type { Metadata, Viewport } from "next";
import Script from "next/script";

import { TelegramWebAppHost } from "@/components/telegram/TelegramWebAppHost";

import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Log Viewer",
  description: "Agent Log Viewer for Codex and Claude agent logs",
  /* Поставлена на домашній екран, дошка відкривається без адресної смуги
     Safari — тих ~85 px із 844, на які бюджети висоти в `chatBudget.ts` і так
     не розраховують. `appleWebApp` — те, чим iOS вмикає цей режим; сам
     маніфест лежить у `manifest.ts` поруч. */
  appleWebApp: {
    capable: true,
    title: "Флот",
    statusBarStyle: "default",
  },
};

/* The on-screen keyboard shrinks the layout instead of covering it, so the
   composer of the focused pane stays visible while typing on a phone. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Telegram's Mini App bridge. It must come from their domain — the
            script talks to the client through a channel a bundled copy does
            not have — and it must run before the app mounts, because the host
            below reads `window.Telegram.WebApp` on its first effect. Outside
            Telegram it defines the global and nothing else happens. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      {/* The height is a variable, not `100dvh`: inside Telegram's browser the
          viewport units report the whole screen while the app occupies part of
          it, so the shell would run off the bottom. Everywhere else the
          variable is unset and the fallback is the value this always used. */}
      <body className="app-shell overflow-hidden font-sans text-[15px]">
        <TelegramWebAppHost />
        {children}
      </body>
    </html>
  );
}
