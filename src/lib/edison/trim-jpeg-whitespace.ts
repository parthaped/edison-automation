import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";

export interface TrimJpegWhitespaceOptions {
  /** Pixels with R/G/B all >= threshold are treated as background. */
  threshold?: number;
  /** Extra pixels kept around detected content. */
  padding?: number;
}

export interface TrimJpegWhitespaceResult {
  jpg: Uint8Array;
  width: number;
  height: number;
  trimmed: boolean;
}

function isBackgroundPixel(
  data: Uint8ClampedArray,
  offset: number,
  threshold: number,
): boolean {
  return (
    data[offset] >= threshold &&
    data[offset + 1] >= threshold &&
    data[offset + 2] >= threshold
  );
}

/**
 * Trim uniform light borders from a rasterized page JPEG so facsimiles match
 * the visible document area instead of showing wide PDF media-box margins.
 */
export async function trimJpegWhitespace(
  jpg: Uint8Array,
  options: TrimJpegWhitespaceOptions = {},
): Promise<TrimJpegWhitespaceResult> {
  const threshold = options.threshold ?? 245;
  const padding = options.padding ?? 6;

  const image = await loadImage(Buffer.from(jpg));
  const source = createCanvas(image.width, image.height);
  const sourceCtx = source.getContext("2d");
  sourceCtx.drawImage(image, 0, 0);

  const { data, width, height } = sourceCtx.getImageData(
    0,
    0,
    image.width,
    image.height,
  );

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (!isBackgroundPixel(data, offset, threshold)) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      jpg,
      width: image.width,
      height: image.height,
      trimmed: false,
    };
  }

  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropWidth = Math.min(width - cropX, maxX - minX + 1 + padding * 2);
  const cropHeight = Math.min(height - cropY, maxY - minY + 1 + padding * 2);

  if (cropWidth === width && cropHeight === height) {
    return {
      jpg,
      width: image.width,
      height: image.height,
      trimmed: false,
    };
  }

  const trimmedCanvas = createCanvas(cropWidth, cropHeight);
  const trimmedCtx = trimmedCanvas.getContext("2d");
  trimmedCtx.drawImage(
    source as unknown as Canvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    cropWidth,
    cropHeight,
  );

  const encoded = await trimmedCanvas.encode("jpeg", 85);
  return {
    jpg: new Uint8Array(encoded),
    width: cropWidth,
    height: cropHeight,
    trimmed: true,
  };
}

export function isRasterWhitespaceTrimEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.EDISON_RASTER_TRIM_WHITESPACE?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}
