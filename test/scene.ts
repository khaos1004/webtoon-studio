import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { RGBA } from '../src/lib/effects';
import type { Effect, MaskDef } from '../src/lib/types';

export const W = 900;
export const H = 600;
export const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
export function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
export const failures = () => failed;

/* ---------- 합성 장면 ---------- */
export function makeScene(): RGBA {
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * W + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 205 + (y / H) * 30, 230 + (y / H) * 15, 255); // 배경 그라디언트
  // 정지된 얼굴(왼쪽)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < 380; x++) {
      const d = Math.hypot(x - 200, y - 280);
      if (d < 110) set(x, y, 255, 217, 184);
      if (Math.hypot(x - 165, y - 260) < 9 || Math.hypot(x - 235, y - 260) < 9) set(x, y, 30, 30, 30);
    }
  // 콜라병(중앙) + 손
  for (let y = 140; y < 470; y++)
    for (let x = 460; x < 600; x++) {
      const neck = y < 230;
      const half = neck ? 18 : 62;
      if (Math.abs(x - 530) < half) set(x, y, y > 310 && y < 390 ? 200 : 58, y > 310 && y < 390 ? 30 : 28, y > 310 && y < 390 ? 30 : 18);
    }
  for (let y = 360; y < 480; y++)
    for (let x = 440; x < 640; x++) {
      if (Math.hypot((x - 540) / 90, (y - 420) / 52) < 1) set(x, y, 240, 190, 150);
    }
  return { data, width: W, height: H };
}

/** 손 + 콜라를 감싸는 올가미(다각형) */
export const lasso: MaskDef = {
  feather: 2,
  ops: [
    {
      kind: 'poly',
      mode: 'add',
      points: [452, 130, 608, 130, 606, 330, 650, 420, 640, 485, 440, 485, 432, 420, 456, 330],
    },
  ],
};

export async function save(img: RGBA, name: string) {
  await sharp(Buffer.from(img.data.buffer), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png()
    .toFile(path.join(OUT, name));
}

export function diffCount(a: RGBA, b: RGBA, x0: number, y0: number, x1: number, y1: number, tol = 1) {
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) n++;
    }
  return n;
}

export function withMask(e: Effect, mask: MaskDef = lasso): Effect {
  return { ...e, mask };
}

