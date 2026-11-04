/**
 * 자동 저장 / 복구 (이 브라우저의 IndexedDB 에만 저장, 외부로 전송하지 않음)
 *  - 작업이 바뀌면 잠깐 뒤에 최신 상태 하나만 덮어쓴다.
 *  - 다시 열면 "이전 작업 복구" 를 물어본다(자동으로 덮어쓰지 않는다).
 */

const DB = 'wtoon-autosave';
const STORE = 'kv';
const KEY = 'latest';

export interface AutosaveRecord {
  savedAt: number;
  json: string;
  cuts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('indexedDB 없음'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveAutosave(json: string, cuts: number): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ savedAt: Date.now(), json, cuts } satisfies AutosaveRecord, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadAutosave(): Promise<AutosaveRecord | null> {
  try {
    const db = await openDb();
    const rec = await new Promise<AutosaveRecord | null>((resolve, reject) => {
      const rq = db.transaction(STORE).objectStore(STORE).get(KEY);
      rq.onsuccess = () => resolve((rq.result as AutosaveRecord | undefined) ?? null);
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    return rec && typeof rec.json === 'string' ? rec : null;
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* 저장소를 쓸 수 없으면 무시 */
  }
}
