/** 긴 컷(900×3000)에 효과 여러 개를 얹었을 때의 계산 시간 */
import { createEffect, EFFECT_ORDER } from '../src/lib/effectMeta';
import { renderEffects } from '../src/lib/render';
import type { RGBA } from '../src/lib/effects';
import type { Effect } from '../src/lib/types';

const W = 900, H = 3000;
const data = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const v = ((x >> 5) + (y >> 5)) & 1 ? 230 : 40; data[i] = v; data[i + 1] = (x * 255 / W) | 0; data[i + 2] = (y * 255 / H) | 0; data[i + 3] = 255; }
const base: RGBA = { data, width: W, height: H };
const full = { feather: 0, ops: [{ kind: 'rect' as const, mode: 'add' as const, x: 0, y: 0, w: W, h: H }] };
const slow: string[] = [];
for (const t of EFFECT_ORDER) {
  const e: Effect = { ...createEffect(t), mask: full };
  const t0 = performance.now();
  renderEffects(base, [e]);
  const ms = performance.now() - t0;
  if (ms > 700) slow.push(`${t} ${ms.toFixed(0)}ms`);
  console.log(t.padEnd(12), ms.toFixed(0), 'ms');
}
console.log('느린 효과(>700ms, 전체 영역):', slow.join(', ') || '없음');
