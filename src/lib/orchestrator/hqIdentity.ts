import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { statePath } from "@/lib/configDir";

import { HQ_AVATAR_MAX_BYTES, HQ_DEFAULT_NAME, HQ_NAME_MAX, type HqAvatarMime } from "./hqIdentityShared";

/*
 * How the standing HQ orchestrator signs itself in its room: a name and,
 * optionally, a picture. The operator sets both from the dashboard, so this is
 * viewer-owned state rather than anything the seat carries — a rotation mints a
 * new conversation, and the signature must outlive it.
 *
 * The bytes live beside the record rather than inside it. A base64 avatar in a
 * JSON file the room reads on every poll would be re-parsed and re-shipped for
 * every render; as a file it is served once and cached by its `updatedAt`.
 */

export interface HqAvatar {
  /** Basename inside the state dir, never a path the caller supplied. */
  file: string;
  mime: HqAvatarMime;
  bytes: number;
  updatedAt: string;
}

export interface HqIdentity {
  name: string;
  avatar: HqAvatar | null;
}

/** The file extension each accepted type is stored under. */
const EXTENSION: Record<HqAvatarMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export class InvalidHqNameError extends Error {
  constructor() {
    super(`name must be 1–${HQ_NAME_MAX} characters`);
    this.name = "InvalidHqNameError";
  }
}

export type HqAvatarRefusal = "type" | "size" | "mismatch";

export class InvalidHqAvatarError extends Error {
  readonly reason: HqAvatarRefusal;
  constructor(reason: HqAvatarRefusal) {
    super(`avatar refused: ${reason}`);
    this.name = "InvalidHqAvatarError";
    this.reason = reason;
  }
}

function identityFile(): string {
  return statePath("hq-identity.json");
}

/** Visible length, counting an emoji or a combining pair as one character —
    `"x".length` would let a 40-glyph name be refused for its code units. */
function visibleLength(value: string): number {
  return [...value].length;
}

function isMime(value: string): value is HqAvatarMime {
  return value in EXTENSION;
}

/** What the bytes actually are, independent of what the caller declared. */
function sniff(data: Buffer): HqAvatarMime | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  const head = data.subarray(0, 6).toString("latin1");
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

function avatarRecord(value: unknown): HqAvatar | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.file !== "string" || typeof record.mime !== "string" || !isMime(record.mime)) return null;
  if (typeof record.bytes !== "number" || !Number.isFinite(record.bytes)) return null;
  if (typeof record.updatedAt !== "string") return null;
  /* The stored basename is compared to the one this module would mint, so a
     hand-edited file can never point the reader outside the state dir. */
  if (record.file !== `hq-avatar.${EXTENSION[record.mime]}`) return null;
  return { file: record.file, mime: record.mime, bytes: record.bytes, updatedAt: record.updatedAt };
}

export function readHqIdentity(): HqIdentity {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(identityFile(), "utf8"));
  } catch {
    return { name: HQ_DEFAULT_NAME, avatar: null };
  }
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : HQ_DEFAULT_NAME;
  const avatar = avatarRecord(record.avatar);
  /* A record whose file is gone (a cleared state dir, a manual delete) is not
     an avatar — the room would ask for bytes nobody has. */
  if (avatar && !fs.existsSync(statePath(avatar.file))) return { name, avatar: null };
  return { name, avatar };
}

function writeIdentity(identity: HqIdentity): void {
  const target = identityFile();
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(identity, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

export function writeHqName(name: string): HqIdentity {
  const trimmed = name.trim();
  const length = visibleLength(trimmed);
  if (length < 1 || length > HQ_NAME_MAX) throw new InvalidHqNameError();
  const next: HqIdentity = { ...readHqIdentity(), name: trimmed };
  writeIdentity(next);
  return next;
}

export function writeHqAvatar(input: { mime: string; data: Buffer }): HqIdentity {
  if (!isMime(input.mime)) throw new InvalidHqAvatarError("type");
  if (input.data.byteLength > HQ_AVATAR_MAX_BYTES) throw new InvalidHqAvatarError("size");
  if (sniff(input.data) !== input.mime) throw new InvalidHqAvatarError("mismatch");

  const current = readHqIdentity();
  const file = `hq-avatar.${EXTENSION[input.mime]}`;
  const target = statePath(file);
  const temp = path.join(path.dirname(target), `.${file}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, input.data, { mode: 0o600 });
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  /* A change of format leaves the old extension behind; drop it so the state
     dir never holds two avatars and `hqAvatarFile` can only mean one. */
  if (current.avatar && current.avatar.file !== file) fs.rmSync(statePath(current.avatar.file), { force: true });

  const next: HqIdentity = {
    name: current.name,
    avatar: { file, mime: input.mime, bytes: input.data.byteLength, updatedAt: new Date().toISOString() },
  };
  writeIdentity(next);
  return next;
}

export function clearHqAvatar(): HqIdentity {
  const current = readHqIdentity();
  if (current.avatar) fs.rmSync(statePath(current.avatar.file), { force: true });
  const next: HqIdentity = { name: current.name, avatar: null };
  writeIdentity(next);
  return next;
}

/** Where the served bytes are, or null when there is nothing to serve. */
export function hqAvatarFile(): { path: string; mime: HqAvatarMime } | null {
  const { avatar } = readHqIdentity();
  if (!avatar) return null;
  const file = statePath(avatar.file);
  return fs.existsSync(file) ? { path: file, mime: avatar.mime } : null;
}
