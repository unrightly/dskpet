'use strict';

/**
 * 生成应用 / 托盘图标（纯 Node，无第三方依赖）。
 * 输出：assets/icon.png（256x256，透明背景的奶油色猫头）
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_SIZE = 256;
const SS = 2; // 2x 超采样
const SIZE = OUT_SIZE * SS;
const CX = SIZE / 2;

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function render() {
  const w = SIZE;
  const h = SIZE;
  const buf = Buffer.alloc(w * h * 4, 0);

  const headCx = CX;
  const headCy = SIZE * 0.57;
  const headR = SIZE * 0.29;
  const outlineR = headR + SIZE * 0.018;

  const furTop = [255, 253, 248];
  const furBottom = [243, 216, 184];
  const outline = [231, 199, 161];
  const earInner = [246, 192, 192];
  const eyeColor = [61, 45, 41];
  const blush = [250, 205, 202];
  const nose = [226, 143, 146];

  const earL = [
    [SIZE * 0.295, SIZE * 0.45],
    [SIZE * 0.275, SIZE * 0.17],
    [SIZE * 0.49, SIZE * 0.35]
  ];
  const earR = [
    [SIZE * 0.705, SIZE * 0.45],
    [SIZE * 0.725, SIZE * 0.17],
    [SIZE * 0.51, SIZE * 0.35]
  ];
  const innerL = [
    [SIZE * 0.32, SIZE * 0.42],
    [SIZE * 0.305, SIZE * 0.245],
    [SIZE * 0.452, SIZE * 0.355]
  ];
  const innerR = [
    [SIZE * 0.68, SIZE * 0.42],
    [SIZE * 0.695, SIZE * 0.245],
    [SIZE * 0.548, SIZE * 0.355]
  ];

  const eyeY = SIZE * 0.575;
  const eyeL = [SIZE * 0.395, eyeY];
  const eyeR = [SIZE * 0.605, eyeY];
  const eyeR2 = SIZE * 0.066;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let color = null;
      let alpha = 0;

      const inEar = pointInTriangle(x, y, ...earL) || pointInTriangle(x, y, ...earR);
      const inInner = pointInTriangle(x, y, ...innerL) || pointInTriangle(x, y, ...innerR);

      if (inEar) {
        color = inInner ? earInner : mix(furTop, furBottom, Math.min(1, y / (SIZE * 0.7)));
        alpha = 255;
      }

      const dx = x - headCx;
      const dy = y - headCy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= headR) {
        color = mix(furTop, furBottom, Math.min(1, (y - SIZE * 0.3) / (SIZE * 0.5)));
        alpha = 255;
      } else if (dist <= outlineR) {
        color = outline;
        alpha = 255;
      }

      if (alpha) {
        // eyes
        for (const eye of [eyeL, eyeR]) {
          const edx = x - eye[0];
          const edy = y - eye[1];
          if (edx * edx + edy * edy <= eyeR2 * eyeR2) {
            color = eyeColor;
            alpha = 255;
          }
          const hx = x - (eye[0] - eyeR2 * 0.32);
          const hy = y - (eye[1] - eyeR2 * 0.38);
          const hr = eyeR2 * 0.34;
          if (hx * hx + hy * hy <= hr * hr) {
            color = [255, 250, 240];
            alpha = 255;
          }
        }

        // blush
        for (const bx of [SIZE * 0.305, SIZE * 0.695]) {
          const bdx = (x - bx) / (SIZE * 0.06);
          const bdy = (y - SIZE * 0.675) / (SIZE * 0.035);
          if (bdx * bdx + bdy * bdy <= 1) {
            color = blush;
            alpha = 255;
          }
        }

        // nose
        if (pointInTriangle(x, y, CX - SIZE * 0.022, SIZE * 0.645, CX + SIZE * 0.022, SIZE * 0.645, CX, SIZE * 0.675)) {
          color = nose;
          alpha = 255;
        }
      }

      if (color) {
        const i = (y * w + x) * 4;
        buf[i] = color[0];
        buf[i + 1] = color[1];
        buf[i + 2] = color[2];
        buf[i + 3] = alpha;
      }
    }
  }
  return buf;
}

function downsample(src, srcSize, dstSize) {
  const out = Buffer.alloc(dstSize * dstSize * 4, 0);
  const factor = srcSize / dstSize;
  for (let y = 0; y < dstSize; y += 1) {
    for (let x = 0; x < dstSize; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = ((y * factor + sy) * srcSize + (x * factor + sx)) * 4;
          const alpha = src[i + 3] / 255;
          r += src[i] * alpha;
          g += src[i + 1] * alpha;
          b += src[i + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }
      const o = (y * dstSize + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round((a / count) * 255);
    }
  }
  return out;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const big = render();
const small = downsample(big, SIZE, OUT_SIZE);
const png = encodePng(small, OUT_SIZE);

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'icon.png');
fs.writeFileSync(outFile, png);
console.log(`icon written: ${outFile} (${png.length} bytes)`);
