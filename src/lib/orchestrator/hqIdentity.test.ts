import { afterAll, beforeEach, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* The state dir is pinned BEFORE the module loads: a module that baked its
   path at import time would otherwise write the operator's real state. */
const prev = process.env.LLV_STATE_DIR;
let dir = fs.mkdtempSync(path.join(os.tmpdir(), "llv-hq-identity-"));
process.env.LLV_STATE_DIR = dir;

const {
  clearHqAvatar,
  hqAvatarFile,
  InvalidHqAvatarError,
  InvalidHqNameError,
  readHqIdentity,
  writeHqAvatar,
  writeHqName,
} = await import("./hqIdentity");
const { statePath } = await import("@/lib/configDir");

beforeEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "llv-hq-identity-"));
  process.env.LLV_STATE_DIR = dir;
});

afterAll(() => {
  if (prev === undefined) delete process.env.LLV_STATE_DIR;
  else process.env.LLV_STATE_DIR = prev;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Smallest byte strings that carry each format's real signature. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8)]);
const GIF = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(8)]);
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0x10, 0, 0, 0]), Buffer.from("WEBP", "latin1"), Buffer.alloc(4)]);

test("an absent file reads as the default orchestrator identity", () => {
  expect(readHqIdentity()).toEqual({ name: "Дітріх", avatar: null });
});

test("a name is trimmed and kept, and the file holds it", () => {
  writeHqName("  Гвардія  ");
  expect(readHqIdentity().name).toBe("Гвардія");
  const stored = JSON.parse(fs.readFileSync(statePath("hq-identity.json"), "utf8")) as { name: string };
  expect(stored.name).toBe("Гвардія");
});

test("the identity file is owner-only", () => {
  writeHqName("HQ");
  expect(fs.statSync(statePath("hq-identity.json")).mode & 0o777).toBe(0o600);
});

test("an empty or over-long name is refused", () => {
  expect(() => writeHqName("   ")).toThrow(InvalidHqNameError);
  expect(() => writeHqName("x".repeat(41))).toThrow(InvalidHqNameError);
  expect(() => writeHqName("x".repeat(40))).not.toThrow();
});

test.each([
  ["image/png", PNG, "hq-avatar.png"],
  ["image/jpeg", JPEG, "hq-avatar.jpg"],
  ["image/webp", WEBP, "hq-avatar.webp"],
  ["image/gif", GIF, "hq-avatar.gif"],
] as const)("accepts a real %s and stores it beside the identity", (mime, data, name) => {
  writeHqAvatar({ mime, data });
  const identity = readHqIdentity();
  expect(identity.avatar).toMatchObject({ file: name, mime, bytes: data.byteLength });
  expect(typeof identity.avatar?.updatedAt).toBe("string");
  const file = hqAvatarFile();
  expect(file).toEqual({ path: statePath(name), mime });
  expect(fs.readFileSync(statePath(name))).toEqual(data);
  expect(fs.statSync(statePath(name)).mode & 0o777).toBe(0o600);
});

test("the stored JSON never carries the image bytes", () => {
  writeHqAvatar({ mime: "image/gif", data: GIF });
  const text = fs.readFileSync(statePath("hq-identity.json"), "utf8");
  expect(text).not.toContain(GIF.toString("base64"));
  expect(text).not.toContain("base64");
});

test("a MIME outside the four is refused as a type", () => {
  try {
    writeHqAvatar({ mime: "image/svg+xml", data: PNG });
    throw new Error("expected a refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidHqAvatarError);
    expect((error as InstanceType<typeof InvalidHqAvatarError>).reason).toBe("type");
  }
});

test("bytes that do not match the declared type are refused as a mismatch", () => {
  try {
    writeHqAvatar({ mime: "image/png", data: GIF });
    throw new Error("expected a refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidHqAvatarError);
    expect((error as InstanceType<typeof InvalidHqAvatarError>).reason).toBe("mismatch");
  }
});

test("an avatar over 3 MiB is refused as a size", () => {
  const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
  try {
    writeHqAvatar({ mime: "image/png", data: big });
    throw new Error("expected a refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidHqAvatarError);
    expect((error as InstanceType<typeof InvalidHqAvatarError>).reason).toBe("size");
  }
});

test("a new avatar of another type removes the previous file", () => {
  writeHqAvatar({ mime: "image/png", data: PNG });
  writeHqAvatar({ mime: "image/gif", data: GIF });
  expect(fs.existsSync(statePath("hq-avatar.png"))).toBe(false);
  expect(hqAvatarFile()).toEqual({ path: statePath("hq-avatar.gif"), mime: "image/gif" });
});

test("clearing removes the file and the record, and keeps the name", () => {
  writeHqName("HQ");
  writeHqAvatar({ mime: "image/webp", data: WEBP });
  clearHqAvatar();
  expect(fs.existsSync(statePath("hq-avatar.webp"))).toBe(false);
  expect(readHqIdentity()).toEqual({ name: "HQ", avatar: null });
  expect(hqAvatarFile()).toBeNull();
});

test("a record whose file went missing reads as no avatar", () => {
  writeHqAvatar({ mime: "image/gif", data: GIF });
  fs.rmSync(statePath("hq-avatar.gif"));
  expect(hqAvatarFile()).toBeNull();
});
