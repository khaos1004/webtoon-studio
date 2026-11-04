import { PAGE_WIDTH, uid, type BlendMode, type PageLayer, type PageLayerKind } from './types';
import { mulberry32 } from './effects';

/* ------------------------------ 생성 ------------------------------ */

export const BLEND_LABELS: Record<BlendMode, string> = {
  normal: '보통',
  multiply: '곱하기',
  screen: '스크린(밝게)',
  overlay: '오버레이',
  'soft-light': '소프트 라이트',
  add: '더하기(빛)',
};

export const KIND_LABELS: Record<PageLayerKind, string> = {
  color: '단색',
  gradient: '그라데이션',
  pattern: '패턴',
  image: '이미지',
  shape: '도형',
};

export const PATTERN_LABELS: Record<PageLayer['pattern'], string> = {
  dots: '망점',
  stripes: '줄무늬',
  grid: '격자',
  checker: '체크',
  speed: '속도선 배경',
  focus: '집중선 배경',
};

export const SHAPE_LABELS: Record<PageLayer['shape'], string> = {
  rect: '사각형',
  ellipse: '원',
  triangle: '삼각형',
  star: '별',
  burst: '폭발',
};

export function createLayer(kind: PageLayerKind, pageHeight: number, patch: Partial<PageLayer> = {}): PageLayer {
  const base: PageLayer = {
    id: uid(),
    kind,
    name: KIND_LABELS[kind],
    visible: true,
    z: 'back',
    full: kind === 'color' || kind === 'gradient' || kind === 'pattern',
    x: PAGE_WIDTH * 0.2,
    y: Math.max(0, pageHeight * 0.1),
    w: PAGE_WIDTH * 0.6,
    h: PAGE_WIDTH * 0.6,
    rotation: 0,
    opacity: 1,
    blend: 'normal',
    color: '#f6d365',
    color2: '#fda085',
    angle: 90,
    pattern: 'dots',
    scale: 22,
    src: '',
    imgW: 0,
    imgH: 0,
    fit: 'cover',
    flip: false,
    shape: 'ellipse',
    radius: 0,
    stroke: '#000000',
    strokeWidth: 0,
    seed: 3,
  };
  if (kind === 'color') base.color = '#cfe8ff';
  if (kind === 'gradient') {
    base.color = '#a1c4fd';
    base.color2 = '#fbc2eb';
  }
  if (kind === 'pattern') {
    base.color = '#000000';
    base.color2 = '#ffffff';
    base.opacity = 0.18;
    base.blend = 'multiply';
  }
  if (kind === 'shape') {
    base.color = '#ffd84d';
    base.w = 260;
    base.h = 260;
    base.x = PAGE_WIDTH / 2 - 130;
  }
  const out = { ...base, ...patch };
  if (patch.name === undefined) out.name = KIND_LABELS[kind] + (kind === 'pattern' ? ` · ${PATTERN_LABELS[out.pattern]}` : '');
  return out;
}

/* ------------------------------ 이미지 캐시 ------------------------------ */

const imgCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();
const waiters = new Set<() => void>();

export function onLayerImageLoaded(cb: () => void) {
  waiters.add(cb);
  return () => waiters.delete(cb);
}

export function layerImage(src: string): HTMLImageElement | undefined {
  if (!src) return undefined;
  const hit = imgCache.get(src);
  if (hit && hit !== 'loading' && hit !== 'error') return hit;
  if (!hit) {
    imgCache.set(src, 'loading');
    const img = new Image();
    img.onload = () => {
      imgCache.set(src, img);
      waiters.forEach((w) => w());
    };
    img.onerror = () => imgCache.set(src, 'error');
    img.src = src;
  }
  return undefined;
}

/** 내보내기 전에 모든 이미지 레이어를 불러 둔다 */
export async function preloadLayerImages(layers: PageLayer[]) {
  await Promise.all(
    layers
      .filter((l) => l.kind === 'image' && l.src)
      .map(
        (l) =>
          new Promise<void>((resolve) => {
            if (layerImage(l.src)) return resolve();
            const off = onLayerImageLoaded(() => {
              if (layerImage(l.src)) {
                off();
                resolve();
              }
            });
            setTimeout(() => {
              off();
              resolve();
            }, 4000);
          }),
      ),
  );
}

/** 파일을 레이어용 이미지로 변환 (긴 변 2000px 이하, 투명도 유지) */
export async function fileToLayerImage(file: File): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('이미지를 불러올 수 없습니다'));
      i.src = url;
    });
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    let alpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
    if (alpha) {
      alpha = false;
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { alpha = true; break; }
    }
    return { src: alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92), w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------ 기하 ------------------------------ */

export function layerBox(l: PageLayer, pageW: number, pageH: number) {
  return l.full ? { x: 0, y: 0, w: pageW, h: pageH } : { x: l.x, y: l.y, w: l.w, h: l.h };
}

/** 회전을 포함한 바깥 사각형(페이지 영역으로 자름) */
export function layerBounds(l: PageLayer, pageW: number, pageH: number) {
  const b = layerBox(l, pageW, pageH);
  if (l.full) return { x: 0, y: 0, w: pageW, h: pageH };
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const r = (l.rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const bw = b.w * c + b.h * s + l.strokeWidth * 2 + 4;
  const bh = b.w * s + b.h * c + l.strokeWidth * 2 + 4;
  const x0 = Math.max(0, Math.floor(cx - bw / 2));
  const y0 = Math.max(0, Math.floor(cy - bh / 2));
  const x1 = Math.min(pageW, Math.ceil(cx + bw / 2));
  const y1 = Math.min(pageH, Math.ceil(cy + bh / 2));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function pointInLayer(l: PageLayer, px: number, py: number) {
  if (l.full) return false;
  const cx = l.x + l.w / 2;
  const cy = l.y + l.h / 2;
  const r = (-l.rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r);
  const ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= l.w / 2 && Math.abs(ly) <= l.h / 2;
}

export function hitLayer(layers: PageLayer[], px: number, py: number): PageLayer | null {
  // front(위) → back(아래) 순서. 같은 z 에서는 배열 뒤쪽이 위.
  const front = layers.filter((l) => l.z === 'front' && l.visible).reverse();
  const back = layers.filter((l) => l.z === 'back' && l.visible).reverse();
  for (const l of [...front, ...back]) if (pointInLayer(l, px, py)) return l;
  return null;
}

/* ------------------------------ 그리기 ------------------------------ */

const COMPOSITE: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  add: 'lighter',
};

function polyPath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function shapePath(ctx: CanvasRenderingContext2D, l: PageLayer, w: number, h: number) {
  const hw = w / 2;
  const hh = h / 2;
  switch (l.shape) {
    case 'rect': {
      const r = Math.min(l.radius, hw, hh);
      ctx.beginPath();
      if (r > 0.5) {
        ctx.moveTo(-hw + r, -hh);
        ctx.arcTo(hw, -hh, hw, hh, r);
        ctx.arcTo(hw, hh, -hw, hh, r);
        ctx.arcTo(-hw, hh, -hw, -hh, r);
        ctx.arcTo(-hw, -hh, hw, -hh, r);
        ctx.closePath();
      } else ctx.rect(-hw, -hh, w, h);
      break;
    }
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      polyPath(ctx, [
        [0, -hh],
        [hw, hh],
        [-hw, hh],
      ]);
      break;
    case 'star': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.42 : 1;
        pts.push([Math.cos(a) * hw * k, Math.sin(a) * hh * k]);
      }
      polyPath(ctx, pts);
      break;
    }
    case 'burst': {
      const rand = mulberry32(l.seed);
      const n = 22;
      const pts: [number, number][] = [];
      for (let i = 0; i < n * 2; i++) {
        const a = (i * Math.PI) / n;
        const k = i % 2 ? 0.55 + rand() * 0.12 : 0.92 + rand() * 0.1;
        pts.push([Math.cos(a) * hw * k, Math.sin(a) * hh * k]);
      }
      polyPath(ctx, pts);
      break;
    }
  }
}

function drawPattern(ctx: CanvasRenderingContext2D, l: PageLayer, bx: number, by: number, bw: number, bh: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.clip();
  if (l.color2) {
    ctx.fillStyle = l.color2;
    ctx.fillRect(bx, by, bw, bh);
  }
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const R = Math.hypot(bw, bh) / 2 + 4;
  const s = Math.max(4, l.scale);
  ctx.translate(cx, cy);
  ctx.fillStyle = l.color;
  ctx.strokeStyle = l.color;
  if (l.pattern === 'focus') {
    const n = Math.round(clampN(2160 / s, 24, 420));
    const rand = mulberry32(l.seed);
    for (let i = 0; i < n; i++) {
      const a = ((i + rand() * 0.8) / n) * Math.PI * 2;
      const r0 = R * (0.16 + 0.1 * rand());
      const half = (Math.PI / n) * (0.2 + 0.55 * rand());
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a - half) * R, Math.sin(a - half) * R);
      ctx.lineTo(Math.cos(a + half) * R, Math.sin(a + half) * R);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.rotate((l.angle * Math.PI) / 180);
    if (l.pattern === 'dots') {
      const rad = s * 0.3;
      let row = 0;
      for (let y = -R; y < R; y += s * 0.866) {
        const off = row++ % 2 ? s / 2 : 0;
        for (let x = -R; x < R; x += s) {
          ctx.beginPath();
          ctx.arc(x + off, y, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (l.pattern === 'stripes') {
      for (let x = -R; x < R; x += s * 2) ctx.fillRect(x, -R, s, R * 2);
    } else if (l.pattern === 'grid') {
      ctx.lineWidth = Math.max(1, s * 0.06);
      for (let x = -R; x < R; x += s) {
        ctx.beginPath();
        ctx.moveTo(x, -R);
        ctx.lineTo(x, R);
        ctx.stroke();
      }
      for (let y = -R; y < R; y += s) {
        ctx.beginPath();
        ctx.moveTo(-R, y);
        ctx.lineTo(R, y);
        ctx.stroke();
      }
    } else if (l.pattern === 'checker') {
      let ri = 0;
      for (let y = -R; y < R; y += s, ri++) {
        let ci = 0;
        for (let x = -R; x < R; x += s, ci++) if ((ri + ci) % 2 === 0) ctx.fillRect(x, y, s, s);
      }
    } else if (l.pattern === 'speed') {
      const rand = mulberry32(l.seed);
      const lines = Math.round(clampN((R * 2) / (s * 0.45), 20, 700));
      for (let i = 0; i < lines; i++) {
        const y = (rand() * 2 - 1) * R;
        const len = R * (0.35 + rand() * 1.2);
        const x0 = (rand() * 2 - 1) * R - len / 2;
        const th = Math.max(0.8, s * 0.05 * (0.4 + rand() * 1.4));
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + len / 2, y - th / 2);
        ctx.lineTo(x0 + len, y);
        ctx.lineTo(x0 + len / 2, y + th / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

const clampN = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * 레이어 하나를 그린다. 좌표는 페이지 좌표(가로 PAGE_WIDTH, 세로 pageH).
 * applyBlend=false 면 합성 모드/불투명도는 호출한 쪽(CSS)이 처리한다.
 */
export function drawPageLayer(ctx: CanvasRenderingContext2D, l: PageLayer, pageW: number, pageH: number, applyBlend: boolean) {
  const box = layerBox(l, pageW, pageH);
  ctx.save();
  if (applyBlend) {
    ctx.globalAlpha = clampN(l.opacity, 0, 1);
    ctx.globalCompositeOperation = COMPOSITE[l.blend];
  }
  if (l.kind === 'color') {
    ctx.fillStyle = l.color;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  } else if (l.kind === 'gradient') {
    const a = (l.angle * Math.PI) / 180;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const half = (Math.abs(Math.cos(a)) * box.w + Math.abs(Math.sin(a)) * box.h) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half);
    g.addColorStop(0, l.color);
    g.addColorStop(1, l.color2);
    ctx.fillStyle = g;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  } else if (l.kind === 'pattern') {
    drawPattern(ctx, l, box.x, box.y, box.w, box.h);
  } else {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((l.rotation * Math.PI) / 180);
    if (l.flip) ctx.scale(-1, 1);
    if (l.kind === 'image') {
      const img = layerImage(l.src);
      if (img) {
        let dw = box.w;
        let dh = box.h;
        const ir = img.naturalWidth / img.naturalHeight;
        if (l.fit !== 'stretch') {
          const br = box.w / box.h;
          if ((l.fit === 'cover') === ir < br) {
            dw = box.w;
            dh = box.w / ir;
          } else {
            dh = box.h;
            dw = box.h * ir;
          }
        }
        ctx.beginPath();
        ctx.rect(-box.w / 2, -box.h / 2, box.w, box.h);
        ctx.clip();
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      }
    } else {
      shapePath(ctx, l, box.w, box.h);
      ctx.fillStyle = l.color;
      ctx.fill();
      if (l.strokeWidth > 0) {
        ctx.lineWidth = l.strokeWidth;
        ctx.strokeStyle = l.stroke;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** 내보내기용: 한 z(back/front)의 레이어를 순서대로 그린다 */
export function drawPageLayers(ctx: CanvasRenderingContext2D, layers: PageLayer[], z: 'back' | 'front', pageW: number, pageH: number) {
  for (const l of layers) {
    if (!l.visible || l.z !== z) continue;
    drawPageLayer(ctx, l, pageW, pageH, true);
  }
}
