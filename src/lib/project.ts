import { PAGE_WIDTH, type Bubble, type Cut, type PageLayer, type Project } from './types';
import { bubbleBounds, bubbleMarkup, bubblesSvgDocument } from './bubble';
import { loadImage, renderCutCanvas } from './imageIO';
import { BASE_PARAMS } from './effectMeta';
import { ensureMaterialPixels } from './materials';
import { drawPageLayer, drawPageLayers, layerBounds, preloadLayerImages } from './pagelayers';
import { planSlices, safeCutPositions, type SliceRange } from './slice';
import { makeZip } from './zipwrite';

/* ------------------------------ 레이아웃 ------------------------------ */

/** 컷 위쪽 간격: 컷마다 정한 값이 있으면 그것, 없으면 프로젝트 기본 간격 */
export const gapOf = (cut: Cut, base: number) => Math.max(0, Number.isFinite(cut.gapBefore) ? (cut.gapBefore as number) : base);

export function layoutCuts(project: Pick<Project, 'cuts' | 'gap'> & { padTop?: number; padBottom?: number }) {
  const padTop = project.padTop ?? 0;
  const padBottom = project.padBottom ?? 0;
  let top = padTop;
  const items = project.cuts.map((cut, i) => {
    if (i > 0) top += gapOf(cut, project.gap);
    const it = { cut, top };
    top += cut.height;
    return it;
  });
  const total = Math.max(300, top + padBottom);
  return { items, total };
}

/** 컷 프레임(좌우 여백, 둥근 모서리, 테두리) 값 */
export const cutFrame = (c: Cut) => ({
  inset: Math.max(0, c.inset ?? 0),
  radius: Math.max(0, c.radius ?? 0),
  border: Math.max(0, c.border ?? 0),
  borderColor: c.borderColor ?? '#000000',
});

/* ------------------------------ 저장 / 불러오기 ------------------------------ */

export function downloadBlob(blob: Blob, filename: string) {
  // 임베드 화면(데모 등)이 파일 저장 방법을 직접 넣어 둔 경우 그것을 쓴다
  const hook = (globalThis as unknown as { __wtoonSaveFile?: (b: Blob, n: string) => void | Promise<void> }).__wtoonSaveFile;
  if (hook) {
    void Promise.resolve(hook(blob, filename)).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function serializeProject(p: Project): string {
  return JSON.stringify({ format: 'wtoon', ...p });
}

export function parseProject(text: string): Project {
  const j = JSON.parse(text);
  if (!j || j.format !== 'wtoon' || !Array.isArray(j.cuts) || !Array.isArray(j.bubbles)) throw new Error('올바른 .wtoon 파일이 아닙니다');
  return {
    version: 1,
    gap: typeof j.gap === 'number' ? j.gap : 40,
    padTop: typeof j.padTop === 'number' ? j.padTop : 0,
    padBottom: typeof j.padBottom === 'number' ? j.padBottom : 0,
    bg: typeof j.bg === 'string' ? j.bg : '#ffffff',
    cuts: (j.cuts as Cut[]).map((c) => {
      const { gapBefore, ...rest } = c;
      const gb = typeof gapBefore === 'number' && Number.isFinite(gapBefore) ? { gapBefore: Math.max(0, Math.min(2000, gapBefore)) } : {};
      return { ...rest, ...gb, effects: (c.effects ?? []).map((e) => ({ ...e, params: { ...BASE_PARAMS, ...e.params } })) };
    }),
    materials: Array.isArray(j.materials) ? j.materials : [],
    layers: Array.isArray(j.layers) ? j.layers : [],
    bubbles: j.bubbles,
  };
}

/* ------------------------------ 내보내기 ------------------------------ */

async function svgToImage(svg: string): Promise<HTMLImageElement> {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return loadImage(url);
}

/** 프레임(좌우 여백·둥근 모서리·테두리)을 적용해서 컷 하나를 그린다 */
export function drawCutFramed(ctx: CanvasRenderingContext2D, cut: Cut, canvas: HTMLCanvasElement, top: number) {
  const f = cutFrame(cut);
  const w = PAGE_WIDTH - f.inset * 2;
  ctx.save();
  if (f.radius > 0 || f.inset > 0) {
    ctx.beginPath();
    if (f.radius > 0 && 'roundRect' in ctx) (ctx as CanvasRenderingContext2D & { roundRect: (...a: number[]) => void }).roundRect(f.inset, top, w, cut.height, f.radius);
    else ctx.rect(f.inset, top, w, cut.height);
    ctx.clip();
  }
  ctx.drawImage(canvas, 0, top);
  ctx.restore();
  if (f.border > 0) {
    ctx.save();
    ctx.lineWidth = f.border;
    ctx.strokeStyle = f.borderColor;
    ctx.beginPath();
    const b = f.border / 2;
    if (f.radius > 0 && 'roundRect' in ctx) (ctx as CanvasRenderingContext2D & { roundRect: (...a: number[]) => void }).roundRect(f.inset + b, top + b, w - f.border, cut.height - f.border, Math.max(0, f.radius - b));
    else ctx.rect(f.inset + b, top + b, w - f.border, cut.height - f.border);
    ctx.stroke();
    ctx.restore();
  }
}

/** 브라우저 캔버스가 안전하게 다루는 세로 한계(이보다 길면 한 장으로 만들 수 없다) */
export const MAX_CANVAS_SIDE = 32000;

export interface StripRegion {
  y0: number;
  y1: number;
}

/**
 * 배경 레이어 + 컷 + 효과 + 앞 레이어 + 말풍선을 합친 세로 스트립.
 * region 을 주면 그 세로 구간만 그린다(긴 웹툰을 조각으로 내보낼 때 쓴다).
 * cutCache 를 주면 효과까지 계산한 컷 그림을 재사용한다.
 */
export async function renderStrip(project: Project, region?: StripRegion, cutCache?: Map<string, HTMLCanvasElement>): Promise<HTMLCanvasElement> {
  const { items, total } = layoutCuts(project);
  const y0 = region ? Math.max(0, Math.floor(region.y0)) : 0;
  const y1 = region ? Math.min(total, Math.ceil(region.y1)) : total;
  const h = Math.max(1, y1 - y0);
  if (h > MAX_CANVAS_SIDE) throw new Error(`세로가 너무 길어요(${MAX_CANVAS_SIDE.toLocaleString()}px 초과). “분할 저장”으로 나눠서 내보내 주세요`);
  await ensureProjectMaterials(project);
  await preloadLayerImages(project.layers);
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.translate(0, -y0);
  ctx.fillStyle = project.bg || '#ffffff';
  ctx.fillRect(0, y0, PAGE_WIDTH, h);
  drawPageLayers(ctx, project.layers, 'back', PAGE_WIDTH, total);
  for (const { cut, top } of items) {
    if (top + cut.height <= y0 || top >= y1) continue;
    let c = cutCache?.get(cut.id);
    if (!c) {
      c = await renderCutCanvas(cut);
      cutCache?.set(cut.id, c);
    }
    drawCutFramed(ctx, cut, c, top);
  }
  drawPageLayers(ctx, project.layers, 'front', PAGE_WIDTH, total);
  ctx.restore();
  if (project.bubbles.length) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${h}" viewBox="0 ${y0} ${PAGE_WIDTH} ${h}">${project.bubbles.map(bubbleMarkup).join('')}</svg>`;
    const img = await svgToImage(svg);
    ctx.drawImage(img, 0, 0);
  }
  return canvas;
}

/* ------------------------------ 분할 내보내기 ------------------------------ */

export interface SliceExportOptions {
  format: 'jpg' | 'png';
  /** 출력 가로(px). PAGE_WIDTH 와 다르면 비율대로 줄이거나 늘린다 */
  width: number;
  /** 조각 하나의 최대 세로(출력 px). 0 이면 나누지 않는다 */
  maxHeight: number;
  /** JPG 품질 0.5~1 */
  quality: number;
}

export interface SliceExportResult {
  blob: Blob;
  filename: string;
  count: number;
  /** 조각별 파일 크기(바이트) */
  sizes: number[];
  /** 조각별 출력 크기 */
  dims: { w: number; h: number }[];
}

/** 출력 크기를 기준으로 한 조각 구간(원본 좌표)과 출력 높이를 계산한다 */
export function planExport(project: Project, opt: Pick<SliceExportOptions, 'width' | 'maxHeight'>) {
  const { items, total } = layoutCuts(project);
  const scale = Math.max(1, opt.width) / PAGE_WIDTH;
  const ranges = opt.maxHeight > 0 ? planSlices(total, Math.floor(opt.maxHeight / scale), safeCutPositions(items.map((i) => ({ top: i.top, height: i.cut.height })))) : ([[0, total]] as SliceRange[]);
  return { total, scale, ranges, outWidth: Math.max(1, Math.round(opt.width)) };
}

export async function exportSliced(project: Project, opt: SliceExportOptions, onProgress?: (done: number, count: number) => void): Promise<SliceExportResult> {
  const { scale, ranges, outWidth } = planExport(project, opt);
  const mime = opt.format === 'jpg' ? 'image/jpeg' : 'image/png';
  const ext = opt.format;
  const cache = new Map<string, HTMLCanvasElement>();
  const files: { name: string; data: Uint8Array }[] = [];
  const sizes: number[] = [];
  const dims: { w: number; h: number }[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const [y0, y1] = ranges[i];
    const strip = await renderStrip(project, { y0, y1 }, cache);
    const outH = Math.max(1, Math.round((y1 - y0) * scale));
    let canvas = strip;
    if (outWidth !== PAGE_WIDTH || outH !== strip.height) {
      canvas = document.createElement('canvas');
      canvas.width = outWidth;
      canvas.height = outH;
      const c = canvas.getContext('2d')!;
      c.imageSmoothingQuality = 'high';
      c.drawImage(strip, 0, 0, outWidth, outH);
    }
    const blob = await canvasToBlob(canvas, mime, Math.min(1, Math.max(0.5, opt.quality)));
    sizes.push(blob.size);
    dims.push({ w: outWidth, h: outH });
    files.push({ name: `webtoon_${String(i + 1).padStart(3, '0')}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) });
    onProgress?.(i + 1, ranges.length);
  }
  if (files.length === 1) {
    return { blob: new Blob([files[0].data as BlobPart], { type: mime }), filename: `webtoon.${ext}`, count: 1, sizes, dims };
  }
  return { blob: new Blob([makeZip(files) as BlobPart], { type: 'application/zip' }), filename: 'webtoon-slices.zip', count: files.length, sizes, dims };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지 생성 실패'))), type, quality));
}

async function bubbleCanvas(b: Bubble) {
  const bb = bubbleBounds(b);
  const w = Math.ceil(bb.w);
  const h = Math.ceil(bb.h);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bb.x} ${bb.y} ${bb.w} ${bb.h}">${bubbleMarkup(b)}</svg>`;
  const img = await svgToImage(svg);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return { canvas, left: Math.round(bb.x), top: Math.round(bb.y) };
}

const PSD_BLEND: Record<string, string> = { normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', 'soft-light': 'soft light' };

function layerCanvas(l: PageLayer, pageW: number, pageH: number) {
  const b = layerBounds(l, pageW, pageH);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, b.w);
  canvas.height = Math.max(1, b.h);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(-b.x, -b.y);
  drawPageLayer(ctx, l, pageW, pageH, false);
  return { canvas, left: b.x, top: b.y };
}

/** 배경·컷·앞 장식·말풍선이 각각 별도 레이어인 PSD (말풍선 글자는 래스터) */
export async function exportPsd(project: Project): Promise<Blob> {
  const { writePsd } = await import('ag-psd');
  const { items, total } = layoutCuts(project);
  await ensureProjectMaterials(project);
  await preloadLayerImages(project.layers);
  const children: any[] = [];
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = PAGE_WIDTH;
  bgCanvas.height = total;
  const bctx = bgCanvas.getContext('2d')!;
  bctx.fillStyle = project.bg || '#ffffff';
  bctx.fillRect(0, 0, PAGE_WIDTH, total);
  children.push({ name: '바탕색', top: 0, left: 0, canvas: bgCanvas });
  const pushPage = (z: 'back' | 'front') => {
    for (const l of project.layers) {
      if (!l.visible || l.z !== z) continue;
      const { canvas, left, top } = layerCanvas(l, PAGE_WIDTH, total);
      children.push({ name: l.name, top, left, canvas, opacity: l.opacity, blendMode: PSD_BLEND[l.blend] });
    }
  };
  pushPage('back');
  for (let i = 0; i < items.length; i++) {
    const { cut, top } = items[i];
    const framed = document.createElement('canvas');
    framed.width = PAGE_WIDTH;
    framed.height = cut.height;
    drawCutFramed(framed.getContext('2d')!, cut, await renderCutCanvas(cut), 0);
    children.push({ name: `컷 ${i + 1}`, top, left: 0, canvas: framed });
  }
  pushPage('front');
  for (let i = 0; i < project.bubbles.length; i++) {
    const b = project.bubbles[i];
    const { canvas, left, top } = await bubbleCanvas(b);
    children.push({ name: `말풍선 ${i + 1}`, top, left, canvas });
  }
  const buf = writePsd({ width: PAGE_WIDTH, height: total, children } as any);
  return new Blob([buf as ArrayBuffer], { type: 'image/vnd.adobe.photoshop' });
}

/** 프로젝트가 쓰는 소재의 픽셀을 준비한다(효과 계산·내보내기 전에 호출) */
export async function ensureProjectMaterials(project: Pick<Project, 'materials'>): Promise<void> {
  for (const m of project.materials ?? []) await ensureMaterialPixels(m);
}
