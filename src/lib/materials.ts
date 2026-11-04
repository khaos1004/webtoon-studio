/**
 * 소재(Material) 라이브러리
 *  - 클립스튜디오 등에서 내려받아 PNG/JPG/SVG 로 꺼낸 톤·효과선·질감·스탬프를 가져온다.
 *  - ZIP 으로 묶인 이미지 여러 장도 한 번에 가져온다.
 *  - 가져온 소재는 이 브라우저(IndexedDB)에만 저장된다. 외부로 전송하지 않는다.
 *
 * 이 파일의 레지스트리 부분(registerMaterial/getMaterial)은 Web Worker 에서도 쓰이므로 DOM 에 의존하지 않는다.
 */
import type { Material } from './types';
import { uid } from './types';
import type { RGBA } from './effects';

/* ------------------------------ 픽셀 레지스트리 (워커 공용) ------------------------------ */

const registry = new Map<string, { rgba: RGBA; version: number }>();
let versionSeq = 1;
const listeners = new Set<() => void>();

export function registerMaterial(id: string, rgba: RGBA) {
  registry.set(id, { rgba, version: versionSeq++ });
  listeners.forEach((l) => l());
}

export function getMaterial(id: string): RGBA | null {
  return registry.get(id)?.rgba ?? null;
}

/** 캐시 키에 넣어 소재가 바뀌거나 늦게 준비되면 결과를 다시 계산하게 한다 */
export function materialVersion(id: string): number {
  return registry.get(id)?.version ?? 0;
}

export function hasMaterial(id: string) {
  return registry.has(id);
}

export function subscribeMaterials(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let snapshotVersion = 0;
subscribeMaterials(() => {
  snapshotVersion++;
});
export const materialsSnapshot = () => snapshotVersion;

/* ------------------------------ 가져오기(브라우저) ------------------------------ */

const MAX_SIDE = 2048;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|avif|psd)$/i;
const MAX_ZIP_FILES = 300;
const MAX_ZIP_BYTES = 120 * 1024 * 1024;

export const isImageName = (name: string) => IMAGE_EXT.test(name);

function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽을 수 없어요'));
    };
    img.src = url;
  });
}

/** 픽셀을 보고 소재 성격을 추정한다 */
export function analyzePixels(d: Uint8ClampedArray): Material['hint'] {
  let n = 0;
  let transparent = 0;
  let sumLum = 0;
  let colorful = 0;
  const step = Math.max(1, Math.floor(d.length / 4 / 20000));
  for (let i = 0; i < d.length; i += 4 * step) {
    n++;
    const a = d[i + 3];
    if (a < 245) transparent++;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    sumLum += 0.299 * r + 0.587 * g + 0.114 * b;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 28) colorful++;
  }
  if (!n) return 'color';
  if (transparent / n > 0.04) return 'alpha';
  if (colorful / n > 0.08) return 'color';
  return sumLum / n > 128 ? 'ink' : 'light';
}

export async function imageBlobToMaterial(blob: Blob, name: string): Promise<Material> {
  let img: HTMLImageElement;
  if (/\.svg$/i.test(name) || blob.type === 'image/svg+xml') {
    // 크기 정보가 없는 SVG 도 읽히도록 텍스트에서 width/height 를 보정한다
    const text = await blob.text();
    const fixed = /<svg[^>]*\swidth=/i.test(text) ? text : text.replace(/<svg/i, '<svg width="1024" height="1024"');
    img = await loadBlobImage(new Blob([fixed], { type: 'image/svg+xml' }));
  } else {
    img = await loadBlobImage(blob);
  }
  const nw = img.naturalWidth || img.width || 512;
  const nh = img.naturalHeight || img.height || 512;
  const k = Math.min(1, MAX_SIDE / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * k));
  const h = Math.max(1, Math.round(nh * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const hint = analyzePixels(ctx.getImageData(0, 0, w, h).data);
  return { id: uid(), name: name.replace(/\.[^.]+$/, '').slice(0, 40) || '소재', src: canvas.toDataURL('image/png'), w, h, hint };
}

/** dataURL → 픽셀 → 레지스트리 */
export async function ensureMaterialPixels(m: Material): Promise<void> {
  if (hasMaterial(m.id)) return;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('소재를 읽을 수 없어요'));
    i.src = m.src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = m.w;
  canvas.height = m.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, m.w, m.h);
  const d = ctx.getImageData(0, 0, m.w, m.h);
  registerMaterial(m.id, { data: d.data, width: d.width, height: d.height });
  remoteHook?.(m.id, { data: d.data, width: d.width, height: d.height });
}

let remoteHook: ((id: string, rgba: RGBA) => void) | null = null;
/** renderClient 가 워커로 소재 픽셀을 보내도록 연결한다 */
export function setMaterialRemoteHook(fn: (id: string, rgba: RGBA) => void) {
  remoteHook = fn;
}

export function remoteResend(ids?: string[]) {
  if (!remoteHook) return;
  for (const [id, v] of registry) if (!ids || ids.includes(id)) remoteHook(id, v.rgba);
}

/* ------------------------------ PSD 합성 이미지 읽기 (의존성 없음) ------------------------------ */

export interface PsdImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * PSD 파일 끝에 들어 있는 "합쳐진 이미지"만 읽는다 (레이어는 읽지 않는다).
 * 8·16비트 RGB / 그레이스케일, 비압축·RLE(PackBits) 지원. 클립스튜디오·포토샵의 PSD 내보내기 파일 대부분이 해당한다.
 */
export function readPsdComposite(buf: ArrayBuffer): PsdImage {
  const b = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (b.length < 40 || b[0] !== 0x38 || b[1] !== 0x42 || b[2] !== 0x50 || b[3] !== 0x53) throw new Error('PSD 파일이 아니에요');
  const version = dv.getUint16(4);
  if (version !== 1) throw new Error('PSB(대용량) 형식은 지원하지 않아요');
  const channels = dv.getUint16(12);
  const height = dv.getUint32(14);
  const width = dv.getUint32(18);
  const depth = dv.getUint16(22);
  const mode = dv.getUint16(24);
  if (width < 1 || height < 1 || width * height > 64_000_000) throw new Error('이미지가 너무 커요');
  if (depth !== 8 && depth !== 16) throw new Error(`${depth}비트 PSD는 지원하지 않아요`);
  if (mode !== 3 && mode !== 1) throw new Error('RGB·그레이스케일 PSD만 지원해요 (CMYK 등은 PNG로 내보내 주세요)');
  let p = 26;
  for (let i = 0; i < 3; i++) {
    if (p + 4 > b.length) throw new Error('PSD 구조가 올바르지 않아요');
    p += 4 + dv.getUint32(p); // 색상 모드 데이터 / 이미지 리소스 / 레이어·마스크 정보
  }
  if (p + 2 > b.length) throw new Error('합쳐진 이미지가 없는 PSD예요. 저장할 때 “호환성 최대화”를 켜거나 PNG로 내보내 주세요');
  const comp = dv.getUint16(p);
  p += 2;
  const bytes = depth / 8;
  const planeBytes = width * height * bytes;
  const used = Math.min(channels, mode === 3 ? 4 : 2);
  const planes: Uint8Array[] = [];
  if (comp === 0) {
    for (let c = 0; c < used; c++) {
      if (p + planeBytes * (c + 1) > b.length) throw new Error('PSD 데이터가 잘려 있어요');
      planes.push(b.subarray(p + planeBytes * c, p + planeBytes * (c + 1)));
    }
  } else if (comp === 1) {
    // 행별 압축 길이 표(채널×높이×2바이트) 다음에 PackBits 데이터가 이어진다
    const counts = p;
    let q = p + channels * height * 2;
    for (let c = 0; c < channels; c++) {
      const plane = c < used ? new Uint8Array(planeBytes) : null;
      let o = 0;
      for (let y = 0; y < height; y++) {
        const len = dv.getUint16(counts + (c * height + y) * 2);
        const end = q + len;
        if (end > b.length) throw new Error('PSD 데이터가 잘려 있어요');
        if (plane) {
          const rowEnd = o + width * bytes;
          while (q < end && o < rowEnd) {
            const n = (b[q++] << 24) >> 24;
            if (n >= 0) {
              const cnt = n + 1;
              for (let k = 0; k < cnt && o < rowEnd; k++) plane[o++] = b[q++];
            } else if (n !== -128) {
              const cnt = 1 - n;
              const v = b[q++];
              for (let k = 0; k < cnt && o < rowEnd; k++) plane[o++] = v;
            }
          }
          o = rowEnd;
        }
        q = end;
      }
      if (plane) planes.push(plane);
    }
  } else {
    throw new Error('ZIP 압축된 PSD는 지원하지 않아요. PNG로 내보내 주세요');
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const n = width * height;
  const at = (pl: Uint8Array, i: number) => pl[i * bytes];
  const hasAlpha = used === (mode === 3 ? 4 : 2);
  for (let i = 0; i < n; i++) {
    const q = i * 4;
    if (mode === 3) {
      out[q] = at(planes[0], i);
      out[q + 1] = at(planes[1], i);
      out[q + 2] = at(planes[2], i);
      out[q + 3] = hasAlpha ? at(planes[3], i) : 255;
    } else {
      const v = at(planes[0], i);
      out[q] = out[q + 1] = out[q + 2] = v;
      out[q + 3] = hasAlpha ? at(planes[1], i) : 255;
    }
  }
  return { width, height, data: out };
}

async function psdToMaterial(buf: ArrayBuffer, name: string): Promise<Material> {
  const img = readPsdComposite(buf);
  const k = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const src = document.createElement('canvas');
  src.width = img.width;
  src.height = img.height;
  src.getContext('2d')!.putImageData(new ImageData(img.data as unknown as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  const hint = analyzePixels(ctx.getImageData(0, 0, w, h).data);
  return { id: uid(), name: name.replace(/\.[^.]+$/, '').slice(0, 40) || '소재', src: canvas.toDataURL('image/png'), w, h, hint };
}

/* ------------------------------ ZIP 읽기 (의존성 없음) ------------------------------ */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: new (f: string) => TransformStream }).DecompressionStream;
  if (!DS) throw new Error('이 브라우저는 ZIP 압축 해제를 지원하지 않아요. 압축을 풀고 이미지를 직접 선택해 주세요');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 중앙 디렉터리를 읽어 파일을 꺼낸다. 폴더·숨김(__MACOSX)·이미지가 아닌 파일은 건너뛴다. */
export async function readZip(buf: ArrayBuffer, filter: (name: string) => boolean = isImageName): Promise<ZipEntry[]> {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP 파일이 아니에요');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder('utf-8');
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) break;
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    const csize = u32(b, p + 20);
    const usize = u32(b, p + 24);
    const nlen = u16(b, p + 28);
    const elen = u16(b, p + 30);
    const clen = u16(b, p + 32);
    const lho = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/') || name.startsWith('__MACOSX') || name.split('/').pop()!.startsWith('.') || !filter(name)) continue;
    if (flags & 1) throw new Error('암호가 걸린 ZIP 은 읽을 수 없어요');
    if (out.length >= MAX_ZIP_FILES) throw new Error(`ZIP 안의 파일이 너무 많아요(최대 ${MAX_ZIP_FILES}개)`);
    total += usize;
    if (total > MAX_ZIP_BYTES) throw new Error('ZIP 이 너무 커요');
    if (u32(b, lho) !== 0x04034b50) continue;
    const start = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
    const raw = b.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else continue;
    out.push({ name, data });
  }
  return out;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif' };

export interface ImportResult {
  added: Material[];
  skipped: string[];
}

/** 이미지·ZIP 파일들을 소재로 변환 */
export async function importMaterialFiles(files: File[], onProgress?: (msg: string) => void): Promise<ImportResult> {
  const added: Material[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const lower = f.name.toLowerCase();
    try {
      if (lower.endsWith('.zip')) {
        const entries = await readZip(await f.arrayBuffer());
        if (!entries.length) skipped.push(`${f.name} (이미지 없음)`);
        for (const e of entries) {
          onProgress?.(`${e.name} 가져오는 중…`);
          const ext = e.name.split('.').pop()!.toLowerCase();
          try {
            const nm = e.name.split('/').pop()!;
            added.push(ext === 'psd' ? await psdToMaterial(e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength) as ArrayBuffer, nm) : await imageBlobToMaterial(new Blob([e.data as BlobPart], { type: MIME[ext] ?? 'image/png' }), nm));
          } catch {
            skipped.push(e.name);
          }
        }
      } else if (lower.endsWith('.psd')) {
        onProgress?.(`${f.name} 가져오는 중…`);
        added.push(await psdToMaterial(await f.arrayBuffer(), f.name));
      } else if (isImageName(lower) || f.type.startsWith('image/')) {
        onProgress?.(`${f.name} 가져오는 중…`);
        added.push(await imageBlobToMaterial(f, f.name));
      } else {
        skipped.push(`${f.name} (지원하지 않는 형식)`);
      }
    } catch (e) {
      skipped.push(`${f.name} (${(e as Error).message})`);
    }
  }
  return { added, skipped };
}

/* ------------------------------ 내장 소재(public/materials) ------------------------------ */

/** public/materials/manifest.json 의 소재 목록. 없거나 못 읽으면 빈 목록(데모·file:// 등) */
export async function loadBuiltinMaterials(): Promise<Material[]> {
  try {
    const base = typeof document !== 'undefined' ? document.baseURI : location.href;
    if (!/^https?:/i.test(base)) return []; // file:// 등에서는 fetch 가 막혀 있다
    const url = (p: string) => new URL('materials/' + p, base).toString();
    const res = await fetch(url('manifest.json'), { cache: 'no-cache' });
    if (!res.ok) return [];
    const j = (await res.json()) as { items?: { id: string; name: string; file: string; thumb?: string; w: number; h: number; hint?: Material['hint'] }[] };
    return (j.items ?? []).map((x) => ({ id: x.id, name: x.name, src: url(x.file), thumb: x.thumb ? url(x.thumb) : undefined, w: x.w, h: x.h, hint: x.hint ?? 'alpha', builtin: true }));
  } catch {
    return [];
  }
}

/** 내장 소재를 .wtoon 에 담을 수 있게 파일 주소 → dataURL */
export async function materialToPortable(m: Material): Promise<Material> {
  if (!m.builtin) return m;
  const blob = await (await fetch(m.src)).blob();
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('소재를 읽을 수 없어요'));
    r.readAsDataURL(blob);
  });
  return { id: m.id, name: m.name, src, w: m.w, h: m.h, hint: m.hint };
}

/* ------------------------------ 영구 저장(IndexedDB) ------------------------------ */

const DB = 'wtoon-materials';
const STORE = 'items';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function loadLibrary(): Promise<Material[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const rq = db.transaction(STORE).objectStore(STORE).getAll();
      rq.onsuccess = () => resolve((rq.result as Material[]).sort((a, b) => a.name.localeCompare(b.name)));
      rq.onerror = () => reject(rq.error);
    });
  } catch {
    return [];
  }
}

export async function saveToLibrary(items: Material[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      items.forEach((m) => tx.objectStore(STORE).put(m));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 저장소를 쓸 수 없는 환경(시크릿 모드 등)에서는 이번 방문에서만 유지된다 */
  }
}

export async function removeFromLibrary(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
