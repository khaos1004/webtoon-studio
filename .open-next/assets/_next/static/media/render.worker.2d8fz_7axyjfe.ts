/// 효과 계산을 화면 스레드 밖에서 처리하는 Web Worker (슬라이더를 움직여도 UI가 멈추지 않는다)
import { renderEffects } from './render';
import { registerMaterial } from './materials';
import type { RGBA } from './effects';
import type { Effect } from './types';

type In =
  | { type: 'base'; key: string; width: number; height: number; data: Uint8ClampedArray }
  | { type: 'render'; key: string; reqId: number; effects: Effect[] }
  | { type: 'material'; id: string; width: number; height: number; data: Uint8ClampedArray };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<In>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

const bases = new Map<string, RGBA>();

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'base') {
    bases.set(m.key, { data: m.data, width: m.width, height: m.height });
    return;
  }
  if (m.type === 'material') {
    registerMaterial(m.id, { data: m.data, width: m.width, height: m.height });
    return;
  }
  const base = bases.get(m.key);
  if (!base) {
    scope.postMessage({ type: 'missing', reqId: m.reqId });
    return;
  }
  try {
    const out = renderEffects(base, m.effects);
    // 캐시된 결과를 넘겨주면 전송 후 비워지므로 복사본을 보낸다
    const copy = new Uint8ClampedArray(out.data);
    scope.postMessage({ type: 'done', reqId: m.reqId, width: out.width, height: out.height, data: copy }, [copy.buffer]);
  } catch (err) {
    scope.postMessage({ type: 'error', reqId: m.reqId, message: String((err as Error)?.message ?? err) });
  }
};
