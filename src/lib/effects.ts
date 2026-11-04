import type { BlendMode, Effect, EffectParams } from './types';
import { getMaterial } from './materials';
import { blurChannel, radiusToBox } from './blur';
import { fillPoly, type Bounds } from './mask';

export interface RGBA {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export const cloneRGBA = (s: RGBA): RGBA => ({ data: new Uint8ClampedArray(s.data), width: s.width, height: s.height });

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const RAD = Math.PI / 180;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
}

/* ------------------------------------------------------------------ */
/* 물체 버퍼: 선택한 픽셀(프리멀티플라이드)만 따로 떼어 둔 작은 창        */
/* ------------------------------------------------------------------ */

interface Obj {
  x0: number;
  y0: number;
  w: number;
  h: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  a: Float32Array;
}

function makeObj(src: RGBA, mask: Float32Array, b: Bounds, reach: number): Obj {
  const x0 = Math.max(0, Math.floor(b.x0 - reach));
  const y0 = Math.max(0, Math.floor(b.y0 - reach));
  const x1 = Math.min(src.width, Math.ceil(b.x1 + reach));
  const y1 = Math.min(src.height, Math.ceil(b.y1 + reach));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const o: Obj = { x0, y0, w, h, r: new Float32Array(w * h), g: new Float32Array(w * h), b: new Float32Array(w * h), a: new Float32Array(w * h) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gi = (y0 + y) * src.width + (x0 + x);
      const m = mask[gi];
      if (m <= 0) continue;
      const i = y * w + x;
      const q = gi * 4;
      o.r[i] = src.data[q] * m;
      o.g[i] = src.data[q + 1] * m;
      o.b[i] = src.data[q + 2] * m;
      o.a[i] = m;
    }
  }
  return o;
}

function blurObj(o: Obj, radius: number): Obj {
  if (radius < 0.5) return o;
  const r = radiusToBox(radius);
  return {
    ...o,
    r: blurChannel(o.r, o.w, o.h, r, r, 3),
    g: blurChannel(o.g, o.w, o.h, r, r, 3),
    b: blurChannel(o.b, o.w, o.h, r, r, 3),
    a: blurChannel(o.a, o.w, o.h, r, r, 3),
  };
}

/** 물체 버퍼를 전역 좌표(gx, gy)에서 쌍선형 샘플 → acc[r,g,b,a] (프리멀티플라이드) */
function sampleObj(o: Obj, gx: number, gy: number) {
  const fx0 = gx - o.x0 - 0.5;
  const fy0 = gy - o.y0 - 0.5;
  const x0 = Math.floor(fx0);
  const y0 = Math.floor(fy0);
  const fx = fx0 - x0;
  const fy = fy0 - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= o.h) continue;
    const wy = j ? fy : 1 - fy;
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      if (xx < 0 || xx >= o.w) continue;
      const wgt = (i ? fx : 1 - fx) * wy;
      const k = yy * o.w + xx;
      r += o.r[k] * wgt;
      g += o.g[k] * wgt;
      b += o.b[k] * wgt;
      a += o.a[k] * wgt;
    }
  }
  acc[0] = r;
  acc[1] = g;
  acc[2] = b;
  acc[3] = a;
}

const acc = new Float32Array(4);

/** 이미지(src) 쌍선형 샘플 → acc[r,g,b] */
function sampleImg(src: RGBA, gx: number, gy: number) {
  const W = src.width;
  const H = src.height;
  const fx0 = gx - 0.5;
  const fy0 = gy - 0.5;
  const x0 = Math.floor(fx0);
  const y0 = Math.floor(fy0);
  const fx = fx0 - x0;
  const fy = fy0 - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let j = 0; j < 2; j++) {
    const yy = clamp(y0 + j, 0, H - 1);
    const wy = j ? fy : 1 - fy;
    for (let i = 0; i < 2; i++) {
      const xx = clamp(x0 + i, 0, W - 1);
      const wgt = (i ? fx : 1 - fx) * wy;
      const q = (yy * W + xx) * 4;
      r += src.data[q] * wgt;
      g += src.data[q + 1] * wgt;
      b += src.data[q + 2] * wgt;
    }
  }
  acc[0] = r;
  acc[1] = g;
  acc[2] = b;
}

/* ------------------------------------------------------------------ */
/* 흔들림 / 잔상: 선택 영역의 실제 픽셀을 복제·이동·회전해서 겹친다    */
/* ------------------------------------------------------------------ */

interface Ghost {
  dx: number;
  dy: number;
  rot: number;
  a: number;
  tint: number;
}

function drawGhost(out: RGBA, o: Obj, b: Bounds, g: Ghost, tintRgb: [number, number, number]) {
  const W = out.width;
  const H = out.height;
  const rad = g.rot * RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { cx, cy } = b;
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const [px, py] of [
    [o.x0, o.y0],
    [o.x0 + o.w, o.y0],
    [o.x0, o.y0 + o.h],
    [o.x0 + o.w, o.y0 + o.h],
  ]) {
    const rx = cx + (px - cx) * cos - (py - cy) * sin + g.dx;
    const ry = cy + (px - cx) * sin + (py - cy) * cos + g.dy;
    minx = Math.min(minx, rx);
    maxx = Math.max(maxx, rx);
    miny = Math.min(miny, ry);
    maxy = Math.max(maxy, ry);
  }
  const xs = Math.max(0, Math.floor(minx) - 1);
  const xe = Math.min(W - 1, Math.ceil(maxx) + 1);
  const ys = Math.max(0, Math.floor(miny) - 1);
  const ye = Math.min(H - 1, Math.ceil(maxy) + 1);
  const od = out.data;
  for (let y = ys; y <= ye; y++) {
    for (let x = xs; x <= xe; x++) {
      const qx = x + 0.5 - g.dx - cx;
      const qy = y + 0.5 - g.dy - cy;
      sampleObj(o, cx + qx * cos + qy * sin, cy - qx * sin + qy * cos);
      const pa = acc[3];
      if (pa <= 0.002) continue;
      const A = clamp(pa * g.a, 0, 1);
      const p = (y * W + x) * 4;
      let r = acc[0] / pa;
      let gg = acc[1] / pa;
      let bb = acc[2] / pa;
      if (g.tint > 0) {
        r += (tintRgb[0] - r) * g.tint;
        gg += (tintRgb[1] - gg) * g.tint;
        bb += (tintRgb[2] - bb) * g.tint;
      }
      od[p] += (r - od[p]) * A;
      od[p + 1] += (gg - od[p + 1]) * A;
      od[p + 2] += (bb - od[p + 2]) * A;
    }
  }
}

function ghosts(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams, mode: 'shake' | 'trail'): RGBA {
  const out = cloneRGBA(src);
  const rand = mulberry32(p.seed);
  const dirx = Math.cos(p.angle * RAD);
  const diry = Math.sin(p.angle * RAD);
  const n = Math.max(1, Math.round(p.count));
  const list: Ghost[] = [];
  const fall = clamp(p.falloff, 0, 1);
  const tint = clamp(p.tint, 0, 1);
  if (mode === 'trail') {
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      list.push({ dx: -dirx * p.distance * t, dy: -diry * p.distance * t, rot: -p.rotation * t, a: p.strength * (1 - fall * (t - 1 / n) / (1 - 1 / n + 1e-6) * 0.92), tint: tint * t });
    }
  } else if (p.style === 'line') {
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      for (const s of [1, -1]) {
        list.push({ dx: s * dirx * p.distance * t, dy: s * diry * p.distance * t, rot: s * p.rotation * t, a: p.strength * (1 - fall * 0.8 * t) * 0.9, tint: tint * t });
      }
    }
  } else {
    for (let k = 0; k < n * 2; k++) {
      const ang = rand() * Math.PI * 2;
      const rad = Math.sqrt(rand()) * p.distance;
      list.push({ dx: Math.cos(ang) * rad, dy: Math.sin(ang) * rad, rot: (rand() * 2 - 1) * p.rotation, a: p.strength * (0.45 + 0.4 * rand()), tint: tint * rand() });
    }
  }
  list.sort((a, c) => a.a - c.a);
  const reach = p.distance * 1.1 + Math.abs(p.rotation) * 4 + p.soft * 2 + 4;
  const obj = blurObj(makeObj(src, mask, b, reach), p.soft);
  const tintRgb = hexToRgb(p.tintColor);
  for (const g of list) drawGhost(out, obj, b, g, tintRgb);

  // 원본 물체를 맨 위에 다시 올린다
  const W = src.width;
  const o = out.data;
  const s = src.data;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i];
      if (m <= 0) continue;
      const q = i * 4;
      o[q] = o[q] * (1 - m) + s[q] * m;
      o[q + 1] = o[q + 1] * (1 - m) + s[q + 1] * m;
      o[q + 2] = o[q + 2] * (1 - m) + s[q + 2] * m;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 방향성 모션 블러                                                    */
/*  1) 선택한 물체만 떼어 경로를 따라 번지게 한다(가중 평균)            */
/*  2) 물체가 있던 자리는 주변 배경색으로 메운다(정규화 컨볼루션)         */
/*  3) 번진 물체를 그 위에 올린다 → 가장자리에 원본이 비쳐 보이지 않음   */
/* ------------------------------------------------------------------ */

function fillBackground(src: RGBA, mask: Float32Array, x0: number, y0: number, w: number, h: number, radius: number) {
  const n = w * h;
  const wm = new Float32Array(n);
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gi = (y0 + y) * src.width + (x0 + x);
      const wgt = clamp(1 - mask[gi] * 1.6, 0, 1);
      const i = y * w + x;
      wm[i] = wgt;
      ch[0][i] = src.data[gi * 4] * wgt;
      ch[1][i] = src.data[gi * 4 + 1] * wgt;
      ch[2][i] = src.data[gi * 4 + 2] * wgt;
    }
  }
  const run = (r: number) => ({ w: blurChannel(wm, w, h, r, r, 3), c: ch.map((c) => blurChannel(c, w, h, r, r, 3)) });
  const r1 = radiusToBox(radius);
  const a = run(r1);
  const bigger = run(Math.max(r1 * 3, r1 + 6));
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const wa = a.w[i];
    const wb = bigger.w[i];
    const gi = (y0 + ((i / w) | 0)) * src.width + x0 + (i % w);
    const t = clamp(wa / 0.2, 0, 1);
    for (let c = 0; c < 3; c++) {
      const vb = wb > 0.004 ? bigger.c[c][i] / wb : src.data[gi * 4 + c];
      const va = wa > 0.04 ? a.c[c][i] / wa : vb;
      out[c][i] = vb * (1 - t) + va * t;
    }
  }
  return out;
}

function motionBlur(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const L = Math.max(1, p.distance);
  const dirx = Math.cos(p.angle * RAD);
  const diry = Math.sin(p.angle * RAD);
  const reach = L + 2;
  const o = makeObj(src, mask, b, reach);
  // 영역이 아주 넓으면(배경 전체 등) 샘플 수를 줄여 미리보기 속도를 지킨다
  const taps = clamp(Math.min(Math.round(L * 0.9) + 3, Math.floor(36e6 / (o.w * o.h))), 5, 100);
  const fill = fillBackground(src, mask, o.x0, o.y0, o.w, o.h, clamp(L * 0.5, 6, 40));
  const fall = clamp(p.falloff, 0, 1);
  const wts = new Float32Array(taps);
  const offs = new Float32Array(taps);
  let wsum = 0;
  for (let k = 0; k < taps; k++) {
    const t = k / (taps - 1);
    offs[k] = p.oneSided ? L * t : L * (t - 0.5);
    wts[k] = p.oneSided ? 1 - fall * t * 0.95 : 1 - Math.abs(2 * t - 1) * 0.55;
    wsum += wts[k];
  }
  const S = clamp(p.strength, 0, 1);
  const od = out.data;
  const sd = src.data;
  for (let y = 0; y < o.h; y++) {
    for (let x = 0; x < o.w; x++) {
      const gx = o.x0 + x + 0.5;
      const gy = o.y0 + y + 0.5;
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let k = 0; k < taps; k++) {
        sampleObj(o, gx + dirx * offs[k], gy + diry * offs[k]);
        const w = wts[k];
        pr += acc[0] * w;
        pg += acc[1] * w;
        pb += acc[2] * w;
        pa += acc[3] * w;
      }
      pr /= wsum;
      pg /= wsum;
      pb /= wsum;
      pa /= wsum;
      const gi = (o.y0 + y) * W + (o.x0 + x);
      const q = gi * 4;
      const m = mask[gi];
      const li = y * o.w + x;
      // 물체가 있던 자리는 배경으로 메우고, 번진 물체를 올린다
      const br = sd[q] * (1 - m) + fill[0][li] * m;
      const bg = sd[q + 1] * (1 - m) + fill[1][li] * m;
      const bb = sd[q + 2] * (1 - m) + fill[2][li] * m;
      const rr = br * (1 - pa) + pr;
      const rg = bg * (1 - pa) + pg;
      const rb = bb * (1 - pa) + pb;
      od[q] = sd[q] + (rr - sd[q]) * S;
      od[q + 1] = sd[q + 1] + (rg - sd[q + 1]) * S;
      od[q + 2] = sd[q + 2] + (rb - sd[q + 2]) * S;
    }
  }
  if (p.sharp > 0) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i = y * W + x;
        const m = mask[i] * p.sharp;
        if (m <= 0) continue;
        const q = i * 4;
        od[q] = od[q] * (1 - m) + sd[q] * m;
        od[q + 1] = od[q + 1] * (1 - m) + sd[q + 1] * m;
        od[q + 2] = od[q + 2] * (1 - m) + sd[q + 2] * m;
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 일반 블러 / 색 보정 / 망점 / 빛                                     */
/* ------------------------------------------------------------------ */

function splitRGB(src: RGBA): Float32Array[] {
  const n = src.width * src.height;
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const d = src.data;
  for (let i = 0; i < n; i++) {
    ch[0][i] = d[i * 4];
    ch[1][i] = d[i * 4 + 1];
    ch[2][i] = d[i * 4 + 2];
  }
  return ch;
}

function gaussian(src: RGBA, mask: Float32Array, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const H = src.height;
  const r = radiusToBox(p.blur);
  const ch = splitRGB(src).map((c) => blurChannel(c, W, H, r, r, 3));
  const o = out.data;
  for (let i = 0; i < W * H; i++) {
    const m = mask[i] * p.strength;
    if (m <= 0) continue;
    o[i * 4] = o[i * 4] * (1 - m) + ch[0][i] * m;
    o[i * 4 + 1] = o[i * 4 + 1] * (1 - m) + ch[1][i] * m;
    o[i * 4 + 2] = o[i * 4 + 2] * (1 - m) + ch[2][i] * m;
  }
  return out;
}

function colorAdjust(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const o = out.data;
  const hue = p.hue * RAD;
  const c = Math.cos(hue);
  const s = Math.sin(hue);
  const hm = [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i] * p.strength;
      if (m <= 0) continue;
      const q = i * 4;
      let r = o[q];
      let g = o[q + 1];
      let bl = o[q + 2];
      if (p.mode === 'gray') {
        r = g = bl = 0.299 * r + 0.587 * g + 0.114 * bl;
      } else if (p.mode === 'sepia') {
        const nr = 0.393 * r + 0.769 * g + 0.189 * bl;
        const ng = 0.349 * r + 0.686 * g + 0.168 * bl;
        const nb = 0.272 * r + 0.534 * g + 0.131 * bl;
        r = nr;
        g = ng;
        bl = nb;
      } else if (p.mode === 'invert') {
        r = 255 - r;
        g = 255 - g;
        bl = 255 - bl;
      }
      if (p.hue !== 0) {
        const nr = hm[0] * r + hm[1] * g + hm[2] * bl;
        const ng = hm[3] * r + hm[4] * g + hm[5] * bl;
        const nb = hm[6] * r + hm[7] * g + hm[8] * bl;
        r = nr;
        g = ng;
        bl = nb;
      }
      const l = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = l + (r - l) * p.saturation;
      g = l + (g - l) * p.saturation;
      bl = l + (bl - l) * p.saturation;
      r = (r - 128) * p.contrast + 128 + p.brightness * 2.55;
      g = (g - 128) * p.contrast + 128 + p.brightness * 2.55;
      bl = (bl - 128) * p.contrast + 128 + p.brightness * 2.55;
      o[q] = o[q] * (1 - m) + clamp(r, 0, 255) * m;
      o[q + 1] = o[q + 1] * (1 - m) + clamp(g, 0, 255) * m;
      o[q + 2] = o[q + 2] * (1 - m) + clamp(bl, 0, 255) * m;
    }
  }
  return out;
}

function halftone(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const o = out.data;
  const [cr, cg, cb] = hexToRgb(p.color === '#ffffff' ? '#000000' : p.color);
  const cell = Math.max(2, p.dot);
  const th = p.dotAngle * RAD;
  const ct = Math.cos(th);
  const st = Math.sin(th);
  const ga = p.angle * RAD;
  const gx = Math.cos(ga);
  const gy = Math.sin(ga);
  const span = Math.max(1, Math.abs((b.x1 - b.x0) * gx) + Math.abs((b.y1 - b.y0) * gy));
  const stip = Math.max(1.5, cell / 2.6);
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i] * p.strength;
      if (m <= 0) continue;
      const q = i * 4;
      let dark: number;
      if (p.toneSource === 'flat') dark = p.density;
      else if (p.toneSource === 'gradient') dark = p.density * clamp(((x - b.cx) * gx + (y - b.cy) * gy) / span + 0.5, 0, 1);
      else dark = 1 - (0.299 * o[q] + 0.587 * o[q + 1] + 0.114 * o[q + 2]) / 255;
      dark = clamp(dark, 0, 1);
      const u = ((x + 0.5) * ct + (y + 0.5) * st) / cell;
      const v = (-(x + 0.5) * st + (y + 0.5) * ct) / cell;
      let ink: number;
      if (p.tone === 'line') {
        ink = clamp((dark / 2 - Math.abs(v - Math.floor(v) - 0.5)) * cell + 0.5, 0, 1);
      } else if (p.tone === 'cross') {
        const k = dark * 0.62;
        const a = clamp((k / 2 - Math.abs(v - Math.floor(v) - 0.5)) * cell + 0.5, 0, 1);
        const c = clamp((k / 2 - Math.abs(u - Math.floor(u) - 0.5)) * cell + 0.5, 0, 1);
        ink = Math.max(a, c);
      } else if (p.tone === 'stipple') {
        ink = hash2(Math.floor(x / stip), Math.floor(y / stip), p.seed) < Math.pow(dark, 1.15) ? 1 : 0;
      } else {
        const d = Math.hypot(u - Math.floor(u) - 0.5, v - Math.floor(v) - 0.5);
        ink = clamp((Math.sqrt(dark) * 0.7071 - d) * cell + 0.5, 0, 1);
      }
      const nr = 255 + (cr - 255) * ink;
      const ng = 255 + (cg - 255) * ink;
      const nb = 255 + (cb - 255) * ink;
      o[q] = o[q] * (1 - m) + nr * m;
      o[q + 1] = o[q + 1] * (1 - m) + ng * m;
      o[q + 2] = o[q + 2] * (1 - m) + nb * m;
    }
  }
  return out;
}

function glow(src: RGBA, mask: Float32Array, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const H = src.height;
  const n = W * H;
  const d = src.data;
  const thr = clamp(p.threshold, 0, 254);
  const em = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const m = mask[i];
    if (m <= 0) continue;
    const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const k = clamp((lum - thr) / (255 - thr), 0, 1) * m;
    em[0][i] = d[i * 4] * k;
    em[1][i] = d[i * 4 + 1] * k;
    em[2][i] = d[i * 4 + 2] * k;
  }
  const r = radiusToBox(p.blur);
  const wide = em.map((c) => blurChannel(c, W, H, r, r, 3));
  const tight = em.map((c) => blurChannel(c, W, H, Math.max(1, Math.round(r / 3)), Math.max(1, Math.round(r / 3)), 2));
  const o = out.data;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const g = (wide[c][i] * 0.8 + tight[c][i] * 0.6) * p.strength * 1.6;
      const base = o[i * 4 + c];
      // 스크린 합성
      o[i * 4 + c] = 255 - ((255 - base) * (255 - clamp(g, 0, 255))) / 255;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 속도선 / 집중선: 선 레이어를 만들고 영역으로 잘라서 합성             */
/* ------------------------------------------------------------------ */

function drawTaperLine(layer: Float32Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number, width: number, taper: 'both' | 'tip') {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1) return;
  const minx = Math.max(0, Math.floor(Math.min(x0, x1) - width - 1));
  const maxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + width + 1));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1) - width - 1));
  const maxy = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + width + 1));
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const t = clamp((px * vx + py * vy) / len2, 0, 1);
      const dist = Math.hypot(px - t * vx, py - t * vy);
      const wd = taper === 'both' ? width * Math.sin(Math.PI * t) : width * t;
      const cov = clamp(wd / 2 - dist + 0.5, 0, 1) * clamp(wd * 2, 0, 1);
      const idx = y * W + x;
      if (cov > layer[idx]) layer[idx] = cov;
    }
  }
}

function compositeLayer(out: RGBA, layer: Float32Array, region: Float32Array, color: string, strength: number) {
  const [cr, cg, cb] = hexToRgb(color);
  const o = out.data;
  for (let i = 0; i < layer.length; i++) {
    const a = layer[i] * region[i] * strength;
    if (a <= 0) continue;
    const q = i * 4;
    o[q] = o[q] * (1 - a) + cr * a;
    o[q + 1] = o[q + 1] * (1 - a) + cg * a;
    o[q + 2] = o[q + 2] * (1 - a) + cb * a;
  }
}

function speedLines(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const W = src.width;
  const H = src.height;
  const out = cloneRGBA(src);
  let layer: Float32Array = new Float32Array(W * H);
  const rand = mulberry32(p.seed);
  const base = p.angle * RAD;
  const half = Math.hypot(b.x1 - b.x0, b.y1 - b.y0) / 2 + p.spread;
  // 실제 속도선처럼 몇 개의 다발로 모인다: 다발 중심 주변에 촘촘하게, 일부는 흩어져서
  const bundles = Math.max(3, Math.round(p.lineCount / 9));
  const centers = Array.from({ length: bundles }, () => (rand() * 2 - 1) * half);
  for (let i = 0; i < p.lineCount; i++) {
    const a = base + (rand() - 0.5) * 0.045; // 선마다 ±1.3° 흔들림
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = -dy;
    const py = dx;
    const u = rand() < 0.72 ? clamp(centers[Math.floor(rand() * bundles)] + (rand() + rand() - 1) * half * 0.16, -half, half) : (rand() * 2 - 1) * half;
    const len = p.lineLength * (0.3 + 0.7 * rand() * rand() + 0.25 * rand());
    const s0 = (rand() * 2 - 1) * half - len / 2;
    const x0 = b.cx + dx * s0 + px * u;
    const y0 = b.cy + dy * s0 + py * u;
    const w = p.lineWidth * (p.lineStyle === 'thick-thin' ? (i % 3 === 0 ? 1.9 : 0.55) : 0.55 + 0.9 * rand());
    // burst: 진행 방향 앞쪽이 굵고 뒤로 가늘게 끌리는 혜성 모양
    drawTaperLine(layer, W, H, x0, y0, x0 + dx * len, y0 + dy * len, w, p.lineStyle === 'burst' ? 'tip' : 'both');
  }
  if (p.soft > 0.4) {
    const r = radiusToBox(p.soft);
    layer = blurChannel(layer, W, H, r, r, 2);
  }
  let region: Float32Array = mask;
  if (p.avoidObject) {
    const r = radiusToBox(p.spread);
    const d = blurChannel(mask, W, H, r, r, 2);
    region = new Float32Array(W * H);
    for (let i = 0; i < region.length; i++) region[i] = clamp(d[i] * 3, 0, 1) * (1 - clamp(mask[i] * 1.5, 0, 1));
  }
  compositeLayer(out, layer, region, p.color, p.strength);
  return out;
}

function center(b: Bounds, p: EffectParams): [number, number] {
  return p.useCenter ? [p.centerX, p.centerY] : [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
}

function focusLines(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const W = src.width;
  const H = src.height;
  const out = cloneRGBA(src);
  const layer = new Float32Array(W * H);
  const rand = mulberry32(p.seed);
  const [cx, cy] = center(b, p);
  const R = Math.max(Math.hypot(b.x1 - cx, b.y1 - cy), Math.hypot(b.x0 - cx, b.y0 - cy), Math.hypot(b.x1 - cx, b.y0 - cy), Math.hypot(b.x0 - cx, b.y1 - cy));
  const n = Math.max(1, Math.round(p.lineCount));
  for (let i = 0; i < n; i++) {
    const ang = ((i + rand() * 0.8) / n) * Math.PI * 2;
    const r0 = p.innerRadius * R * (0.9 + 0.2 * rand());
    const r1 = R * (1.02 + 0.2 * rand());
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const wj = 0.5 + rand();
    if (p.lineStyle === 'burst') {
      // 바깥이 넓고 안쪽이 뾰족한 삼각형 (폭발 느낌)
      const half = (Math.PI / n) * (0.25 + 0.7 * rand()) ;
      const pts = [cx + cs * r0, cy + sn * r0, cx + Math.cos(ang - half) * r1, cy + Math.sin(ang - half) * r1, cx + Math.cos(ang + half) * r1, cy + Math.sin(ang + half) * r1];
      fillPoly(layer, W, H, pts, 'add');
    } else {
      const w = p.lineStyle === 'thick-thin' ? p.lineWidth * (i % 2 ? 0.45 : 1.9) * wj : p.lineWidth * wj;
      drawTaperLine(layer, W, H, cx + cs * r0, cy + sn * r0, cx + cs * r1, cy + sn * r1, w, 'tip');
    }
  }
  compositeLayer(out, layer, mask, p.color, p.strength);
  return out;
}

/* ------------------------------------------------------------------ */
/* 줌 블러 / 색수차 / 글리치 / 파동 : 선택 영역 안의 픽셀을 변형        */
/* ------------------------------------------------------------------ */

const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

function zoomBlur(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const [cx, cy] = center(b, p);
  const R = Math.max(Math.hypot(b.x1 - cx, b.y1 - cy), Math.hypot(b.x0 - cx, b.y0 - cy), Math.hypot(b.x1 - cx, b.y0 - cy), Math.hypot(b.x0 - cx, b.y1 - cy), 1);
  const inner = p.innerRadius * R;
  const span = clamp(p.amount, 0, 1) * 0.45;
  const taps = 26;
  const o = out.data;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i] * p.strength;
      if (m <= 0) continue;
      const vx = x + 0.5 - cx;
      const vy = y + 0.5 - cy;
      const k = smooth(inner, inner + (R - inner) * 0.6 + 1, Math.hypot(vx, vy));
      if (k <= 0.001) continue;
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let t = 0; t < taps; t++) {
        const sc = 1 - span * k * (t / (taps - 1));
        sampleImg(src, cx + vx * sc, cy + vy * sc);
        r += acc[0];
        g += acc[1];
        bl += acc[2];
      }
      const q = i * 4;
      const mm = m;
      o[q] = o[q] * (1 - mm) + (r / taps) * mm;
      o[q + 1] = o[q + 1] * (1 - mm) + (g / taps) * mm;
      o[q + 2] = o[q + 2] * (1 - mm) + (bl / taps) * mm;
    }
  }
  return out;
}

function chroma(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const dx = Math.cos(p.angle * RAD) * p.distance;
  const dy = Math.sin(p.angle * RAD) * p.distance;
  const o = out.data;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i] * p.strength;
      if (m <= 0) continue;
      sampleImg(src, x + 0.5 + dx, y + 0.5 + dy);
      const r = acc[0];
      sampleImg(src, x + 0.5 - dx, y + 0.5 - dy);
      const bl = acc[2];
      const q = i * 4;
      o[q] = o[q] * (1 - m) + r * m;
      o[q + 2] = o[q + 2] * (1 - m) + bl * m;
    }
  }
  return out;
}

function glitch(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const rand = mulberry32(p.seed);
  const n = Math.max(1, Math.round(p.count));
  const o = out.data;
  const split = Math.max(1, p.distance * 0.18);
  for (let k = 0; k < n; k++) {
    const y0 = Math.floor(b.y0 + rand() * (b.y1 - b.y0));
    const hh = Math.max(2, Math.floor(rand() * (b.y1 - b.y0) * 0.14 + 2));
    const sh = Math.round((rand() * 2 - 1) * p.distance);
    for (let y = y0; y < Math.min(b.y1, y0 + hh); y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i = y * W + x;
        const m = mask[i] * p.strength;
        if (m <= 0) continue;
        const sx = clamp(x - sh, 0, W - 1);
        const sxr = clamp(x - sh + Math.round(split), 0, W - 1);
        const sxb = clamp(x - sh - Math.round(split), 0, W - 1);
        const q = i * 4;
        o[q] = o[q] * (1 - m) + src.data[(y * W + sxr) * 4] * m;
        o[q + 1] = o[q + 1] * (1 - m) + src.data[(y * W + sx) * 4 + 1] * m;
        o[q + 2] = o[q + 2] * (1 - m) + src.data[(y * W + sxb) * 4 + 2] * m;
      }
    }
  }
  return out;
}

function wave(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const dx = Math.cos(p.angle * RAD);
  const dy = Math.sin(p.angle * RAD);
  const amp = p.distance;
  const per = Math.max(4, p.period);
  const o = out.data;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i] * p.strength;
      if (m <= 0) continue;
      const along = (x * dx + y * dy) / per;
      // 진행 방향에 수직으로 흔든다
      const d = Math.sin(along * Math.PI * 2 + p.seed) * amp;
      sampleImg(src, x + 0.5 - dy * d, y + 0.5 + dx * d);
      const q = i * 4;
      o[q] = o[q] * (1 - m) + acc[0] * m;
      o[q + 1] = o[q + 1] * (1 - m) + acc[1] * m;
      o[q + 2] = o[q + 2] * (1 - m) + acc[2] * m;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 음영 / 외곽선 / 그림자 / 노이즈 / 포스터 / 반짝임                     */
/* ------------------------------------------------------------------ */

function shade(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const dx = Math.cos(p.angle * RAD);
  const dy = Math.sin(p.angle * RAD);
  const corners = [
    b.x0 * dx + b.y0 * dy,
    b.x1 * dx + b.y0 * dy,
    b.x0 * dx + b.y1 * dy,
    b.x1 * dx + b.y1 * dy,
  ];
  const lo = Math.min(...corners);
  const hi = Math.max(...corners);
  const [cr, cg, cb] = hexToRgb(p.color);
  const o = out.data;
  const cover = clamp(p.amount, 0.05, 1);
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i];
      if (m <= 0) continue;
      const t = (x * dx + y * dy - lo) / (hi - lo || 1); // 0 → 1 (방향 쪽이 어두움)
      const k = smooth(1 - cover, 1, t) * p.strength * m;
      if (k <= 0) continue;
      const q = i * 4;
      // 곱하기 합성
      o[q] = o[q] * (1 - k) + (o[q] * cr / 255) * k;
      o[q + 1] = o[q + 1] * (1 - k) + (o[q + 1] * cg / 255) * k;
      o[q + 2] = o[q + 2] * (1 - k) + (o[q + 2] * cb / 255) * k;
    }
  }
  return out;
}

/** 제곱 거리 변환(Felzenszwalb) — 안쪽(1) 픽셀까지의 거리. 안쪽은 0 */
function distanceOutside(inside: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e12;
  const f = new Float32Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float32Array(Math.max(w, h) + 1);
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = inside[i] ? 0 : INF;
  const pass = (len: number, get: (i: number) => number, set: (i: number, val: number) => void) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s: number;
      for (;;) {
        const vq = v[k];
        s = (get(q) + q * q - (get(vq) + vq * vq)) / (2 * q - 2 * vq);
        if (s <= z[k] && k > 0) k--;
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      const vq = v[k];
      f[q] = (q - vq) * (q - vq) + get(vq);
    }
    for (let q = 0; q < len; q++) set(q, f[q]);
  };
  for (let x = 0; x < w; x++) pass(h, (i) => d[i * w + x], (i, val) => (d[i * w + x] = val));
  for (let y = 0; y < h; y++) pass(w, (i) => d[y * w + i], (i, val) => (d[y * w + i] = val));
  for (let i = 0; i < w * h; i++) d[i] = Math.sqrt(d[i]);
  return d;
}

function outline(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const H = src.height;
  const reach = Math.ceil(p.lineWidth + p.blur * 2 + 3);
  const x0 = Math.max(0, b.x0 - reach);
  const y0 = Math.max(0, b.y0 - reach);
  const x1 = Math.min(W, b.x1 + reach);
  const y1 = Math.min(H, b.y1 + reach);
  const w = x1 - x0;
  const h = y1 - y0;
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) inside[y * w + x] = mask[(y0 + y) * W + x0 + x] > 0.5 ? 1 : 0;
  const d = distanceOutside(inside, w, h);
  const [cr, cg, cb] = hexToRgb(p.color);
  const o = out.data;
  const glowR = Math.max(0.01, p.blur / 2.2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = d[y * w + x];
      if (dist <= 0) continue;
      const hardZone = dist <= p.lineWidth + 0.5;
      const hard = clamp(p.lineWidth + 0.5 - dist, 0, 1);
      const soft = p.blur > 0 ? Math.exp(-Math.max(0, dist - p.lineWidth) / glowR) * 0.75 : 0;
      const a = (hardZone ? hard : soft) * p.strength;
      if (a <= 0.003) continue;
      const q = ((y0 + y) * W + x0 + x) * 4;
      o[q] = o[q] * (1 - a) + cr * a;
      o[q + 1] = o[q + 1] * (1 - a) + cg * a;
      o[q + 2] = o[q + 2] * (1 - a) + cb * a;
    }
  }
  return out;
}

function dropShadow(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const H = src.height;
  const dx = Math.round(Math.cos(p.angle * RAD) * p.distance);
  const dy = Math.round(Math.sin(p.angle * RAD) * p.distance);
  const reach = Math.ceil(p.distance + p.blur * 2 + 4);
  const x0 = Math.max(0, b.x0 - reach);
  const y0 = Math.max(0, b.y0 - reach);
  const x1 = Math.min(W, b.x1 + reach);
  const y1 = Math.min(H, b.y1 + reach);
  const w = x1 - x0;
  const h = y1 - y0;
  let sh: Float32Array = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x0 + x - dx;
    const sy = y0 + y - dy;
    if (sx >= 0 && sy >= 0 && sx < W && sy < H) sh[y * w + x] = mask[sy * W + sx];
  }
  if (p.blur > 0.5) {
    const r = radiusToBox(p.blur);
    sh = blurChannel(sh, w, h, r, r, 3);
  }
  const [cr, cg, cb] = hexToRgb(p.color === '#ffffff' ? '#000000' : p.color);
  const o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gi = (y0 + y) * W + x0 + x;
    const a = sh[y * w + x] * (1 - clamp(mask[gi] * 1.0, 0, 1)) * p.strength;
    if (a <= 0.003) continue;
    const q = gi * 4;
    o[q] = o[q] * (1 - a) + (o[q] * cr / 255) * a;
    o[q + 1] = o[q + 1] * (1 - a) + (o[q + 1] * cg / 255) * a;
    o[q + 2] = o[q + 2] * (1 - a) + (o[q + 2] * cb / 255) * a;
  }
  return out;
}

function hash2(x: number, y: number, seed: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function grain(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const cell = Math.max(1, Math.round(p.dot / 3));
  const amt = p.amount * 90;
  const o = out.data;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i] * p.strength;
      if (m <= 0) continue;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const n0 = (hash2(cx, cy, p.seed) - 0.5) * 2 * amt * m;
      const q = i * 4;
      if (p.mono) {
        o[q] = clamp(o[q] + n0, 0, 255);
        o[q + 1] = clamp(o[q + 1] + n0, 0, 255);
        o[q + 2] = clamp(o[q + 2] + n0, 0, 255);
      } else {
        o[q] = clamp(o[q] + n0, 0, 255);
        o[q + 1] = clamp(o[q + 1] + (hash2(cx, cy, p.seed + 7) - 0.5) * 2 * amt * m, 0, 255);
        o[q + 2] = clamp(o[q + 2] + (hash2(cx, cy, p.seed + 13) - 0.5) * 2 * amt * m, 0, 255);
      }
    }
  }
  return out;
}

function poster(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const out = cloneRGBA(src);
  const W = src.width;
  const lv = Math.max(2, Math.round(p.levels));
  const step = 255 / (lv - 1);
  const o = out.data;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const m = mask[i] * p.strength;
      if (m <= 0) continue;
      const q = i * 4;
      for (let c = 0; c < 3; c++) {
        const v = Math.round(o[q + c] / step) * step;
        o[q + c] = o[q + c] * (1 - m) + v * m;
      }
    }
  }
  return out;
}

function sparkle(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const W = src.width;
  const H = src.height;
  const out = cloneRGBA(src);
  const layer = new Float32Array(W * H);
  const rand = mulberry32(p.seed);
  const n = Math.max(1, Math.round(p.count));
  const d = src.data;
  let placed = 0;
  for (let tries = 0; tries < 4000 && placed < n; tries++) {
    const x = Math.floor(b.x0 + rand() * (b.x1 - b.x0));
    const y = Math.floor(b.y0 + rand() * (b.y1 - b.y0));
    const i = y * W + x;
    if (mask[i] < 0.3) continue;
    const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    if (lum < p.threshold) continue;
    placed++;
    const size = p.lineLength * (0.45 + 0.7 * rand());
    const wd = Math.max(1.2, p.lineWidth * (0.7 + 0.6 * rand()));
    const rot = rand() * 0.4 - 0.2;
    for (const a of [0, Math.PI / 2]) {
      const ang = a + rot;
      drawTaperLine(layer, W, H, x - Math.cos(ang) * size / 2, y - Math.sin(ang) * size / 2, x + Math.cos(ang) * size / 2, y + Math.sin(ang) * size / 2, wd, 'both');
    }
    const small = size * 0.45;
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const ang = a + rot;
      drawTaperLine(layer, W, H, x - Math.cos(ang) * small / 2, y - Math.sin(ang) * small / 2, x + Math.cos(ang) * small / 2, y + Math.sin(ang) * small / 2, wd * 0.7, 'both');
    }
    const gr = size * 0.16;
    for (let yy = Math.max(0, Math.floor(y - gr)); yy <= Math.min(H - 1, Math.ceil(y + gr)); yy++) {
      for (let xx = Math.max(0, Math.floor(x - gr)); xx <= Math.min(W - 1, Math.ceil(x + gr)); xx++) {
        const dd = Math.hypot(xx - x, yy - y) / gr;
        if (dd < 1) layer[yy * W + xx] = Math.max(layer[yy * W + xx], (1 - dd) * (1 - dd));
      }
    }
  }
  const region = new Float32Array(W * H).fill(1);
  compositeLayer(out, layer, region, p.color, p.strength);
  return out;
}

/* ------------------------------------------------------------------ */
/* 휘두르기 궤적: 팔·무기를 휘두를 때의 초승달 모양 곡선                 */
/* ------------------------------------------------------------------ */

function drawVarStroke(layer: Float32Array, W: number, H: number, x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, a0: number, a1: number) {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const len2 = vx * vx + vy * vy;
  const wm = Math.max(w0, w1);
  const minx = Math.max(0, Math.floor(Math.min(x0, x1) - wm - 1));
  const maxx = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + wm + 1));
  const miny = Math.max(0, Math.floor(Math.min(y0, y1) - wm - 1));
  const maxy = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + wm + 1));
  for (let y = miny; y <= maxy; y++) {
    for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const t = len2 < 1e-6 ? 0 : clamp((px * vx + py * vy) / len2, 0, 1);
      const dist = Math.hypot(px - t * vx, py - t * vy);
      const wd = w0 + (w1 - w0) * t;
      const cov = clamp(wd / 2 - dist + 0.5, 0, 1) * (a0 + (a1 - a0) * t);
      const idx = y * W + x;
      if (cov > layer[idx]) layer[idx] = cov;
    }
  }
}

function swoosh(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const W = src.width;
  const H = src.height;
  const out = cloneRGBA(src);
  let layer: Float32Array = new Float32Array(W * H);
  const rand = mulberry32(p.seed);
  const [ox, oy] = p.useCenter ? [p.centerX, p.centerY] : [b.cx, b.cy];
  const d = p.angle * RAD;
  const R = Math.max(20, p.distance);
  // 물체는 회전 중심(pivot)에서 R 떨어진 원을 따라 angle 방향으로 움직인다.
  // 궤적선은 물체가 지나간 자리의 "바깥 가장자리"를 따라 초승달 모양으로 이어진다.
  const halfW = (b.x1 - b.x0) / 2;
  const halfH = (b.y1 - b.y0) / 2;
  const sideExt = Math.abs(Math.sin(d)) * halfW + Math.abs(Math.cos(d)) * halfH; // 진행 방향과 수직인 반폭
  const pvx = ox + Math.cos(d + Math.PI / 2) * R;
  const pvy = oy + Math.sin(d + Math.PI / 2) * R;
  const head = d - Math.PI / 2;
  const n = Math.max(1, Math.round(p.count));
  const sweep = Math.min(215, Math.max(10, p.rotation)) * RAD;
  const gap = Math.max(2, p.lineWidth * 1.5);
  const SEG = 64;
  for (let k = 0; k < n; k++) {
    const r = R + sideExt * 0.92 + 6 + k * gap;
    const sw = sweep * (R / r) * (n === 1 ? 1 : 0.5 + 0.5 * rand());
    const ph = head + 0.06 * sweep * (R / r);
    const wMax = p.lineWidth * (n === 1 ? 1 : 0.6 + 0.5 * rand());
    let px = 0;
    let py = 0;
    let pw = 0;
    let pa = 0;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const phi = ph - sw * (1 - t);
      const x = pvx + Math.cos(phi) * r;
      const y = pvy + Math.sin(phi) * r;
      // 가운데가 가장 굵고 양끝이 뾰족한 초승달 단면
      const w = wMax * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 1.1);
      const a = 0.1 + 0.9 * Math.pow(Math.sin(Math.min(1, t * 1.05) * Math.PI * 0.5), 0.7);
      if (i) drawVarStroke(layer, W, H, px, py, x, y, pw, w, pa, a);
      px = x;
      py = y;
      pw = w;
      pa = a;
    }
  }
  if (p.soft > 0.4) {
    const rr = radiusToBox(p.soft);
    layer = blurChannel(layer, W, H, rr, rr, 2);
  }
  const region = new Float32Array(W * H);
  for (let i = 0; i < region.length; i++) region[i] = p.avoidObject ? 1 - clamp(mask[i] * 1.5, 0, 1) : 1;
  compositeLayer(out, layer, region, p.color, p.strength);
  return out;
}

/* ------------------------------------------------------------------ */
/* 소재: 가져온 PNG/JPG(톤·효과선·질감·스탬프)를 선택 영역에 붙인다      */
/* ------------------------------------------------------------------ */

function blendCh(b: number, s: number, mode: BlendMode): number {
  switch (mode) {
    case 'multiply':
      return (b * s) / 255;
    case 'screen':
      return 255 - ((255 - b) * (255 - s)) / 255;
    case 'overlay':
      return b < 128 ? (2 * b * s) / 255 : 255 - (2 * (255 - b) * (255 - s)) / 255;
    case 'soft-light': {
      const bb = b / 255;
      const ss = s / 255;
      const g = bb <= 0.25 ? ((16 * bb - 12) * bb + 4) * bb : Math.sqrt(bb);
      return (ss <= 0.5 ? bb - (1 - 2 * ss) * bb * (1 - bb) : bb + (2 * ss - 1) * (g - bb)) * 255;
    }
    case 'add':
      return Math.min(255, b + s);
    default:
      return s;
  }
}

const mipCache = new Map<string, RGBA>();

/** 작게 줄여 붙일 때 번쩍임(앨리어싱)을 막도록 정수 배율로 미리 평균낸 복사본 */
function mipFor(id: string, m: RGBA, factor: number): RGBA {
  if (factor <= 1) return m;
  const key = `${id}:${m.width}x${m.height}:${factor}`;
  const hit = mipCache.get(key);
  if (hit) return hit;
  const w = Math.max(1, Math.floor(m.width / factor));
  const h = Math.max(1, Math.floor(m.height / factor));
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      for (let j = 0; j < factor; j++) {
        for (let i = 0; i < factor; i++) {
          const q = ((y * factor + j) * m.width + (x * factor + i)) * 4;
          const al = m.data[q + 3];
          r += m.data[q] * al;
          g += m.data[q + 1] * al;
          bl += m.data[q + 2] * al;
          a += al;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        d[o] = r / a;
        d[o + 1] = g / a;
        d[o + 2] = bl / a;
      }
      d[o + 3] = a / (factor * factor);
    }
  }
  if (mipCache.size > 24) mipCache.clear();
  const res = { data: d, width: w, height: h };
  mipCache.set(key, res);
  return res;
}

const msamp = new Float32Array(4);

/** 소재 쌍선형 샘플 → msamp[r,g,b,a(0..1)] (알파 가중 평균) */
function sampleMaterial(m: RGBA, u: number, v: number, wrap: boolean) {
  const W = m.width;
  const H = m.height;
  const fx = u - 0.5;
  const fy = v - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (let j = 0; j < 2; j++) {
    let yy = y0 + j;
    const wy = j ? ty : 1 - ty;
    if (wrap) yy = ((yy % H) + H) % H;
    else if (yy < 0 || yy >= H) continue;
    for (let i = 0; i < 2; i++) {
      let xx = x0 + i;
      const wgt = (i ? tx : 1 - tx) * wy;
      if (wrap) xx = ((xx % W) + W) % W;
      else if (xx < 0 || xx >= W) continue;
      const q = (yy * W + xx) * 4;
      const al = (m.data[q + 3] / 255) * wgt;
      r += m.data[q] * al;
      g += m.data[q + 1] * al;
      b += m.data[q + 2] * al;
      a += al;
    }
  }
  if (a > 0) {
    msamp[0] = r / a;
    msamp[1] = g / a;
    msamp[2] = b / a;
  } else {
    msamp[0] = msamp[1] = msamp[2] = 0;
  }
  msamp[3] = a;
}

function material(src: RGBA, mask: Float32Array, b: Bounds, p: EffectParams): RGBA {
  const mat0 = getMaterial(p.materialId);
  if (!mat0) return src;
  const W = src.width;
  const H = src.height;
  const out = cloneRGBA(src);
  const o = out.data;
  let s = Math.max(0.02, p.matScale / 100);
  if (p.matFit === 'cover') s *= Math.max(W / mat0.width, H / mat0.height);
  const factor = s < 0.5 ? Math.min(16, Math.floor(1 / s)) : 1;
  const mat = mipFor(p.materialId, mat0, factor);
  const sEff = s * factor; // mip 한 칸이 factor 픽셀에 해당
  const [ox, oy] = p.useCenter ? [p.centerX, p.centerY] : p.matFit === 'cover' ? [W / 2, H / 2] : [b.cx, b.cy];
  const rad = (p.rotation * Math.PI) / 180;
  const cr = Math.cos(rad);
  const sr = Math.sin(rad);
  const wrap = p.matFit === 'tile';
  const [tr, tg, tb] = hexToRgb(p.color === '#ffffff' && p.matMode === 'ink' ? '#000000' : p.color);
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = y * W + x;
      const mk = mask[i] * p.strength;
      if (mk <= 0) continue;
      const dx = x + 0.5 - ox;
      const dy = y + 0.5 - oy;
      const rx = dx * cr + dy * sr;
      const ry = -dx * sr + dy * cr;
      let u = rx / sEff + mat.width / 2;
      const v = ry / sEff + mat.height / 2;
      if (p.matFlip) u = mat.width - u;
      if (!wrap && (u < -0.5 || v < -0.5 || u > mat.width + 0.5 || v > mat.height + 0.5)) continue;
      sampleMaterial(mat, u, v, wrap);
      let a = msamp[3];
      if (a <= 0.003) continue;
      let sr_ = msamp[0];
      let sg = msamp[1];
      let sb = msamp[2];
      if (p.matMode !== 'color') {
        const lum = (0.299 * sr_ + 0.587 * sg + 0.114 * sb) / 255;
        a *= p.matMode === 'ink' ? 1 - lum : lum;
        sr_ = tr;
        sg = tg;
        sb = tb;
      }
      const k = clamp(a * mk, 0, 1);
      if (k <= 0) continue;
      const q = i * 4;
      o[q] += (blendCh(o[q], sr_, p.matBlend) - o[q]) * k;
      o[q + 1] += (blendCh(o[q + 1], sg, p.matBlend) - o[q + 1]) * k;
      o[q + 2] += (blendCh(o[q + 2], sb, p.matBlend) - o[q + 2]) * k;
    }
  }
  return out;
}

/** 효과 하나를 적용한 새 이미지를 반환. 입력(src)은 변경하지 않는다. */
export function applyEffect(src: RGBA, mask: Float32Array, b: Bounds, e: Effect): RGBA {
  const p = e.params;
  switch (e.type) {
    case 'shake':
      return ghosts(src, mask, b, p, 'shake');
    case 'afterimage':
      return ghosts(src, mask, b, p, 'trail');
    case 'motionblur':
      return motionBlur(src, mask, b, p);
    case 'blur':
      return gaussian(src, mask, p);
    case 'speedlines':
      return speedLines(src, mask, b, p);
    case 'focuslines':
      return focusLines(src, mask, b, p);
    case 'halftone':
      return halftone(src, mask, b, p);
    case 'glow':
      return glow(src, mask, p);
    case 'color':
      return colorAdjust(src, mask, b, p);
    case 'zoomblur':
      return zoomBlur(src, mask, b, p);
    case 'chroma':
      return chroma(src, mask, b, p);
    case 'glitch':
      return glitch(src, mask, b, p);
    case 'wave':
      return wave(src, mask, b, p);
    case 'shade':
      return shade(src, mask, b, p);
    case 'outline':
      return outline(src, mask, b, p);
    case 'shadow':
      return dropShadow(src, mask, b, p);
    case 'grain':
      return grain(src, mask, b, p);
    case 'poster':
      return poster(src, mask, b, p);
    case 'sparkle':
      return sparkle(src, mask, b, p);
    case 'swoosh':
      return swoosh(src, mask, b, p);
    case 'material':
      return material(src, mask, b, p);
    default:
      return src;
  }
}
