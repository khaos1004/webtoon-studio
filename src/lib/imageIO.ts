import { PAGE_WIDTH, uid, type Cut } from './types';
import type { RGBA } from './effects';
import { renderEffects } from './render';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다'));
    img.src = src;
  });
}

/** 이미지를 가로 PAGE_WIDTH 로 맞추고 흰 배경 위에 합쳐서 컷으로 만든다 */
export async function imageToCut(img: HTMLImageElement, preferPng: boolean): Promise<Cut> {
  const height = Math.max(1, Math.round((img.naturalHeight * PAGE_WIDTH) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, PAGE_WIDTH, height);
  // 투명한 PNG 는 투명도를 유지한다(컷 배경색이 뒤에 깔림)
  let alpha = false;
  if (preferPng) {
    const d = ctx.getImageData(0, 0, PAGE_WIDTH, height).data;
    for (let i = 3; i < d.length; i += 4 * 5) if (d[i] < 250) { alpha = true; break; }
  }
  let src: string;
  if (alpha) src = canvas.toDataURL('image/png');
  else {
    // 불투명: 흰 배경 위에 합쳐 JPEG/PNG 로 저장
    const flat = document.createElement('canvas');
    flat.width = PAGE_WIDTH;
    flat.height = height;
    const fctx = flat.getContext('2d')!;
    fctx.fillStyle = '#ffffff';
    fctx.fillRect(0, 0, PAGE_WIDTH, height);
    fctx.drawImage(canvas, 0, 0);
    src = preferPng ? flat.toDataURL('image/png') : flat.toDataURL('image/jpeg', 0.95);
  }
  return { id: uid(), src, height, effects: [], bg: alpha ? 'transparent' : '#ffffff' };
}

export async function fileToCut(file: File): Promise<Cut> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return await imageToCut(img, file.type === 'image/png' && file.size < 2_500_000);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const baseCache = new Map<string, { src: string; bg: string; rgba: RGBA }>();

/** 컷 원본 픽셀(효과 적용 전). 같은 src 면 캐시를 재사용 */
export async function getBase(cut: Cut): Promise<RGBA> {
  const bg = cut.bg ?? '#ffffff';
  const hit = baseCache.get(cut.id);
  if (hit && hit.src === cut.src && hit.bg === bg) return hit.rgba;
  const img = await loadImage(cut.src);
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = cut.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, PAGE_WIDTH, cut.height);
  }
  ctx.drawImage(img, 0, 0, PAGE_WIDTH, cut.height);
  const d = ctx.getImageData(0, 0, PAGE_WIDTH, cut.height);
  const rgba: RGBA = { data: d.data, width: d.width, height: d.height };
  baseCache.set(cut.id, { src: cut.src, bg, rgba });
  return rgba;
}

export function putRGBA(canvas: HTMLCanvasElement, rgba: RGBA) {
  canvas.width = rgba.width;
  canvas.height = rgba.height;
  const ctx = canvas.getContext('2d')!;
  // ImageData 는 ArrayBuffer 기반 Uint8ClampedArray 가 필요하다
  const copy = new Uint8ClampedArray(rgba.data);
  ctx.putImageData(new ImageData(copy, rgba.width, rgba.height), 0, 0);
}

/** 효과까지 적용된 컷을 캔버스로 만든다 (내보내기용) */
export async function renderCutCanvas(cut: Cut): Promise<HTMLCanvasElement> {
  const base = await getBase(cut);
  const out = renderEffects(base, cut.effects);
  const canvas = document.createElement('canvas');
  putRGBA(canvas, out);
  return canvas;
}
