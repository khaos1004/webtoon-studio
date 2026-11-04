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
