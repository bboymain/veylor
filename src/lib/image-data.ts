export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export type ParsedDataUrlImage = {
  mimeType: SupportedImageMimeType;
  base64: string;
  byteLength: number;
};

export function parseDataUrlImage(dataUrl: string): ParsedDataUrlImage {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error("Unsupported image type. Use JPG, JPEG, PNG, or WEBP.");
  }

  const normalizedMimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1];
  const mimeType = normalizedMimeType.toLowerCase() as SupportedImageMimeType;
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new Error("Unsupported image type. Use JPG, JPEG, PNG, or WEBP.");
  }

  const base64 = match[2];
  const byteLength = Math.ceil((base64.length * 3) / 4);
  if (byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large after resizing. Try a smaller crop or image.");
  }

  return { mimeType, base64, byteLength };
}
