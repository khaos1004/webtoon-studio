import type { RGBA } from './effects';
import { binaryToRuns, growBinary } from './mask';
import type { MaskOp } from './types';

export interface WandOptions {
  /** 0..100 */
  tolerance: number;
  /** true: 클릭한 곳과 이어진 영역만, false: 컷 전체에서 비슷한 색 */
  contiguous: boolean;
  /** true: 어두운 선(외곽선)을 경계로 삼는다 */
  lineBarrier: boolean;
  /** 선택 후 확대(+)/축소(-) px */
  grow: number;
}

export const DEFAULT_WAND: WandOptions = { tolerance: 28, contiguous: true, lineBarrier: true, grow: 2 };

/**
 * 마술봉: 클릭한 지점과 색이 비슷한 영역을 선택한다.
 * 만화 컷처럼 선화로 둘러싸인 영역은 lineBarrier 로 한 번에 고를 수 있다.
 */
export function magicWand(img: RGBA, sx: number, sy: number, opt: WandOptions): Uint8Array {
  const { width: W, height: H, data } = img;
  const x = Math.max(0, Math.min(W - 1, Math.floor(sx)));
  const y = Math.max(0, Math.min(H - 1, Math.floor(sy)));
  // 시드 색: 3x3 평균
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sn = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const p = (yy * W + xx) * 4;
      sr += data[p];
      sg += data[p + 1];
      sb += data[p + 2];
      sn++;
    }
  sr /= sn;
  sg /= sn;
  sb /= sn;
  const thr = (opt.tolerance / 100) * 220;
  const thr2 = thr * thr;
  const seedLum = 0.299 * sr + 0.587 * sg + 0.114 * sb;
  // 시드 자체가 선(어두운 색)이면 선을 경계로 쓰지 않는다
  const barrier = opt.lineBarrier && seedLum > 90;
  const barrierLum = Math.min(110, seedLum - 40);

  const ok = (i: number) => {
    const p = i * 4;
    const dr = data[p] - sr;
    const dg = data[p + 1] - sg;
    const db = data[p + 2] - sb;
    if (dr * dr + dg * dg + db * db > thr2) return false;
    if (barrier && 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2] < barrierLum) return false;
    return true;
  };

  let out: Uint8Array = new Uint8Array(W * H);
  if (!opt.contiguous) {
    for (let i = 0; i < W * H; i++) if (ok(i)) out[i] = 1;
  } else {
    const start = y * W + x;
    if (!ok(start)) {
      out[start] = 1;
    } else {
      // 스캔라인 채우기
      const stack: number[] = [start];
      while (stack.length) {
        const i = stack.pop()!;
        if (out[i]) continue;
        let yy = (i / W) | 0;
        let xl = i % W;
        let xr = xl;
        if (!ok(yy * W + xl)) continue;
        while (xl > 0 && !out[yy * W + xl - 1] && ok(yy * W + xl - 1)) xl--;
        while (xr < W - 1 && !out[yy * W + xr + 1] && ok(yy * W + xr + 1)) xr++;
        for (let xx = xl; xx <= xr; xx++) out[yy * W + xx] = 1;
        for (const ny of [yy - 1, yy + 1]) {
          if (ny < 0 || ny >= H) continue;
          let inRun = false;
          for (let xx = xl; xx <= xr; xx++) {
            const j = ny * W + xx;
            const can = !out[j] && ok(j);
            if (can && !inRun) {
              stack.push(j);
              inRun = true;
            } else if (!can) inRun = false;
          }
        }
        yy = 0;
      }
    }
  }
  if (opt.grow !== 0) out = growBinary(out, W, H, opt.grow);
  return out;
}

export function wandOp(img: RGBA, sx: number, sy: number, opt: WandOptions, mode: 'add' | 'sub'): MaskOp {
  const bin = magicWand(img, sx, sy, opt);
  return { kind: 'region', mode, w: img.width, h: img.height, runs: binaryToRuns(bin, img.width, img.height) };
}
