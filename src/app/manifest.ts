import type { MetadataRoute } from "next";

/*
 * Маніфест, щоб дошку можна було поставити на домашній екран телефона.
 *
 * Оператор працює з неї щодня саме з iPhone. У Safari вкладці зверху завжди
 * висить смуга з адресою — близько 85 px із 844, тобто десята частина екрана,
 * і всі бюджети висоти в `chatBudget.ts` рахують екран без неї. Поставлена на
 * домашній екран сторінка відкривається без цієї смуги, і числа стають
 * чесними самі, без переписування.
 *
 * `display: standalone` — саме те, що прибирає хром; iOS додатково хоче
 * `apple-mobile-web-app-capable`, він виставлений у layout. Ярлик відкриває
 * корінь: гейт токена ставить куку на 30 днів, тож повторний вхід не потрібен.
 *
 * Іконок у репозиторії немає навмисно: маска з літерою, намальована як
 * data-URI, не тягне за собою бінарний файл у публічний репозиторій і
 * лишається читабельною в diff.
 */

const ICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">`
  + `<rect width="512" height="512" rx="112" fill="#5a51e0"/>`
  + `<text x="256" y="330" font-family="system-ui,-apple-system,sans-serif" font-size="260"`
  + ` font-weight="700" fill="#ffffff" text-anchor="middle">Ф</text></svg>`,
)}`;

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Флот — дошка оператора",
    short_name: "Флот",
    description: "Пульт, чат з оркестратором і сесії агентів",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f6f8",
    theme_color: "#f6f6f8",
    lang: "uk",
    icons: [
      { src: ICON, sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: ICON, sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
