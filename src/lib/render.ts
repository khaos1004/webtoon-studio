import type { Effect } from './types';
import { applyEffect, type RGBA } from './effects';
import { getMask } from './mask';
import { materialVersion } from './materials';

interface CacheEntry {
  base: RGBA;
  keys: string[];
  outs: RGBA[];
}

/** 마지막 렌더의 레이어별 결과. 위쪽 레이어 값만 바꾸면 아래 레이어는 다시 계산하지 않는다. */
let cache: CacheEntry | null = null;

const layerKey = (e: Effect) => JSON.stringify([e.type, e.opacity ?? 1, e.mask, e.params, e.type === 'material' ? materialVersion(e.params.materialId) : 0]);

/** 컷의 원본 픽셀 위에 효과 레이어를 아래에서 위로 순서대로 적용한다. 원본은 변경하지 않는다. */
export function renderEffects(base: RGBA, effects: Effect[]): RGBA {
  const active = effects.filter((e) => e.visible && (e.opacity ?? 1) > 0);
  const keys = active.map(layerKey);
  const outs: RGBA[] = [];
  let cur = base;
  let start = 0;
  if (cache && cache.base === base) {
    while (start < keys.length && start < cache.keys.length && cache.keys[start] === keys[start]) {
      outs.push(cache.outs[start]);
      start++;
    }
    if (start) cur = outs[start - 1];
  }
  for (let i = start; i < active.length; i++) {
    const e = active[i];
    const op = e.opacity ?? 1;
    const { mask, bounds } = getMask(e.mask, base.width, base.height);
    if (!bounds) {
      outs.push(cur);
      continue;
    }
    const next = applyEffect(cur, mask, bounds, e);
    if (op < 1) {
      const a = cur.data;
      const b = next.data;
      for (let j = 0; j < a.length; j += 4) {
        b[j] = a[j] + (b[j] - a[j]) * op;
        b[j + 1] = a[j + 1] + (b[j + 1] - a[j + 1]) * op;
        b[j + 2] = a[j + 2] + (b[j + 2] - a[j + 2]) * op;
      }
    }
    outs.push(next);
    cur = next;
  }
  cache = { base, keys, outs };
  return cur;
}
