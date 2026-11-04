/**
 * 효과음 시트(한 장에 수십~수백 개가 흩어져 있는 그림) → 조각 하나하나로 자동 분리.
 *
 *  1) findPieces: 순수 함수. "있는 곳(1)/없는 곳(0)" 마스크를 살짝 부풀려 이어진 덩어리를 찾는다
 *     (글자 획·테두리·반짝이가 한 효과음으로 묶이도록).
 *  2) splitSheet: 브라우저 쪽. 큰 그림(10000×10000)도 작게 줄인 복사본으로 찾고, 자르기는 원본에서 한다.
 */
import type { Material } from './types';
import { uid } from './types';
import { analyzePixels, readPsdComposite } from './materials';

export interface Piece {
  /** 1부터 시작하는 읽는 순서(왼→오, 위→아래) */
  n: number;
  /** 작업 해상도 기준 상자 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 부풀리기 전 실제 픽셀 수 */
  area: number;
  /** 이 조각이 속한 라벨 번호(labels 배열의 값) */
  label: number;
}

export interface FindResult {
  pieces: Piece[];
  labels: Int32Array;
}

/** 사각 팽창(최대값 필터). 가로·세로 두 번에 나눠 O(w·h·r) */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let last = -1e9; // 마지막으로 1이 나온 x
    const nextOne = new Int32Array(w);
    let nx = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[row + x]) nx = x;
      nextOne[x] = nx;
    }
    for (let x = 0; x < w; x++) {
      if (mask[row + x]) last = x;
      tmp[row + x] = x - last <= r || nextOne[x] - x <= r ? 1 : 0;
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    const nextOne = new Int32Array(h);
    let ny = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) ny = y;
      nextOne[y] = ny;
    }
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      out[y * w + x] = y - last <= r || nextOne[y] - y <= r ? 1 : 0;
    }
  }
  return out;
}

/** 부풀린 마스크에서 이어진 덩어리를 찾아 상자로 돌려준다. minArea 미만(먼지)은 버린다. */
export function findPieces(mask: Uint8Array, w: number, h: number, opts: { grow: number; minArea: number }): FindResult {
  const grown = dilate(mask, w, h, Math.max(0, Math.round(opts.grow)));
  const labels = new Int32Array(w * h); // 0 = 없음
  const stack = new Int32Array(w * h);
  const found: Piece[] = [];
  let next = 0;
  for (let s = 0; s < w * h; s++) {
    if (!grown[s] || labels[s]) continue;
    next++;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = next;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, area = 0;
    while (sp) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p - px) / w;
      if (mask[p]) area++;
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
      if (px > 0 && grown[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
      if (px < w - 1 && grown[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
      if (py > 0 && grown[p - w] && !labels[p - w]) { labels[p - w] = next; stack[sp++] = p - w; }
      if (py < h - 1 && grown[p + w] && !labels[p + w]) { labels[p + w] = next; stack[sp++] = p + w; }
    }
    found.push({ n: 0, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area, label: next });
  }
  const keep = found.filter((f) => f.area >= opts.minArea);
  // 읽는 순서: 비슷한 높이끼리 한 줄로 보고 왼쪽→오른쪽
  const med = keep.length ? [...keep].map((p) => p.h).sort((a, b) => a - b)[Math.floor(keep.length / 2)] : 1;
  const band = Math.max(8, med * 0.8);
  keep.sort((a, b) => {
    const ra = Math.floor((a.y + a.h / 2) / band);
    const rb = Math.floor((b.y + b.h / 2) / band);
    return ra - rb || a.x - b.x;
  });
  keep.forEach((p, i) => (p.n = i + 1));
  return { pieces: keep, labels };
}

/* ------------------------------ 브라우저 쪽 ------------------------------ */

export interface SheetSource {
  /** 원본 그림(디코드된 비트맵 또는 캔버스) */
  src: CanvasImageSource;
  width: number;
  height: number;
}

export interface SheetAnalysis {
  source: SheetSource;
  /** 작업 해상도(원본 대비 비율) */
  scale: number;
  w: number;
  h: number;
  /** 있는 곳 마스크(작업 해상도) */
  mask: Uint8Array;
  /** 작업 해상도 미리보기 */
  preview: HTMLCanvasElement;
  /** 투명 배경이면 true, 아니면 바탕색 제거 모드 */
  alphaMode: boolean;
  bg: [number, number, number];
}

const WORK_SIDE = 2400;

export async function openSheet(file: File): Promise<SheetSource> {
  if (/\.psd$/i.test(file.name)) {
    const psd = readPsdComposite(await file.arrayBuffer());
    const c = document.createElement('canvas');
    c.width = psd.width;
    c.height = psd.height;
    c.getContext('2d')!.putImageData(new ImageData(psd.data as unknown as Uint8ClampedArray<ArrayBuffer>, psd.width, psd.height), 0, 0);
    return { src: c, width: c.width, height: c.height };
  }
  const bmp = await createImageBitmap(file);
  return { src: bmp, width: bmp.width, height: bmp.height };
}

export function analyzeSheet(source: SheetSource, tolerance = 40): SheetAnalysis {
  const scale = Math.min(1, WORK_SIDE / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const preview = document.createElement('canvas');
  preview.width = w;
  preview.height = h;
  const ctx = preview.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  // 가장자리 한 줄이 거의 다 투명이면 알파 모드
  let clear = 0, edge = 0;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const probe = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    edge++;
    if (d[i + 3] < 10) clear++;
    else { rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); }
  };
  for (let x = 0; x < w; x++) { probe(x, 0); probe(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { probe(0, y); probe(w - 1, y); }
  const alphaMode = clear / edge > 0.9;
  const med = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : 255);
  const bg: [number, number, number] = alphaMode ? [0, 0, 0] : [med(rs), med(gs), med(bs)];
  const mask = new Uint8Array(w * h);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (alphaMode) mask[p] = d[i + 3] > 12 ? 1 : 0;
    else mask[p] = d[i + 3] > 12 && Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2])) > tolerance ? 1 : 0;
  }
  return { source, scale, w, h, mask, preview, alphaMode, bg };
}

const OUT_MAX = 2048;

/** 고른 조각들을 원본 해상도에서 잘라 소재로 만든다 */
export function cutPieces(a: SheetAnalysis, found: FindResult, picks: Piece[], namePrefix: string, onProgress?: (done: number, total: number) => void): Material[] {
  const out: Material[] = [];
  const pad = 3; // 작업 해상도 픽셀
  const { w: W, h: H } = a;
  picks.forEach((p, idx) => {
    const x0 = Math.max(0, p.x - pad), y0 = Math.max(0, p.y - pad);
    const x1 = Math.min(W, p.x + p.w + pad), y1 = Math.min(H, p.y + p.h + pad);
    const bw = x1 - x0, bh = y1 - y0;
    const sx = x0 / a.scale, sy = y0 / a.scale, sw = bw / a.scale, sh = bh / a.scale;
    const k = Math.min(1, OUT_MAX / Math.max(sw, sh));
    const ow = Math.max(1, Math.round(sw * k)), oh = Math.max(1, Math.round(sh * k));
    const c = document.createElement('canvas');
    c.width = ow;
    c.height = oh;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(a.source.src, sx, sy, sw, sh, 0, 0, ow, oh);
    // 이웃 조각이 걸쳐 들어오지 않게, 이 조각의 덩어리 모양으로만 남긴다
    const m = document.createElement('canvas');
    m.width = bw;
    m.height = bh;
    const mc = m.getContext('2d')!;
    const img = mc.createImageData(bw, bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (found.labels[(y0 + y) * W + x0 + x] === p.label) img.data[(y * bw + x) * 4 + 3] = 255;
    mc.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(m, 0, 0, ow, oh);
    ctx.globalCompositeOperation = 'source-over';
    if (!a.alphaMode) {
      // 불투명 시트: 바탕색을 부드럽게 투명으로
      const id = ctx.getImageData(0, 0, ow, oh);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        const dist = Math.max(Math.abs(d[i] - a.bg[0]), Math.abs(d[i + 1] - a.bg[1]), Math.abs(d[i + 2] - a.bg[2]));
        const al = Math.max(0, Math.min(1, (dist - 14) / 40));
        d[i + 3] = Math.round(d[i + 3] * al);
      }
      ctx.putImageData(id, 0, 0);
    }
    const hint = analyzePixels(ctx.getImageData(0, 0, ow, oh).data);
    out.push({ id: uid(), name: `${namePrefix} ${String(p.n).padStart(3, '0')}`.slice(0, 40), src: c.toDataURL('image/png'), w: ow, h: oh, hint: hint === 'ink' || hint === 'light' ? 'alpha' : hint });
    onProgress?.(idx + 1, picks.length);
  });
  return out;
}
