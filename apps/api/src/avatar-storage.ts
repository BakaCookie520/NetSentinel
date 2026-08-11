import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { BadRequestException, NotFoundException } from "@nestjs/common";

const maximumAvatarBytes = 2 * 1024 * 1024;

export type AvatarImage = {
  extension: "png" | "jpg" | "webp";
  contentType: "image/png" | "image/jpeg" | "image/webp";
};

const avatarImages: Record<AvatarImage["extension"], AvatarImage> = {
  png: { extension: "png", contentType: "image/png" },
  jpg: { extension: "jpg", contentType: "image/jpeg" },
  webp: { extension: "webp", contentType: "image/webp" },
};

function avatarDirectory(): string {
  return join(process.env.NETSENTINEL_DATA_DIR ?? "/app/data", "avatars");
}

export function detectAvatarImage(buffer: Buffer): AvatarImage {
  if (buffer.length > maximumAvatarBytes) {
    throw new BadRequestException("Avatar must be 2 MB or smaller");
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return avatarImages.png;
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return avatarImages.jpg;
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    buffer.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return avatarImages.webp;
  }
  throw new BadRequestException("Avatar must be a PNG, JPEG, or WebP image");
}

function avatarPath(avatarKey: string): string {
  const safeName = basename(avatarKey);
  if (safeName !== avatarKey) throw new NotFoundException();
  return join(avatarDirectory(), safeName);
}

export async function saveAvatar(buffer: Buffer): Promise<string> {
  const image = detectAvatarImage(buffer);
  const avatarKey = `${randomUUID()}.${image.extension}`;
  await mkdir(avatarDirectory(), { recursive: true });
  await writeFile(avatarPath(avatarKey), buffer, { flag: "wx", mode: 0o600 });
  return avatarKey;
}

export async function removeAvatar(avatarKey: string | null | undefined): Promise<void> {
  if (!avatarKey) return;
  await rm(avatarPath(avatarKey), { force: true });
}

export async function readAvatar(avatarKey: string): Promise<{
  image: AvatarImage;
  buffer: Buffer;
}> {
  const extension = avatarKey.split(".").at(-1);
  if (extension !== "png" && extension !== "jpg" && extension !== "webp") {
    throw new NotFoundException();
  }
  try {
    return {
      image: avatarImages[extension],
      buffer: await readFile(avatarPath(avatarKey)),
    };
  } catch {
    throw new NotFoundException();
  }
}
