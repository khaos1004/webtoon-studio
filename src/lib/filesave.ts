/**
 * 파일 저장 도우미.
 *  - Chrome·Edge 처럼 "파일 저장 창(File System Access)"을 쓸 수 있으면 한 번 위치를 정한 뒤 같은 파일에 덮어쓴다.
 *  - 쓸 수 없으면(Firefox·Safari·일부 임베드 화면) 다운로드로 대신한다.
 *  - 임베드 화면 등에서 직접 저장 방법을 넣고 싶으면 globalThis.__wtoonSaveFile(blob, filename) 를 정의하면 그것이 우선한다.
 */
import { downloadBlob } from './project';

export interface WritableLike {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
}
export interface FileHandleLike {
  name: string;
  createWritable(): Promise<WritableLike>;
}

type SaveHook = (blob: Blob, filename: string) => void | Promise<void>;
type Picker = (opts: unknown) => Promise<FileHandleLike>;

const hook = (): SaveHook | undefined => (globalThis as unknown as { __wtoonSaveFile?: SaveHook }).__wtoonSaveFile;
const picker = (): Picker | undefined => {
  const f = (globalThis as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker;
  return typeof f === 'function' ? f.bind(globalThis) : undefined;
};

/** 같은 파일에 덮어쓰기를 지원하는 환경인가 */
export const canOverwrite = () => !hook() && !!picker();

export type SaveOutcome =
  | { kind: 'overwritten' | 'picked'; handle: FileHandleLike; name: string }
  | { kind: 'downloaded'; name: string }
  | { kind: 'canceled' };

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

async function write(handle: FileHandleLike, blob: Blob) {
  const w = await handle.createWritable();
  try {
    await w.write(blob);
  } finally {
    await w.close();
  }
}

/**
 * 프로젝트 파일을 저장한다.
 * @param handle 이전에 저장한 파일(있으면 같은 파일에 덮어씀)
 * @param asNew  true 면 항상 저장 위치를 새로 묻는다(다른 이름으로 저장)
 */
export async function saveProjectFile(text: string, filename: string, handle: FileHandleLike | null, asNew = false): Promise<SaveOutcome> {
  const blob = new Blob([text], { type: 'application/json' });
  const h = hook();
  if (h) {
    await h(blob, filename);
    return { kind: 'downloaded', name: filename };
  }
  const pick = picker();
  if (!pick) {
    downloadBlob(blob, filename);
    return { kind: 'downloaded', name: filename };
  }
  if (handle && !asNew) {
    try {
      await write(handle, blob);
      return { kind: 'overwritten', handle, name: handle.name };
    } catch {
      // 권한을 잃었거나 파일이 사라진 경우 → 아래에서 위치를 다시 묻는다
    }
  }
  try {
    const nh = await pick({ suggestedName: handle?.name ?? filename, types: [{ description: '웹툰 프로젝트', accept: { 'application/json': ['.wtoon'] } }] });
    await write(nh, blob);
    return { kind: 'picked', handle: nh, name: nh.name };
  } catch (e) {
    if (isAbort(e)) return { kind: 'canceled' };
    // 저장 창을 쓸 수 없는 화면(보안 제한 등) → 다운로드로 대신한다
    downloadBlob(blob, filename);
    return { kind: 'downloaded', name: filename };
  }
}
