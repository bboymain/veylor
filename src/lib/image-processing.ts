export type FocusCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read this image."));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unsupported image format."));
    image.src = src;
  });
}

export async function cropAndResizeImage(src: string, crop: FocusCrop, maxSize = 512) {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot prepare the image for analysis.");

  const centerX = (crop.x / 100) * image.naturalWidth;
  const centerY = (crop.y / 100) * image.naturalHeight;
  const sourceWidth = Math.min(
    image.naturalWidth,
    Math.max(64, (crop.width / 100) * image.naturalWidth),
  );
  const sourceHeight = Math.min(
    image.naturalHeight,
    Math.max(64, (crop.height / 100) * image.naturalHeight),
  );
  const sx = Math.min(Math.max(centerX - sourceWidth / 2, 0), image.naturalWidth - sourceWidth);
  const sy = Math.min(Math.max(centerY - sourceHeight / 2, 0), image.naturalHeight - sourceHeight);
  const scale = Math.min(1, maxSize / Math.max(sourceWidth, sourceHeight));
  const outputWidth = Math.max(224, Math.round(sourceWidth * scale));
  const outputHeight = Math.max(224, Math.round(sourceHeight * scale));

  canvas.width = outputWidth;
  canvas.height = outputHeight;

  context.drawImage(image, sx, sy, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export async function makeThumbnail(src: string, maxSize = 220) {
  const image = await loadImage(src);
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot make a scan thumbnail.");
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.72);
}
