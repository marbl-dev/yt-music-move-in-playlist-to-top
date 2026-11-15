// Generates icons/icon{16,32,48,128}.png and icons/icon.svg with no dependencies.
// Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];
const SS = 8; // supersampling per axis

// ---- design, in a 128x128 coordinate space ----
const BG = { x: 4, y: 4, w: 120, h: 120, r: 28 };
const TOP = [0xff, 0x6a, 0x4d]; // coral
const BOTTOM = [0xc2, 0x18, 0x5b]; // magenta
const BAR = { x1: 32, x2: 96, y: 32, half: 7 }; // rounded line, the "top" of the list
const HEAD = [[64, 47], [28, 83], [100, 83]]; // arrow head
const STEM = { x: 53, y: 80, w: 22, h: 26, r: 4 }; // arrow stem

function inRoundRect(px, py, { x, y, w, h, r }) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function inCapsule(px, py, { x1, x2, y, half }) {
  const cx = Math.min(Math.max(px, x1), x2);
  return (px - cx) ** 2 + (py - y) ** 2 <= half * half;
}

function inTriangle(px, py, [[ax, ay], [bx, by], [cx, cy]]) {
  const s = (x1, y1, x2, y2) => (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const d1 = s(ax, ay, bx, by), d2 = s(bx, by, cx, cy), d3 = s(cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

const inGlyph = (x, y) => inCapsule(x, y, BAR) || inTriangle(x, y, HEAD) || inRoundRect(x, y, STEM);

function render(size) {
  const scale = 128 / size;
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let bg = 0, glyph = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const x = (i + (si + 0.5) / SS) * scale;
          const y = (j + (sj + 0.5) / SS) * scale;
          if (inRoundRect(x, y, BG)) {
            bg++;
            if (inGlyph(x, y)) glyph++;
          }
        }
      }
      const n = SS * SS;
      const t = Math.min(Math.max(((j + 0.5) * scale - BG.y) / BG.h, 0), 1);
      const g = bg ? glyph / bg : 0;
      const o = (j * size + i) * 4;
      for (let c = 0; c < 3; c++) {
        const base = TOP[c] + (BOTTOM[c] - TOP[c]) * t;
        px[o + c] = Math.round(base + (255 - base) * g);
      }
      px[o + 3] = Math.round((bg / n) * 255);
    }
  }
  return px;
}

// ---- minimal PNG encoder ----
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- SVG source (same geometry) ----
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${hex(TOP)}"/>
      <stop offset="1" stop-color="${hex(BOTTOM)}"/>
    </linearGradient>
  </defs>
  <rect x="${BG.x}" y="${BG.y}" width="${BG.w}" height="${BG.h}" rx="${BG.r}" fill="url(#g)"/>
  <g fill="#fff">
    <line x1="${BAR.x1}" y1="${BAR.y}" x2="${BAR.x2}" y2="${BAR.y}" stroke="#fff" stroke-width="${BAR.half * 2}" stroke-linecap="round"/>
    <polygon points="${HEAD.map((p) => p.join(',')).join(' ')}"/>
    <rect x="${STEM.x}" y="${STEM.y}" width="${STEM.w}" height="${STEM.h}" rx="${STEM.r}"/>
  </g>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), svg);
for (const s of SIZES) writeFileSync(join(OUT, `icon${s}.png`), png(s, render(s)));
console.log('Wrote', SIZES.map((s) => `icon${s}.png`).join(', '), '+ icon.svg to', OUT);
