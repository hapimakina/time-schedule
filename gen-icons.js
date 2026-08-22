// Generates simple clock-face PWA icons (PNG) without external dependencies.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(size, draw) {
  const width = size, height = size;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = draw(x, y, width, height);
      const off = rowStart + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  const idatData = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function mix(c1, c2, t) {
  return c1.map((v, i) => Math.round(v + (c2[i] - v) * t));
}

function drawIcon(x, y, w, h, opts) {
  const cx = w / 2, cy = h / 2;
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const bgColor = [79, 70, 229]; // indigo #4F46E5
  const bgColor2 = [99, 102, 241]; // #6366F1
  const cardRadius = w * (opts.maskable ? 0.5 : 0.46);
  const cornerRadius = opts.maskable ? 0 : w * 0.22;

  // rounded-square background using superellipse-ish distance
  let inBg = true;
  if (!opts.maskable) {
    const rx = Math.abs(dx), ry = Math.abs(dy);
    const half = w / 2 - 1;
    if (rx > half || ry > half) inBg = false;
    else {
      const cxr = half - cornerRadius, cyr = half - cornerRadius;
      if (rx > cxr && ry > cyr) {
        const ex = rx - cxr, ey = ry - cyr;
        if (Math.sqrt(ex * ex + ey * ey) > cornerRadius) inBg = false;
      }
    }
  } else {
    if (dist > w / 2) inBg = false;
  }

  if (!inBg) return [0, 0, 0, 0];

  const t = (x + y) / (w + h);
  const bg = mix(bgColor, bgColor2, t);

  // clock face (white circle)
  const faceR = w * 0.32;
  const ringR = w * 0.34;
  if (dist <= faceR) {
    // clock hands: hour hand pointing up-right, minute hand pointing right
    const angH = -Math.PI / 2 - Math.PI / 3.2; // hour hand angle
    const angM = -Math.PI / 2 + Math.PI / 1.15; // minute hand angle
    const lenH = faceR * 0.55, lenM = faceR * 0.8;
    const thick = w * 0.028;

    function distToSegment(px, py, ax, ay, bx, by) {
      const abx = bx - ax, aby = by - ay;
      const apx = px - ax, apy = py - ay;
      const abLen2 = abx * abx + aby * aby;
      let tt = abLen2 > 0 ? (apx * abx + apy * aby) / abLen2 : 0;
      tt = Math.max(0, Math.min(1, tt));
      const projx = ax + abx * tt, projy = ay + aby * tt;
      return Math.sqrt((px - projx) ** 2 + (py - projy) ** 2);
    }

    const hx = cx + Math.cos(angH) * lenH, hy = cy + Math.sin(angH) * lenH;
    const mx2 = cx + Math.cos(angM) * lenM, my2 = cy + Math.sin(angM) * lenM;

    const dHour = distToSegment(x, y, cx, cy, hx, hy);
    const dMin = distToSegment(x, y, cx, cy, mx2, my2);
    const dCenter = dist;

    if (dHour <= thick || dMin <= thick * 0.85 || dCenter <= thick * 1.3) {
      return [79, 70, 229, 255];
    }
    return [255, 255, 255, 255];
  } else if (dist <= ringR) {
    return [255, 255, 255, 255];
  }

  return [...bg, 255];
}

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { size: 192, name: 'icon-192.png', maskable: false },
  { size: 512, name: 'icon-512.png', maskable: false },
  { size: 512, name: 'icon-maskable-512.png', maskable: true },
  { size: 180, name: 'apple-touch-icon.png', maskable: false },
];

for (const t of targets) {
  const png = makePNG(t.size, (x, y, w, h) => drawIcon(x, y, w, h, { maskable: t.maskable }));
  fs.writeFileSync(path.join(outDir, t.name), png);
  console.log('wrote', t.name);
}
