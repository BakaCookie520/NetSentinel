import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { detectAvatarImage } from "./avatar-storage.js";

describe("avatar validation", () => {
  it("accepts the supported raster image signatures", () => {
    expect(
      detectAvatarImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).extension,
    ).toBe("png");
    expect(detectAvatarImage(Buffer.from([0xff, 0xd8, 0xff])).extension).toBe("jpg");
    expect(detectAvatarImage(Buffer.from("RIFF0000WEBP")).extension).toBe("webp");
  });

  it("rejects unsupported content and oversized files", () => {
    expect(() => detectAvatarImage(Buffer.from("<svg></svg>"))).toThrow(BadRequestException);
    expect(() => detectAvatarImage(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow(BadRequestException);
  });
});
