import { uid, type Cut, type Effect } from './types';

/** 컷을 효과 레이어까지 통째로 복제한다(새 id, 효과 묶음도 새로 만든다) */
export function duplicateCut(cut: Cut): Cut {
  const groups = new Map<string, string>();
  return {
    ...cut,
    id: uid(),
    effects: cut.effects.map((e) => {
      let group = e.group;
      if (group) {
        if (!groups.has(group)) groups.set(group, uid());
        group = groups.get(group);
      }
      return { ...e, id: uid(), group, mask: structuredCloneSafe(e.mask), params: { ...e.params } };
    }),
  };
}

/**
 * 효과 레이어 여러 개를 복제한다(다른 컷에 붙여넣기용). 새 id 를 주고, 같은 묶음(group)은 묶음 관계를 유지한 채 새 묶음으로 만든다.
 * 영역(마스크)은 같은 좌표 그대로 복사된다.
 */
export function cloneEffects(list: Effect[]): Effect[] {
  const groups = new Map<string, string>();
  return list.map((e) => {
    let group = e.group;
    if (group) {
      if (!groups.has(group)) groups.set(group, uid());
      group = groups.get(group);
    }
    return { ...e, id: uid(), group, mask: structuredCloneSafe(e.mask), params: { ...e.params } };
  });
}

/** 효과 레이어 하나를 복제한다. 묶음에서는 빠져서 영역을 따로 고칠 수 있다 */
export function duplicateEffect(e: Effect): Effect {
  return { ...e, id: uid(), name: `${e.name} 복사`.slice(0, 40), group: undefined, mask: structuredCloneSafe(e.mask), params: { ...e.params } };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * 컷을 세로로 나눈다. cuts = 나눌 위치(컷 위에서부터 px, 오름차순).
 * 효과가 있으면 효과까지 그림에 합쳐서 나눈다(나뉜 컷에는 효과 레이어가 없다).
 * 첫 조각은 원래 컷의 위 간격·위 사선을, 마지막 조각은 아래 사선을 이어받는다.
 */
export async function splitCut(cut: Cut, at: number[]): Promise<Cut[]> {
  const { renderCutCanvas } = await import('./imageIO');
  const canvas = await renderCutCanvas(cut);
  const ys = [0, ...at.map((y) => Math.round(y)).filter((y) => y > 20 && y < cut.height - 20), cut.height];
  const uniq = [...new Set(ys)].sort((a, b) => a - b);
  const out: Cut[] = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    const y0 = uniq[i];
    const h = uniq[i + 1] - y0;
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = h;
    c.getContext('2d')!.drawImage(canvas, 0, -y0);
    const first = i === 0;
    const last = i === uniq.length - 2;
    const { gapBefore, slantTop, slantBottom, ...rest } = cut;
    out.push({
      ...rest,
      id: uid(),
      src: cut.bg === 'transparent' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.95),
      height: h,
      effects: [],
      ...(first && gapBefore !== undefined ? { gapBefore } : {}),
      ...(first && slantTop ? { slantTop } : {}),
      ...(last && slantBottom ? { slantBottom } : {}),
    });
  }
  return out;
}
