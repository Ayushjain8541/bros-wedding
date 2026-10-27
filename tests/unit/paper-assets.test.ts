// @vitest-environment node
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OPENING_ASSET_KEYS, PAPER_ASSETS } from "@/features/invitation/paper-assets";

// Decode with the same Sharp installation Next uses, without a second production dependency.
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const assetPath = (src: string) => path.join(process.cwd(), "public", src);

describe("original paper artwork delivery", () => {
  it.each(Object.entries(PAPER_ASSETS))("delivers decodable %s artwork at its declared dimensions", async (_key, asset) => {
    const bytes = await readFile(assetPath(asset.src));
    const decoder = sharp(bytes);
    const metadata = await decoder.metadata();
    expect(metadata.format).toBe("webp");
    expect([metadata.width, metadata.height]).toEqual([asset.width, asset.height]);
    const decoded = await decoder.raw().toBuffer({ resolveWithObject: true });
    expect(decoded.data.length).toBe(metadata.width * metadata.height * decoded.info.channels);
  });

  it("keeps the registered envelope layers and letter ready for the scene", async () => {
    for (const key of ["back", "pocket", "flapFront", "flapBack", "seal"] as const) {
      const metadata = await sharp(await readFile(assetPath(PAPER_ASSETS[key].src))).metadata();
      expect([metadata.width, metadata.height, metadata.hasAlpha]).toEqual([1600, 1000, true]);
    }
    const letter = await sharp(await readFile(assetPath(PAPER_ASSETS.letter.src))).metadata();
    expect([letter.width, letter.height, letter.hasAlpha]).toEqual([1400, 900, true]);
  });

  it("keeps cold-opening artwork at or below 900 KiB, with the edge deferred", async () => {
    expect(OPENING_ASSET_KEYS).not.toContain("edge");
    const files = await Promise.all(OPENING_ASSET_KEYS.map((key) => stat(assetPath(PAPER_ASSETS[key].src))));
    expect(files.reduce((total, file) => total + file.size, 0)).toBeLessThanOrEqual(900 * 1024);
  });
});
