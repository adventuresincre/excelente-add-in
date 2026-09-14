#!/usr/bin/env node
/**
 * Generate Excelente brand assets from the single source PNG at
 * public/assets/source/logo.png.
 *
 * Source has no alpha channel (background is solid near-white). We threshold
 * out the white background to produce clean transparent PNGs at every size
 * Office's manifest references, plus a multi-resolution favicon.ico.
 *
 * Run from apps/excel-addin/:
 *   node scripts/generate-brand-assets.mjs
 *
 * Idempotent — overwrites existing icon-*.png and favicon.ico.
 */
import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE = resolve(ROOT, "public/assets/source/logo.png");
const OUT_DIR = resolve(ROOT, "public/assets");

// Manifest references icon-{16,32,64,80,128}. logo-filled.png is the larger
// in-app mark referenced from the task pane (300×300 was the placeholder
// dimension — we keep that size so layouts don't shift).
const PNG_SIZES = [16, 32, 64, 80, 128];
const LOGO_FILLED_SIZE = 300;

// White-keying threshold. Any pixel whose RGB is all above this becomes
// transparent. Source backgrounds sample at ~244-253; gold pixels are
// ~(193, 149, 53). Threshold 230 is safely between, so gold survives at
// full saturation and the white keys out cleanly.
const WHITE_KEY_THRESHOLD = 230;

/**
 * Read the source RGB PNG and emit an RGBA buffer with the near-white
 * background keyed to transparent. Gold stays at full opacity; the boundary
 * gets a one-pixel anti-aliased ring via partial alpha at the threshold
 * transition.
 */
async function buildAlphaSource() {
  const { data, info } = await sharp(SOURCE)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 3) {
    throw new Error(`Expected 3-channel source, got ${channels}`);
  }

  // New 4-channel buffer with computed alpha.
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    out[j] = r;
    out[j + 1] = g;
    out[j + 2] = b;
    // Distance from pure-white in luminance, normalized. Pixels near white
    // get fully transparent; pixels well inside the gold get fully opaque;
    // the narrow band between gets antialiased.
    const minRgb = Math.min(r, g, b);
    if (minRgb >= WHITE_KEY_THRESHOLD) {
      out[j + 3] = 0;
    } else if (minRgb >= WHITE_KEY_THRESHOLD - 25) {
      // Ramp 0..255 over the antialias band.
      out[j + 3] = Math.round(((WHITE_KEY_THRESHOLD - minRgb) / 25) * 255);
    } else {
      out[j + 3] = 255;
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Build the alpha-keyed source once; reuse it for every size.
  const baseBuffer = await (await buildAlphaSource()).toBuffer();

  for (const size of PNG_SIZES) {
    const out = resolve(OUT_DIR, `icon-${size}.png`);
    await sharp(baseBuffer)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(`  ${out}`);
  }

  // 300×300 in-app logo (same source, just resized).
  const logoFilled = resolve(OUT_DIR, "logo-filled.png");
  await sharp(baseBuffer)
    .resize(LOGO_FILLED_SIZE, LOGO_FILLED_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(logoFilled);
  console.log(`  ${logoFilled}`);

  // Favicon: a multi-resolution PNG-in-ICO container with 16, 32, 48 sizes
  // covers Chrome / Edge / Firefox / IE 11+ across DPIs. Sharp doesn't emit
  // .ico natively, so we hand-roll the small header.
  const favPath = resolve(OUT_DIR, "favicon.ico");
  const favSizes = [16, 32, 48];
  const pngBuffers = await Promise.all(
    favSizes.map((s) =>
      sharp(baseBuffer)
        .resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer()
    )
  );
  writeFileSync(favPath, buildIco(favSizes, pngBuffers));
  console.log(`  ${favPath} (${favSizes.join("+")})`);
}

/**
 * Build an .ico file containing PNG-compressed images at the given sizes.
 * Format: ICONDIR + N×ICONDIRENTRY + N×PNG payloads. Per the ICO spec, the
 * dimension byte is 0 for any image ≥256px wide (n/a here).
 */
function buildIco(sizes, pngBuffers) {
  const ICONDIR_SIZE = 6;
  const ICONDIRENTRY_SIZE = 16;
  const headerSize = ICONDIR_SIZE + sizes.length * ICONDIRENTRY_SIZE;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(sizes.length, 4); // count

  let offset = headerSize;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const png = pngBuffers[i];
    const entryOffset = ICONDIR_SIZE + i * ICONDIRENTRY_SIZE;
    header.writeUInt8(size === 256 ? 0 : size, entryOffset); // width
    header.writeUInt8(size === 256 ? 0 : size, entryOffset + 1); // height
    header.writeUInt8(0, entryOffset + 2); // color count
    header.writeUInt8(0, entryOffset + 3); // reserved
    header.writeUInt16LE(1, entryOffset + 4); // color planes
    header.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    header.writeUInt32LE(png.length, entryOffset + 8); // payload size
    header.writeUInt32LE(offset, entryOffset + 12); // payload offset
    offset += png.length;
  }

  return Buffer.concat([header, ...pngBuffers]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
