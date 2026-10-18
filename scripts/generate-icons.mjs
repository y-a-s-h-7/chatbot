#!/usr/bin/env node
/**
 * Draws the app icon and writes every asset the two shells need.
 *
 * Written by hand on purpose: the alternative is adding `sharp` (a native
 * dependency) or `@capacitor/assets` (which needs a source image from somewhere
 * anyway) just to rasterise three shapes. `node:zlib` is all this needs.
 *
 *   npm run icons
 *
 * Outputs
 *   build/icon.png                        electron-builder (1024², rounded square)
 *   resources/icon-only.png               @capacitor/assets source
 *   resources/icon-foreground.png         adaptive-icon foreground layer
 *   resources/icon-background.png         adaptive-icon background layer
 *   resources/splash.png / splash-dark.png
 *   resources/android/mipmap-<density>/   stamped into the Android project by
 *                                         scripts/patch-android.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// A minimal PNG writer
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// A tiny canvas with 3× supersampling, which is where the smooth edges come from
// ---------------------------------------------------------------------------

const SS = 3;

class Canvas {
  constructor(size) {
    this.size = size;
    this.big = size * SS;
    this.data = new Float32Array(this.big * this.big * 4);
  }

  #blend(x, y, [r, g, b], alpha) {
    if (alpha <= 0) return;
    const i = (y * this.big + x) * 4;
    const dst = this.data;
    const a = Math.min(1, alpha);
    dst[i] = dst[i] * (1 - a) + r * a;
    dst[i + 1] = dst[i + 1] * (1 - a) + g * a;
    dst[i + 2] = dst[i + 2] * (1 - a) + b * a;
    dst[i + 3] = dst[i + 3] * (1 - a) + 255 * a;
  }

  /** `paint(x, y)` returns an rgba colour or null for "leave this pixel alone". */
  fill(paint) {
    const n = this.big;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const value = paint(x / n, y / n);
        if (value) this.#blend(x, y, value, value[3] ?? 1);
      }
    }
  }

  /** Copies another canvas' PNG pixels in, scaled, with its own alpha. */
  drawImage(png, sourceSize, left, top, size) {
    const n = this.big;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const u = (x / n) * this.size - left;
        const v = (y / n) * this.size - top;
        if (u < 0 || v < 0 || u >= size || v >= size) continue;
        const sx = Math.min(sourceSize - 1, Math.floor((u / size) * sourceSize));
        const sy = Math.min(sourceSize - 1, Math.floor((v / size) * sourceSize));
        const i = (sy * sourceSize + sx) * 4;
        const alpha = png[i + 3] / 255;
        if (alpha <= 0) continue;
        this.#blend(x, y, [png[i], png[i + 1], png[i + 2]], alpha);
      }
    }
  }

  /** Box-downsamples the supersampled buffer into a PNG-ready RGBA buffer. */
  toPng() {
    const size = this.size;
    const out = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let dy = 0; dy < SS; dy += 1) {
          for (let dx = 0; dx < SS; dx += 1) {
            const i = ((y * SS + dy) * this.big + (x * SS + dx)) * 4;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
            a += this.data[i + 3];
          }
        }
        const samples = SS * SS;
        const outIndex = (y * size + x) * 4;
        const alpha = a / samples;
        // Un-premultiply so the PNG keeps its colour in the transparent areas.
        const scale = alpha > 0 ? 255 / alpha : 0;
        out[outIndex] = Math.min(255, Math.round((r / samples) * scale));
        out[outIndex + 1] = Math.min(255, Math.round((g / samples) * scale));
        out[outIndex + 2] = Math.min(255, Math.round((b / samples) * scale));
        out[outIndex + 3] = Math.round(alpha);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const inRoundedRect = (x, y, left, top, right, bottom, radius) => {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
};

const inTriangle = (x, y, ax, ay, bx, by, cx, cy) => {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
};

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const ACCENT_TOP = [124, 106, 255];
const ACCENT_BOTTOM = [72, 52, 208];
const INK = [255, 255, 255];
const DARK = [11, 11, 13];

/**
 * The mark: a speech bubble with three dots, on the app's indigo gradient.
 * `options.background: false` leaves it transparent, which is what an adaptive
 * icon's foreground layer needs.
 */
function drawMark(size, options = {}) {
  const { round = false, background = true, scale = 1 } = options;
  const canvas = new Canvas(size);

  const r = round ? 0.5 : 0.225;
  const inset = (1 - scale) / 2;
  const left = inset;
  const top = inset;
  const right = 1 - inset;
  const bottom = 1 - inset;

  if (background) {
    canvas.fill((x, y) => {
      if (!inRoundedRect(x, y, left, top, right, bottom, r * scale)) return null;
      const t = Math.min(1, Math.max(0, (x + y) / 2));
      const [cr, cg, cb] = mix(ACCENT_TOP, ACCENT_BOTTOM, t);
      return [cr, cg, cb, 1];
    });
  }

  // Bubble: a wide rounded rectangle, a tail at its lower left, three dots.
  const bubble = {
    left: 0.24 * scale + inset,
    top: 0.29 * scale + inset,
    right: 0.76 * scale + inset,
    bottom: 0.64 * scale + inset,
    radius: 0.11 * scale,
  };
  const tail = [
    [0.36 * scale + inset, 0.6 * scale + inset],
    [0.3 * scale + inset, 0.79 * scale + inset],
    [0.47 * scale + inset, 0.63 * scale + inset],
  ];
  const dot = 0.045 * scale;
  const dotY = (bubble.top + bubble.bottom) / 2;

  canvas.fill((x, y) => {
    const insideBubble = inRoundedRect(x, y, bubble.left, bubble.top, bubble.right, bubble.bottom, bubble.radius);
    const insideTail = inTriangle(x, y, tail[0][0], tail[0][1], tail[1][0], tail[1][1], tail[2][0], tail[2][1]);
    if (!insideBubble && !insideTail) return null;
    for (const cx of [0.37, 0.5, 0.63]) {
      const dx = x - (cx * scale + inset);
      const dy = y - dotY;
      if (dx * dx + dy * dy <= dot * dot) return [90, 74, 220, 1];
    }
    return [INK[0], INK[1], INK[2], 1];
  });

  return canvas;
}

function write(file, buffer) {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  const kb = (buffer.length / 1024).toFixed(0);
  console.log(`  ${file}  (${kb} kB)`);
}

const MIPMAP_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

function main() {
  console.log('Writing app icons');

  // Electron: one big rounded square.
  write('build/icon.png', encodePng(1024, 1024, drawMark(1024).toPng()));

  // @capacitor/assets sources, in case you prefer that tool later.
  write('resources/icon-only.png', encodePng(1024, 1024, drawMark(1024, { round: true }).toPng()));
  write(
    'resources/icon-foreground.png',
    encodePng(1024, 1024, drawMark(1024, { background: false, scale: 0.66 }).toPng()),
  );
  const bg = new Canvas(1024);
  bg.fill((x, y) => {
    const [cr, cg, cb] = mix(ACCENT_TOP, ACCENT_BOTTOM, Math.min(1, Math.max(0, (x + y) / 2)));
    return [cr, cg, cb, 1];
  });
  write('resources/icon-background.png', encodePng(1024, 1024, bg.toPng()));

  const SPLASH = 1440;
  const LOGO = 576;
  const logoPng = drawMark(LOGO, { round: true }).toPng();
  for (const dark of [false, true]) {
    const splash = new Canvas(SPLASH);
    const backdrop = dark ? DARK : [250, 249, 247];
    splash.fill(() => [backdrop[0], backdrop[1], backdrop[2], 1]);
    splash.drawImage(logoPng, LOGO, (SPLASH - LOGO) / 2, (SPLASH - LOGO) / 2, LOGO);
    write(dark ? 'resources/splash-dark.png' : 'resources/splash.png', encodePng(SPLASH, SPLASH, splash.toPng()));
  }

  // Android launcher icons, ready for scripts/patch-android.mjs to stamp in.
  for (const [density, size] of Object.entries(MIPMAP_SIZES)) {
    const scale = size / 48;
    write(
      `resources/android/mipmap-${density}/ic_launcher.png`,
      encodePng(size, size, drawMark(size).toPng()),
    );
    write(
      `resources/android/mipmap-${density}/ic_launcher_round.png`,
      encodePng(size, size, drawMark(size, { round: true }).toPng()),
    );
    // Adaptive foreground: 108dp canvas with the mark in the safe 72dp centre.
    const foreground = Math.round(108 * scale);
    write(
      `resources/android/mipmap-${density}/ic_launcher_foreground.png`,
      encodePng(foreground, foreground, drawMark(foreground, { background: false, scale: 0.66 }).toPng()),
    );
  }

  // Android splash drawable: one square, scaled by Android for every density.
  write('resources/android/drawable/splash.png', encodePng(1024, 1024, drawMark(1024, { round: true }).toPng()));

  console.log('Done.');
}

main();
