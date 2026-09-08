/*
 * The facts about the HQ signature that both sides of the wire need: the
 * default name, the size ceiling, the four accepted types.
 *
 * They live apart from `hqIdentity.ts` because that module reaches for
 * `node:fs` at import time — pulling it into a client component would drag the
 * filesystem into the browser bundle. A second copy of the constants in the
 * hook was the alternative, and two copies of a limit drift.
 */

export const HQ_DEFAULT_NAME = "Дітріх";

export const HQ_NAME_MAX = 40;

export const HQ_AVATAR_MAX_BYTES = 3 * 1024 * 1024;

export type HqAvatarMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** The inert raster formats the room embeds. SVG is excluded for the same
    reason /api/image excludes it: served from the app origin it would run
    embedded same-origin script. */
export const HQ_AVATAR_MIMES: readonly HqAvatarMime[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** The `accept` attribute of the file picker, from the same list. */
export const HQ_AVATAR_ACCEPT = HQ_AVATAR_MIMES.join(",");
