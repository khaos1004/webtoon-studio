/**
 * 긴 웹툰 세로 이미지를 올리기 좋은 크기로 나누는 계획.
 * 가능하면 컷과 컷 사이(여백)에서 자르고, 그런 자리가 없을 때만 최대 높이에서 자른다.
 */

export type SliceRange = [number, number];

/**
 * @param total  전체 높이(px)
 * @param maxH   조각 하나의 최대 높이(px)
 * @param safe   자르기 좋은 위치들(컷 사이 여백의 가운데). 오름차순이 아니어도 된다
 * @param minFill 안전한 위치를 쓸 때 조각이 최소한 이만큼(최대 높이 대비 비율)은 차야 한다
 */
export function planSlices(total: number, maxH: number, safe: number[] = [], minFill = 0.4): SliceRange[] {
  const T = Math.max(1, Math.round(total));
  const M = Math.max(100, Math.floor(maxH));
  const out: SliceRange[] = [];
  let s = 0;
  while (T - s > M) {
    const limit = s + M;
    let cut = -1;
    for (const y of safe) if (y > s + M * minFill && y <= limit && y > cut) cut = y;
    if (cut < 0) cut = limit;
    out.push([s, cut]);
    s = cut;
  }
  out.push([s, T]);
  return out;
}

/** 컷 배치에서 자르기 좋은 위치(컷 사이 여백의 가운데)를 구한다 */
export function safeCutPositions(items: { top: number; height: number }[]): number[] {
  const res: number[] = [];
  for (let i = 0; i + 1 < items.length; i++) {
    const bottom = items[i].top + items[i].height;
    const next = items[i + 1].top;
    res.push(Math.round((bottom + Math.max(bottom, next)) / 2));
  }
  return res;
}
