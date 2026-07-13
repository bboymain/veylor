import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

// Dependency-free synthetic image tooling for the PRIVATE visual item-memory
// benchmark. Supports a minimal PNG subset (8-bit RGB/RGBA, non-interlaced)
// so fixture images and perturbed variants can be generated locally without
// downloading any image library or model.
//
// IMPORTANT HONESTY NOTE: generated variants are SYNTHETIC PERTURBATIONS.
// They approximate crop/lighting/quality changes but are NOT equivalent to
// real photos of the same item taken by different users. Every produced
// variant is labeled synthetic and callers must keep that label.

export type RgbaImage = {
  width: number;
  height: number;
  /** Row-major RGBA bytes, 4 per pixel. */
  rgba: Uint8Array;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable !== null) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decodes a minimal PNG (8-bit, color type 2 or 6, non-interlaced). */
export function decodePng(fileBytes: Uint8Array): RgbaImage {
  const buffer = Buffer.from(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG file.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idatParts: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error("Truncated PNG chunk.");
    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      interlace = buffer[dataStart + 12];
    } else if (type === "IDAT") {
      idatParts.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (width <= 0 || height <= 0) throw new Error("PNG has no IHDR dimensions.");
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
    throw new Error("Only 8-bit non-interlaced RGB/RGBA PNGs are supported.");
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("PNG pixel data is truncated.");

  const unfiltered = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const rowStart = row * (stride + 1) + 1;
    const outStart = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const x = raw[rowStart + index];
      const left = index >= channels ? unfiltered[outStart + index - channels] : 0;
      const up = row > 0 ? unfiltered[outStart - stride + index] : 0;
      const upLeft =
        row > 0 && index >= channels ? unfiltered[outStart - stride + index - channels] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = x;
          break;
        case 1:
          value = x + left;
          break;
        case 2:
          value = x + up;
          break;
        case 3:
          value = x + Math.floor((left + up) / 2);
          break;
        case 4:
          value = x + paethPredictor(left, up, upLeft);
          break;
        default:
          throw new Error(`Unsupported PNG filter type ${filter}.`);
      }
      unfiltered[outStart + index] = value & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = unfiltered[pixel * channels];
    rgba[pixel * 4 + 1] = unfiltered[pixel * channels + 1];
    rgba[pixel * 4 + 2] = unfiltered[pixel * channels + 2];
    rgba[pixel * 4 + 3] = channels === 4 ? unfiltered[pixel * channels + 3] : 255;
  }
  return { width, height, rgba };
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  Buffer.from(data).copy(chunk, 8);
  const crcInput = chunk.subarray(4, 8 + data.length);
  chunk.writeUInt32BE(crc32(crcInput), 8 + data.length);
  return chunk;
}

/** Encodes an RGBA image as an 8-bit RGBA PNG (filter 0 rows). */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, rgba } = image;
  if (width <= 0 || height <= 0 || rgba.length !== width * height * 4) {
    throw new Error("encodePng requires width*height*4 RGBA bytes.");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + row * stride, stride).copy(
      raw,
      row * (stride + 1) + 1,
    );
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function pixelAt(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const index = (y * image.width + x) * 4;
  return [image.rgba[index], image.rgba[index + 1], image.rgba[index + 2], image.rgba[index + 3]];
}

export function cropImage(
  image: RgbaImage,
  region: { x: number; y: number; width: number; height: number },
): RgbaImage {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const width = Math.min(image.width - x, Math.floor(region.width));
  const height = Math.min(image.height - y, Math.floor(region.height));
  if (width <= 0 || height <= 0) throw new Error("Crop region is outside the image.");
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * image.width + x) * 4;
    rgba.set(image.rgba.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { width, height, rgba };
}

/** factor > 1 brightens, factor < 1 darkens; alpha is preserved. */
export function adjustBrightness(image: RgbaImage, factor: number): RgbaImage {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error("Brightness factor must be a positive number.");
  }
  const rgba = new Uint8Array(image.rgba.length);
  for (let index = 0; index < image.rgba.length; index += 4) {
    rgba[index] = clampByte(image.rgba[index] * factor);
    rgba[index + 1] = clampByte(image.rgba[index + 1] * factor);
    rgba[index + 2] = clampByte(image.rgba[index + 2] * factor);
    rgba[index + 3] = image.rgba[index + 3];
  }
  return { width: image.width, height: image.height, rgba };
}

/** Simple box blur with the given radius (approximate lens/motion softness). */
export function boxBlur(image: RgbaImage, radius: number): RgbaImage {
  if (!Number.isInteger(radius) || radius < 1 || radius > 32) {
    throw new Error("Blur radius must be an integer between 1 and 32.");
  }
  const rgba = new Uint8Array(image.rgba.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sy = y + dy;
        if (sy < 0 || sy >= image.height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = x + dx;
          if (sx < 0 || sx >= image.width) continue;
          const [pr, pg, pb, pa] = pixelAt(image, sx, sy);
          r += pr;
          g += pg;
          b += pb;
          a += pa;
          count += 1;
        }
      }
      const outIndex = (y * image.width + x) * 4;
      rgba[outIndex] = clampByte(r / count);
      rgba[outIndex + 1] = clampByte(g / count);
      rgba[outIndex + 2] = clampByte(b / count);
      rgba[outIndex + 3] = clampByte(a / count);
    }
  }
  return { width: image.width, height: image.height, rgba };
}

/** Nearest-neighbor resize (used for low-resolution simulation). */
export function resizeImage(image: RgbaImage, width: number, height: number): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Resize dimensions must be positive integers.");
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const source = (sy * image.width + sx) * 4;
      const target = (y * width + x) * 4;
      rgba[target] = image.rgba[source];
      rgba[target + 1] = image.rgba[source + 1];
      rgba[target + 2] = image.rgba[source + 2];
      rgba[target + 3] = image.rgba[source + 3];
    }
  }
  return { width, height, rgba };
}

/** Downscales then upscales back, simulating resolution/compression loss. */
export function degradeResolution(image: RgbaImage, scale: number): RgbaImage {
  if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) {
    throw new Error("Degrade scale must be between 0 and 1 (exclusive).");
  }
  const smallWidth = Math.max(1, Math.round(image.width * scale));
  const smallHeight = Math.max(1, Math.round(image.height * scale));
  return resizeImage(resizeImage(image, smallWidth, smallHeight), image.width, image.height);
}

/** Pads the image with a solid background border (background change proxy). */
export function padImage(
  image: RgbaImage,
  padding: number,
  color: [number, number, number],
): RgbaImage {
  if (!Number.isInteger(padding) || padding < 1 || padding > 512) {
    throw new Error("Padding must be an integer between 1 and 512.");
  }
  const width = image.width + padding * 2;
  const height = image.height + padding * 2;
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = clampByte(color[0]);
    rgba[index * 4 + 1] = clampByte(color[1]);
    rgba[index * 4 + 2] = clampByte(color[2]);
    rgba[index * 4 + 3] = 255;
  }
  for (let row = 0; row < image.height; row += 1) {
    const target = ((row + padding) * width + padding) * 4;
    rgba.set(image.rgba.subarray(row * image.width * 4, (row + 1) * image.width * 4), target);
  }
  return { width, height, rgba };
}

/** Draws an opaque rectangle over part of the image (partial occlusion). */
export function occludeRect(
  image: RgbaImage,
  region: { x: number; y: number; width: number; height: number },
  color: [number, number, number],
): RgbaImage {
  const rgba = new Uint8Array(image.rgba);
  const startX = Math.max(0, Math.floor(region.x));
  const startY = Math.max(0, Math.floor(region.y));
  const endX = Math.min(image.width, Math.floor(region.x + region.width));
  const endY = Math.min(image.height, Math.floor(region.y + region.height));
  if (endX <= startX || endY <= startY) throw new Error("Occlusion region is outside the image.");
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * image.width + x) * 4;
      rgba[index] = clampByte(color[0]);
      rgba[index + 1] = clampByte(color[1]);
      rgba[index + 2] = clampByte(color[2]);
      rgba[index + 3] = 255;
    }
  }
  return { width: image.width, height: image.height, rgba };
}

/**
 * Rotates around the image center by the given degrees using nearest-neighbor
 * sampling. Multiples of 90 rotate exactly; other angles keep the original
 * canvas and fill uncovered pixels with the given background color.
 */
export function rotateImage(
  image: RgbaImage,
  degrees: number,
  background: [number, number, number] = [255, 255, 255],
): RgbaImage {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized === 0) {
    return { width: image.width, height: image.height, rgba: new Uint8Array(image.rgba) };
  }
  if (normalized === 90 || normalized === 180 || normalized === 270) {
    const rotatedOnce = (source: RgbaImage): RgbaImage => {
      const width = source.height;
      const height = source.width;
      const rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
          // 90 degrees clockwise: (x, y) -> (width - 1 - y, x)
          const targetX = width - 1 - y;
          const targetY = x;
          const sourceIndex = (y * source.width + x) * 4;
          const targetIndex = (targetY * width + targetX) * 4;
          rgba[targetIndex] = source.rgba[sourceIndex];
          rgba[targetIndex + 1] = source.rgba[sourceIndex + 1];
          rgba[targetIndex + 2] = source.rgba[sourceIndex + 2];
          rgba[targetIndex + 3] = source.rgba[sourceIndex + 3];
        }
      }
      return { width, height, rgba };
    };
    let rotated = rotatedOnce(image);
    if (normalized >= 180) rotated = rotatedOnce(rotated);
    if (normalized === 270) rotated = rotatedOnce(rotated);
    return rotated;
  }

  const radians = (normalized * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = (image.width - 1) / 2;
  const centerY = (image.height - 1) / 2;
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      // Inverse mapping: rotate target coordinates back into the source.
      const dx = x - centerX;
      const dy = y - centerY;
      const sourceX = Math.round(centerX + dx * cos + dy * sin);
      const sourceY = Math.round(centerY - dx * sin + dy * cos);
      const targetIndex = (y * image.width + x) * 4;
      if (sourceX >= 0 && sourceX < image.width && sourceY >= 0 && sourceY < image.height) {
        const sourceIndex = (sourceY * image.width + sourceX) * 4;
        rgba[targetIndex] = image.rgba[sourceIndex];
        rgba[targetIndex + 1] = image.rgba[sourceIndex + 1];
        rgba[targetIndex + 2] = image.rgba[sourceIndex + 2];
        rgba[targetIndex + 3] = image.rgba[sourceIndex + 3];
      } else {
        rgba[targetIndex] = clampByte(background[0]);
        rgba[targetIndex + 1] = clampByte(background[1]);
        rgba[targetIndex + 2] = clampByte(background[2]);
        rgba[targetIndex + 3] = 255;
      }
    }
  }
  return { width: image.width, height: image.height, rgba };
}

function seededBytes(seed: string, count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  let filled = 0;
  let counter = 0;
  while (filled < count) {
    const digest = createHash("sha256").update(`${seed}#${counter}`).digest();
    const take = Math.min(digest.length, count - filled);
    bytes.set(digest.subarray(0, take), filled);
    filled += take;
    counter += 1;
  }
  return bytes;
}

/**
 * Deterministically generates a synthetic "item" image from a seed: a colored
 * garment-like block pattern on a plain background. Purely synthetic fixture
 * material — never a real product photo.
 */
export function generateSyntheticItemImage(seed: string, width = 96, height = 96): RgbaImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
    throw new Error("Synthetic images must be at least 16x16.");
  }
  const noise = seededBytes(seed, 64);
  const base: [number, number, number] = [noise[0], noise[1], noise[2]];
  const accent: [number, number, number] = [noise[3], noise[4], noise[5]];
  const background: [number, number, number] = [
    200 + (noise[6] % 40),
    200 + (noise[7] % 40),
    200 + (noise[8] % 40),
  ];
  const stripeEvery = 4 + (noise[9] % 8);
  const rgba = new Uint8Array(width * height * 4);
  const bodyLeft = Math.floor(width * 0.2);
  const bodyRight = Math.floor(width * 0.8);
  const bodyTop = Math.floor(height * 0.15);
  const bodyBottom = Math.floor(height * 0.9);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const inBody = x >= bodyLeft && x < bodyRight && y >= bodyTop && y < bodyBottom;
      let color = background;
      if (inBody) {
        color = Math.floor((x + y) / stripeEvery) % 2 === 0 ? base : accent;
      }
      rgba[index] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
}

export type VariantKind =
  | "crop"
  | "brighter"
  | "darker"
  | "blur"
  | "low_resolution"
  | "padded_background"
  | "occluded"
  | "rotate90"
  | "rotate_small";

export type GeneratedVariant = {
  kind: VariantKind;
  image: RgbaImage;
  /** Always true: these are synthetic perturbations, not real photos. */
  synthetic: true;
  transform: Record<string, number | string>;
};

/** Produces the standard synthetic perturbation set for one source image. */
export function generateVariantSet(source: RgbaImage): GeneratedVariant[] {
  const cropRegion = {
    x: Math.floor(source.width * 0.15),
    y: Math.floor(source.height * 0.15),
    width: Math.max(1, Math.floor(source.width * 0.7)),
    height: Math.max(1, Math.floor(source.height * 0.7)),
  };
  const occlusion = {
    x: Math.floor(source.width * 0.35),
    y: Math.floor(source.height * 0.35),
    width: Math.max(1, Math.floor(source.width * 0.3)),
    height: Math.max(1, Math.floor(source.height * 0.3)),
  };
  return [
    { kind: "crop", image: cropImage(source, cropRegion), synthetic: true, transform: cropRegion },
    {
      kind: "brighter",
      image: adjustBrightness(source, 1.35),
      synthetic: true,
      transform: { factor: 1.35 },
    },
    {
      kind: "darker",
      image: adjustBrightness(source, 0.65),
      synthetic: true,
      transform: { factor: 0.65 },
    },
    { kind: "blur", image: boxBlur(source, 2), synthetic: true, transform: { radius: 2 } },
    {
      kind: "low_resolution",
      image: degradeResolution(source, 0.25),
      synthetic: true,
      transform: { scale: 0.25 },
    },
    {
      kind: "padded_background",
      image: padImage(source, Math.max(4, Math.floor(source.width * 0.15)), [240, 240, 240]),
      synthetic: true,
      transform: { padding: Math.max(4, Math.floor(source.width * 0.15)) },
    },
    {
      kind: "occluded",
      image: occludeRect(source, occlusion, [30, 30, 30]),
      synthetic: true,
      transform: occlusion,
    },
    {
      kind: "rotate90",
      image: rotateImage(source, 90),
      synthetic: true,
      transform: { degrees: 90 },
    },
    {
      kind: "rotate_small",
      image: rotateImage(source, 8),
      synthetic: true,
      transform: { degrees: 8 },
    },
  ];
}
