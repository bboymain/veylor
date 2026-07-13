import { describe, expect, test } from "bun:test";
import {
  adjustBrightness,
  boxBlur,
  cropImage,
  decodePng,
  degradeResolution,
  encodePng,
  generateSyntheticItemImage,
  generateVariantSet,
  occludeRect,
  padImage,
  resizeImage,
  rotateImage,
} from "./variants";

describe("synthetic fixture generation", () => {
  test("is deterministic for the same seed and differs across seeds", () => {
    const one = generateSyntheticItemImage("seed-a", 32, 32);
    const two = generateSyntheticItemImage("seed-a", 32, 32);
    const other = generateSyntheticItemImage("seed-b", 32, 32);
    expect(Buffer.from(one.rgba).equals(Buffer.from(two.rgba))).toBe(true);
    expect(Buffer.from(one.rgba).equals(Buffer.from(other.rgba))).toBe(false);
  });

  test("rejects tiny canvases", () => {
    expect(() => generateSyntheticItemImage("seed", 8, 8)).toThrow("16x16");
  });
});

describe("png encode/decode roundtrip", () => {
  test("preserves every RGBA byte", () => {
    const image = generateSyntheticItemImage("roundtrip", 24, 18);
    const decoded = decodePng(encodePng(image));
    expect(decoded.width).toBe(24);
    expect(decoded.height).toBe(18);
    expect(Buffer.from(decoded.rgba).equals(Buffer.from(image.rgba))).toBe(true);
  });

  test("rejects non-PNG bytes", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4]))).toThrow("Not a PNG");
  });
});

describe("synthetic perturbations", () => {
  const source = generateSyntheticItemImage("transforms", 40, 30);

  test("crop produces the requested region dimensions", () => {
    const cropped = cropImage(source, { x: 5, y: 5, width: 20, height: 15 });
    expect(cropped.width).toBe(20);
    expect(cropped.height).toBe(15);
    expect(() => cropImage(source, { x: 100, y: 100, width: 5, height: 5 })).toThrow(
      "outside the image",
    );
  });

  test("brightness scales channels and clamps at 255", () => {
    const brighter = adjustBrightness(source, 10);
    let sawClamp = false;
    for (let index = 0; index < brighter.rgba.length; index += 4) {
      expect(brighter.rgba[index]).toBeGreaterThanOrEqual(source.rgba[index]);
      if (brighter.rgba[index] === 255) sawClamp = true;
      expect(brighter.rgba[index + 3]).toBe(source.rgba[index + 3]);
    }
    expect(sawClamp).toBe(true);
    expect(() => adjustBrightness(source, 0)).toThrow("positive");
  });

  test("blur, resize, and degrade keep dimensions coherent", () => {
    expect(boxBlur(source, 2).width).toBe(source.width);
    const resized = resizeImage(source, 10, 8);
    expect(resized.width).toBe(10);
    expect(resized.height).toBe(8);
    const degraded = degradeResolution(source, 0.25);
    expect(degraded.width).toBe(source.width);
    expect(degraded.height).toBe(source.height);
    expect(Buffer.from(degraded.rgba).equals(Buffer.from(source.rgba))).toBe(false);
  });

  test("padding adds a solid border and occlusion overwrites the region", () => {
    const padded = padImage(source, 6, [10, 20, 30]);
    expect(padded.width).toBe(source.width + 12);
    expect(padded.height).toBe(source.height + 12);
    expect(padded.rgba[0]).toBe(10);
    expect(padded.rgba[1]).toBe(20);
    expect(padded.rgba[2]).toBe(30);

    const occluded = occludeRect(source, { x: 2, y: 2, width: 4, height: 4 }, [1, 2, 3]);
    const index = (3 * source.width + 3) * 4;
    expect(occluded.rgba[index]).toBe(1);
    expect(occluded.rgba[index + 1]).toBe(2);
    expect(occluded.rgba[index + 2]).toBe(3);
    // Source is untouched.
    expect(source.rgba[index]).not.toBe(1);
  });

  test("rotate90 swaps dimensions and rotate180 twice restores pixels", () => {
    const rotated = rotateImage(source, 90);
    expect(rotated.width).toBe(source.height);
    expect(rotated.height).toBe(source.width);
    const back = rotateImage(rotateImage(source, 180), 180);
    expect(Buffer.from(back.rgba).equals(Buffer.from(source.rgba))).toBe(true);
    const small = rotateImage(source, 8);
    expect(small.width).toBe(source.width);
    expect(small.height).toBe(source.height);
  });

  test("the standard variant set is complete and labeled synthetic", () => {
    const variants = generateVariantSet(source);
    expect(variants.map((variant) => variant.kind).sort()).toEqual([
      "blur",
      "brighter",
      "crop",
      "darker",
      "low_resolution",
      "occluded",
      "padded_background",
      "rotate90",
      "rotate_small",
    ]);
    for (const variant of variants) {
      expect(variant.synthetic).toBe(true);
      // Every variant survives a PNG roundtrip.
      const decoded = decodePng(encodePng(variant.image));
      expect(decoded.width).toBe(variant.image.width);
      expect(decoded.height).toBe(variant.image.height);
    }
  });
});
