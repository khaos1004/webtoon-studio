import type { Effect } from './types';
import type { RGBA } from './effects';
import { renderEffects } from './render';
import { remoteResend, setMaterialRemoteHook } from './materials';

/**
 * 컷 하나의 효과 렌더링을 "최신 요청만 처리"하는 방식으로 돌린다.
 *  - Web Worker 를 쓸 수 있으면 화면 스레드를 막지 않는다.
 *  - 쓸 수 없으면(구형 환경 등) 같은 계산을 메인 스레드에서 setTimeout 으로 돌린다.
 */

type Factory = () => Worker | null;

let worker: Worker | null | undefined;

interface Job {
  baseId: number;
  base: RGBA;
  effects: Effect[];
  resolve: (r: RGBA | null) => void;
}
interface CutState {
  busy: boolean;
  next: Job | null;
  sentBase: number | null;
}

const states = new Map<string, CutState>();
const inflight = new Map<number, { cutId: string; job: Job }>();
const baseIds = new WeakMap<object, number>();
let baseSeq = 1;
let reqSeq = 1;

function baseId(base: RGBA) {
  let id = baseIds.get(base);
  if (!id) {
    id = baseSeq++;
    baseIds.set(base, id);
  }
  return id;
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const g = globalThis as unknown as { __wtoonWorkerFactory?: Factory };
    worker = g.__wtoonWorkerFactory ? g.__wtoonWorkerFactory() : new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker) {
    remoteResend();
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; reqId: number; width?: number; height?: number; data?: Uint8ClampedArray };
      const f = inflight.get(m.reqId);
      if (!f) return;
      inflight.delete(m.reqId);
      const st = states.get(f.cutId)!;
      if (m.type === 'done' && m.data) f.job.resolve({ data: m.data, width: m.width!, height: m.height! });
      else {
        // 워커 쪽 오류/기초 데이터 없음 → 메인 스레드에서 다시 계산
        st.sentBase = null;
        try {
          f.job.resolve(renderEffects(f.job.base, f.job.effects));
        } catch {
          f.job.resolve(null);
        }
      }
      st.busy = false;
      pump(f.cutId);
    };
    worker.onerror = () => {
      worker = null;
      const jobs = Array.from(inflight.values());
      inflight.clear();
      for (const { cutId, job } of jobs) {
        try {
          job.resolve(renderEffects(job.base, job.effects));
        } catch {
          job.resolve(null);
        }
        const st = states.get(cutId);
        if (st) {
          st.busy = false;
          st.sentBase = null;
          pump(cutId);
        }
      }
    };
  }
  return worker;
}

function pump(cutId: string) {
  const st = states.get(cutId);
  if (!st || st.busy || !st.next) return;
  const job = st.next;
  st.next = null;
  st.busy = true;
  const w = getWorker();
  if (!w) {
    setTimeout(() => {
      try {
        job.resolve(renderEffects(job.base, job.effects));
      } catch {
        job.resolve(null);
      }
      st.busy = false;
      pump(cutId);
    }, 0);
    return;
  }
  if (st.sentBase !== job.baseId) {
    w.postMessage({ type: 'base', key: cutId, width: job.base.width, height: job.base.height, data: job.base.data });
    st.sentBase = job.baseId;
  }
  const reqId = reqSeq++;
  inflight.set(reqId, { cutId, job });
  w.postMessage({ type: 'render', key: cutId, reqId, effects: job.effects });
}

/** 새 요청이 오면 아직 시작하지 않은 이전 요청은 null 로 끝난다(최신만 계산). */
export function renderAsync(cutId: string, base: RGBA, effects: Effect[]): Promise<RGBA | null> {
  return new Promise((resolve) => {
    let st = states.get(cutId);
    if (!st) {
      st = { busy: false, next: null, sentBase: null };
      states.set(cutId, st);
    }
    if (st.next) st.next.resolve(null);
    st.next = { baseId: baseId(base), base, effects, resolve };
    pump(cutId);
  });
}

/** 컷이 삭제되면 워커에 남은 데이터를 정리할 수 있도록 상태를 비운다 */
export function forgetCut(cutId: string) {
  states.delete(cutId);
}

// 가져온 소재 픽셀을 워커에도 보내서 같은 결과를 계산하게 한다
setMaterialRemoteHook((id, rgba) => {
  const w = getWorker();
  if (w) w.postMessage({ type: 'material', id, width: rgba.width, height: rgba.height, data: rgba.data });
});
