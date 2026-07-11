import { describe, expect, test } from "bun:test";
import { fingerprintImage, parseVerifiedScanCacheRow } from "./scan-cache.server";

const item = {
  id: "item-1",
  category: "shirt",
  name: "Black graphic T-shirt",
  color: "black",
  material: "cotton",
  style: "graphic",
  pattern: null,
  visibleBrand: null,
  brandConfidence: 0,
  confidence: 0.9,
  searchQueries: ["black graphic t-shirt"],
  affordableAlternativeQueries: ["affordable black graphic t-shirt"],
  premiumAlternativeQueries: ["premium black graphic t-shirt"],
};

describe("scan cache fingerprinting", () => {
  test("produces a stable SHA-256 fingerprint from image bytes", () => {
    const image = {
      mimeType: "image/png" as const,
      base64: Buffer.from("same-image-bytes").toString("base64"),
      byteLength: 16,
    };
    expect(fingerprintImage(image)).toBe(fingerprintImage(image));
    expect(fingerprintImage(image)).toHaveLength(64);
  });

  test("different bytes produce different fingerprints", () => {
    const first = {
      mimeType: "image/png" as const,
      base64: Buffer.from("first").toString("base64"),
      byteLength: 5,
    };
    const second = {
      mimeType: "image/png" as const,
      base64: Buffer.from("second").toString("base64"),
      byteLength: 6,
    };
    expect(fingerprintImage(first)).not.toBe(fingerprintImage(second));
  });
});

describe("verified scan cache row parsing", () => {
  test("accepts a complete normalized scan row", () => {
    const result = parseVerifiedScanCacheRow({
      id: "550e8400-e29b-41d4-a716-446655440000",
      model: "gemini-2.5-flash",
      summary: "A black graphic shirt.",
      detected_items: [item],
    });
    expect(result?.sourceModel).toBe("gemini-2.5-flash");
    expect(result?.result.items).toHaveLength(1);
  });

  test("rejects malformed, empty, or incomplete cached data", () => {
    expect(parseVerifiedScanCacheRow({})).toBeNull();
    expect(
      parseVerifiedScanCacheRow({
        id: "id",
        model: "gemini",
        summary: "summary",
        detected_items: [],
      }),
    ).toBeNull();
    expect(
      parseVerifiedScanCacheRow({
        id: "id",
        model: "gemini",
        summary: "summary",
        detected_items: [{ ...item, confidence: 2 }],
      }),
    ).toBeNull();
  });
});
