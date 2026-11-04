import type { MaskDef, MaskOp } from './types';
import { blurChannel, radiusToBox } from './blur';

export interface Bounds {
  x0: number;
  y0: number;
  /** exclusive */
  x1: number;
  y1: number;
  /** 마스크 가중 중심 */
  cx: number;
  cy: number;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function apply(m: Float32Array, i: number, cov: number, mode: 'add' | 'sub') {
  if (mode === 'add') {
    if (cov > m[i]) m[i] = cov;
  } else {
    m[i] *= 1 - cov;
  }
}

export function fillPoly(m: Float32Array, w: number, h: number, pts: number[], mode: 'add' | 'sub') {
  const n = pts.length / 2;
  if (n < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minY = Math.min(minY, pts[i * 2 + 1]);
    maxY = Math.max(maxY, pts[i * 2 + 1]);
  }
  const ys = Math.max(0, Math.floor(minY));
  const ye = Math.min(h - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = ys; y <= ye; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const y1 = pts[i * 2 + 1];
      const y2 = pts[j * 2 + 1];
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
        const x1 = pts[i * 2];
        const x2 = pts[j * 2];
        xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = xs[k];
      const xb = xs[k + 1];
      const xStart = Math.max(0, Math.floor(xa));
      const xEnd = Math.min(w - 1, Math.floor(xb));
      for (let x = xStart; x <= xEnd; x++) {
        const cov = clamp(Math.min(x + 1, xb) - Math.max(x, xa), 0, 1);
        if (cov > 0) apply(m, y * w + x, cov, mode);
      }
    }
  }
}

function strokeSeg(m: Float32Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number, r: number, mode: 'add' | 'sub') {
  const minx = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1));
  const maxx = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + r + 1));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1));
  const maxy = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + r + 1));
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const t = len2 > 0 ? clamp((px * vx + py * vy) / len2, 0, 1) : 0;
      const dist = Math.hypot(px - t * vx, py - t * vy);
      const cov = clamp(r - dist + 0.5, 0, 1);
      if (cov > 0) apply(m, y * w + x, cov, mode);
    }
  }
}

function fillRect(m: Float32Array, w: number, h: number, x: number, y: number, rw: number, rh: number, mode: 'add' | 'sub') {
  const x1 = x + rw;
  const y1 = y + rh;
  for (let yy = Math.max(0, Math.floor(y)); yy <= Math.min(h - 1, Math.floor(y1)); yy++) {
    const cy = clamp(Math.min(yy + 1, y1) - Math.max(yy, y), 0, 1);
    for (let xx = Math.max(0, Math.floor(x)); xx <= Math.min(w - 1, Math.floor(x1)); xx++) {
      const cx = clamp(Math.min(xx + 1, x1) - Math.max(xx, x), 0, 1);
      const cov = cx * cy;
      if (cov > 0) apply(m, yy * w + xx, cov, mode);
    }
  }
}

function fillEllipse(m: Float32Array, w: number, h: number, x: number, y: number, ew: number, eh: number, mode: 'add' | 'sub') {
  const rx = ew / 2;
  const ry = eh / 2;
  if (rx <= 0 || ry <= 0) return;
  const cx = x + rx;
  const cy = y + ry;
  const mr = Math.min(rx, ry);
  for (let yy = Math.max(0, Math.floor(y) - 1); yy <= Math.min(h - 1, Math.ceil(y + eh) + 1); yy++) {
    for (let xx = Math.max(0, Math.floor(x) - 1); xx <= Math.min(w - 1, Math.ceil(x + ew) + 1); xx++) {
      const d = Math.hypot((xx + 0.5 - cx) / rx, (yy + 0.5 - cy) / ry);
      const cov = clamp((1 - d) * mr + 0.5, 0, 1);
      if (cov > 0) apply(m, yy * w + xx, cov, mode);
    }
  }
}

function applyOp(m: Float32Array, w: number, h: number, op: MaskOp) {
  switch (op.kind) {
    case 'poly':
      fillPoly(m, w, h, op.points, op.mode);
      break;
    case 'stroke': {
      const p = op.points;
      if (p.length === 2) strokeSeg(m, w, h, p[0], p[1], p[0], p[1], op.radius, op.mode);
      for (let i = 0; i + 3 < p.length; i += 2) strokeSeg(m, w, h, p[i], p[i + 1], p[i + 2], p[i + 3], op.radius, op.mode);
      break;
    }
    case 'rect':
      fillRect(m, w, h, op.x, op.y, op.w, op.h, op.mode);
      break;
    case 'ellipse':
      fillEllipse(m, w, h, op.x, op.y, op.w, op.h, op.mode);
      break;
    case 'region': {
      const r = op.runs;
      for (let i = 0; i + 2 < r.length; i += 3) {
        const y = r[i];
        if (y < 0 || y >= h) continue;
        const x0 = Math.max(0, r[i + 1]);
        const x1 = Math.min(w, r[i + 1] + r[i + 2]);
        for (let x = x0; x < x1; x++) apply(m, y * w + x, 1, op.mode);
      }
      break;
    }
  }
}

/** 연산 목록을 0..1 알파 마스크로 래스터화 (feather 적용) */
export function rasterizeMask(def: MaskDef, w: number, h: number): Float32Array {
  let m: Float32Array = new Float32Array(w * h);
  for (const op of def.ops) applyOp(m, w, h, op);
  if (def.feather > 0.5) {
    const r = radiusToBox(def.feather);
    m = blurChannel(m, w, h, r, r, 3);
  }
  if (def.invert) for (let i = 0; i < m.length; i++) m[i] = 1 - m[i];
  return m;
}

export function maskBounds(m: Float32Array, w: number, h: number, thresh = 0.02): Bounds | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = m[y * w + x];
      if (v > thresh) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        sw += v;
        sx += v * (x + 0.5);
        sy += v * (y + 0.5);
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1, cx: sx / sw, cy: sy / sw };
}

const cache = new WeakMap<MaskDef, { w: number; h: number; mask: Float32Array; bounds: Bounds | null }>();

/** MaskDef 객체가 바뀌지 않으면 래스터 결과를 재사용 (슬라이더 조절 시 빠르게) */
export function getMask(def: MaskDef, w: number, h: number) {
  const c = cache.get(def);
  if (c && c.w === w && c.h === h) return c;
  const mask = rasterizeMask(def, w, h);
  const entry = { w, h, mask, bounds: maskBounds(mask, w, h) };
  cache.set(def, entry);
  return entry;
}


/* ------------------------------------------------------------------ */
/* 픽셀 영역 <-> 런렝스, 확대/축소                                     */
/* ------------------------------------------------------------------ */

export function binaryToRuns(bin: Uint8Array, w: number, h: number): number[] {
  const runs: number[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (bin[y * w + x]) {
        const s = x;
        while (x < w && bin[y * w + x]) x++;
        runs.push(y, s, x - s);
      } else x++;
    }
  }
  return runs;
}

/** 이진 영역을 n 픽셀 확대(n>0) 또는 축소(n<0). 8방향/4방향을 번갈아 써서 원에 가깝게 만든다. */
export function growBinary(bin: Uint8Array, w: number, h: number, n: number): Uint8Array {
  let cur = bin;
  const grow = n > 0;
  const steps = Math.min(60, Math.abs(Math.round(n)));
  for (let s = 0; s < steps; s++) {
    const next = new Uint8Array(cur);
    const diag = s % 2 === 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = cur[i];
        if (grow ? v : !v) continue;
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || (!diag && dx !== 0 && dy !== 0)) continue;
            const xx = x + dx;
            const yy = y + dy;
            // 화면 밖은 "같은 값"으로 취급해 가장자리가 깎이지 않게 한다
            const nv = xx < 0 || yy < 0 || xx >= w || yy >= h ? (grow ? 0 : 1) : cur[yy * w + xx];
            if (grow ? nv : !nv) {
              hit = true;
              break;
            }
          }
        }
        if (hit) next[i] = grow ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

/** 현재 마스크 정의를 픽셀 영역 하나로 구워서 확대/축소한 새 정의를 만든다 */
export function growMaskDef(def: MaskDef, w: number, h: number, n: number): MaskDef {
  const m = rasterizeMask({ ops: def.ops, feather: 0 }, w, h);
  let bin: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) bin[i] = m[i] > 0.5 ? 1 : 0;
  bin = growBinary(bin, w, h, n);
  return { ...def, ops: [{ kind: 'region', mode: 'add', w, h, runs: binaryToRuns(bin, w, h) }] };
}
