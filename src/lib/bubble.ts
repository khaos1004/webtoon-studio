import type { Bubble, BubbleKind, SfxStyle } from './types';
import { uid } from './types';
import { mulberry32 } from './effects';
import { fontStack, fontWeight } from './fonts';

/**
 * SVG 말풍선 시스템
 * - 본체와 꼬리가 같은 fill / stroke / opacity 를 쓰는 하나의 도형 그룹
 * - 윤곽선 레이어(굵기 2배)를 먼저 깔고, 그 위에 채움 레이어를 덮어서
 *   본체와 꼬리의 이음새에 선이 남지 않게 한다 (바깥쪽 절반만 보이므로 선 굵기는 strokeWidth 와 같다)
 */

/** 말풍선 탭에 보이는 종류(의성어 'sfx' 는 의성어 탭에서 만든다) */
export const BUBBLE_KINDS: BubbleKind[] = ['speech', 'box', 'thought', 'shout', 'shock', 'flash', 'soft', 'wobble', 'phone', 'horror', 'whisper', 'narration', 'mono'];

export const BUBBLE_LABELS: Record<BubbleKind, string> = {
  speech: '기본 대사',
  thought: '생각',
  shout: '외침',
  shock: '충격',
  soft: '감성',
  horror: '공포',
  whisper: '속삭임',
  narration: '나레이션',
  box: '사각 대사',
  phone: '전화·기계음',
  wobble: '떨리는 목소리',
  mono: '독백 (검정)',
  flash: '속마음 플래시',
  sfx: '의성어',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => Math.round(n * 100) / 100;

export function defaultBubble(kind: BubbleKind, x: number, y: number): Bubble {
  const base: Bubble = {
    id: uid(),
    kind,
    x,
    y,
    w: 240,
    h: 150,
    text: '안녕!',
    fontSize: 26,
    textColor: '#111111',
    fill: '#ffffff',
    stroke: '#151515',
    strokeWidth: 2.2,
    opacity: 1,
    tail: true,
    tailX: x + 90,
    tailY: y + 150 + 62,
    tailWidth: 34,
    tailCurve: 0.45,
    seed: Math.floor(Math.random() * 90) + 1,
  };
  switch (kind) {
    case 'thought':
      return { ...base, text: '음…', h: 160, strokeWidth: 2, tailWidth: 36, tailY: y + 160 + 70 };
    case 'shout':
      return { ...base, text: '야!!', w: 290, h: 210, fontSize: 38, strokeWidth: 3.2, tail: false };
    case 'shock':
      return { ...base, text: '헉!', w: 300, h: 230, fontSize: 44, strokeWidth: 3.6, tail: false };
    case 'soft':
      return { ...base, text: '좋아해…', h: 96, w: 250, fill: '#ffe4ee', stroke: '#e8a3bb', strokeWidth: 0, textColor: '#6b3b52', fontSize: 24, tailWidth: 26, tailY: y + 96 + 46 };
    case 'horror':
      return { ...base, text: '…뒤에 있어', w: 270, h: 150, fill: '#16111f', stroke: '#000000', strokeWidth: 2.4, textColor: '#eadff7', fontSize: 26 };
    case 'whisper':
      return { ...base, text: '(작게) 비밀이야', w: 250, h: 120, stroke: '#666666', strokeWidth: 1.8, textColor: '#444444', fontSize: 20, tailWidth: 26, tailY: y + 120 + 52 };
    case 'narration':
      return { ...base, text: '그날 밤, 모든 것이 바뀌었다.', w: 330, h: 90, fontSize: 21, tail: false, strokeWidth: 1.6, fill: '#fffdf2' };
    case 'box':
      return { ...base, text: '알겠어.', w: 230, h: 110, tailWidth: 28, tailY: y + 110 + 50 };
    case 'phone':
      return { ...base, text: '여보세요?', w: 250, h: 140, strokeWidth: 2, tailWidth: 26, tailY: y + 140 + 56 };
    case 'wobble':
      return { ...base, text: '그, 그게…', w: 250, h: 150, strokeWidth: 2, fontSize: 24 };
    case 'mono':
      return { ...base, text: '(이상하다…)', w: 300, h: 86, fontSize: 21, tail: false, strokeWidth: 0, fill: '#121212', textColor: '#ffffff' };
    case 'flash':
      return { ...base, text: '!', w: 300, h: 210, fontSize: 40, strokeWidth: 1.4, tail: false, bold: true };
    case 'sfx':
      return defaultSfx(x, y, '쾅');
    default:
      return base;
  }
}

/* ------------------------------ 의성어 ------------------------------ */

export const DEFAULT_SFX: SfxStyle = {
  fill2: '#ff3b30',
  gradient: false,
  stroke2: '#000000',
  stroke2Width: 0,
  rotation: -6,
  skew: -8,
  jitter: 0.25,
  spacing: -0.05,
  arc: 0,
  extrude: 0,
  extrudeColor: '#000000',
  extrudeAngle: 45,
  motion: 0,
  motionAngle: 180,
  grow: 0,
};

export const sfxStyleOf = (b: Pick<Bubble, 'sfx'>): SfxStyle => ({ ...DEFAULT_SFX, ...(b.sfx ?? {}) });

/** 글자 의성어 하나. x, y 는 왼쪽 위. 크기는 글자 길이에 맞춘다 */
export function defaultSfx(x: number, y: number, text: string, patch: Partial<Bubble> = {}): Bubble {
  const b: Bubble = {
    id: uid(),
    kind: 'sfx',
    x,
    y,
    w: 200,
    h: 130,
    text,
    fontSize: 60,
    textColor: '#111111',
    fill: '#ffffff',
    stroke: '#ffffff',
    strokeWidth: 6,
    opacity: 1,
    tail: false,
    tailX: x,
    tailY: y,
    tailWidth: 30,
    tailCurve: 0,
    seed: Math.floor(Math.random() * 90) + 1,
    font: 'black-han-sans',
    bold: true,
    ...patch,
    sfx: { ...DEFAULT_SFX, ...(patch.sfx ?? {}) },
  };
  return fitSfx(b, patch.h ?? 130);
}

/* ------------------------------ 기하 ------------------------------ */

type Shape = { tag: 'path'; d: string } | { tag: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

const shapeAttrs = (s: Shape) =>
  s.tag === 'path' ? `d="${s.d}"` : `cx="${f(s.cx)}" cy="${f(s.cy)}" rx="${f(s.rx)}" ry="${f(s.ry)}"`;

/** 슈퍼타원: n=2 이면 타원, 클수록 사각형에 가까워진다 */
function superRadius(a: number, b: number, n: number, phi: number) {
  const c = Math.abs(Math.cos(phi));
  const s = Math.abs(Math.sin(phi));
  return 1 / Math.pow(Math.pow(c / a, n) + Math.pow(s / b, n), 1 / n);
}

function superPath(cx: number, cy: number, a: number, b: number, n: number, N = 120) {
  let d = '';
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = cx + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = cy + b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    d += `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`;
  }
  return d + 'Z';
}

/** 곡선형 꼬리. 몸체 안쪽에서 시작해 tip 으로 가늘어진다. */
function tailShape(cx: number, cy: number, rBody: number, tx: number, ty: number, tw: number, curve: number): Shape | null {
  const dx = tx - cx;
  const dy = ty - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < rBody * 1.08) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy;
  const py = ux;
  const bx = cx + ux * rBody * 0.88;
  const by = cy + uy * rBody * 0.88;
  const len = dist - rBody * 0.88;
  const mx = bx + ux * len * 0.5;
  const my = by + uy * len * 0.5;
  const shift = curve * len * 0.32;
  const c1x = mx + px * (tw * 0.13 + shift);
  const c1y = my + py * (tw * 0.13 + shift);
  const c2x = mx + px * (-tw * 0.13 + shift);
  const c2y = my + py * (-tw * 0.13 + shift);
  const b1x = bx + (px * tw) / 2;
  const b1y = by + (py * tw) / 2;
  const b2x = bx - (px * tw) / 2;
  const b2y = by - (py * tw) / 2;
  return { tag: 'path', d: `M${f(b1x)} ${f(b1y)}Q${f(c1x)} ${f(c1y)} ${f(tx)} ${f(ty)}Q${f(c2x)} ${f(c2y)} ${f(b2x)} ${f(b2y)}Z` };
}

function cloudPath(cx: number, cy: number, a: number, b: number) {
  const perim = 2 * Math.PI * Math.sqrt((a * a + b * b) / 2);
  const N = Math.max(8, Math.min(22, Math.round(perim / 54)));
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + a * 0.93 * Math.cos(t), cy + b * 0.9 * Math.sin(t)]);
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < N; i++) {
    const p = pts[(i + 1) % N];
    const q = pts[i];
    const chord = Math.hypot(p[0] - q[0], p[1] - q[1]);
    const r = chord * 0.58;
    d += `A${f(r)} ${f(r)} 0 0 1 ${f(p[0])} ${f(p[1])}`;
  }
  return d + 'Z';
}

function burstPath(cx: number, cy: number, a: number, b: number, N: number, inner: number, jitter: number, seed: number) {
  const rand = mulberry32(seed * 977);
  let d = '';
  for (let i = 0; i < N; i++) {
    const base = (i / N) * Math.PI * 2;
    const ao = base + (rand() - 0.5) * jitter * 0.35;
    const ro = 1 + (rand() - 0.5) * jitter * 0.5;
    d += `${i === 0 ? 'M' : 'L'}${f(cx + a * ro * Math.cos(ao))} ${f(cy + b * ro * Math.sin(ao))}`;
    const ai = base + Math.PI / N + (rand() - 0.5) * jitter * 0.3;
    const ri = inner * (0.9 + 0.2 * rand());
    d += `L${f(cx + a * ri * Math.cos(ai))} ${f(cy + b * ri * Math.sin(ai))}`;
  }
  return d + 'Z';
}

function horrorPath(cx: number, cy: number, a: number, b: number, seed: number) {
  const rand = mulberry32(seed * 131);
  const s1 = rand() * 6;
  const s2 = rand() * 6;
  const s3 = rand() * 6;
  const drips = Array.from({ length: 5 }, (_, k) => ({ t: Math.PI * (0.14 + (0.72 * (k + rand() * 0.6)) / 5), h: 0.12 + rand() * 0.2 }));
  const N = 220;
  let d = '';
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    let r = 0.94 + 0.05 * Math.sin(3 * t + s1) + 0.035 * Math.sin(7 * t + s2) + 0.02 * Math.sin(13 * t + s3);
    for (const dr of drips) r += dr.h * Math.exp(-Math.pow((t - dr.t) / 0.04, 2));
    d += `${i === 0 ? 'M' : 'L'}${f(cx + a * r * Math.cos(t))} ${f(cy + b * r * Math.sin(t))}`;
  }
  return d + 'Z';
}

function wobblePath(cx: number, cy: number, a: number, b: number, seed: number) {
  const s = (seed % 17) * 0.37;
  const N = 200;
  let d = '';
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const base = superRadius(1, 1, 2.5, t);
    const r = base * (0.97 + 0.03 * Math.sin(18 * t + s) + 0.012 * Math.sin(31 * t + s * 2));
    d += `${i === 0 ? 'M' : 'L'}${f(cx + a * r * Math.cos(t))} ${f(cy + b * r * Math.sin(t))}`;
  }
  return d + 'Z';
}

function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y + h - r)}Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)}H${f(x + r)}Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - r)}V${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}Z`;
}

function geometry(b: Bubble): Shape[] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const a = b.w / 2;
  const hh = b.h / 2;
  const shapes: Shape[] = [];
  const addTail = (n: number, tw = b.tailWidth) => {
    if (!b.tail) return;
    const ends: [number, number, number][] = [[b.tailX, b.tailY, b.tailCurve]];
    if (b.tail2) ends.push([b.tail2.x, b.tail2.y, -b.tailCurve]);
    for (const [ex, ey, cv] of ends) {
      const r = superRadius(a, hh, n, Math.atan2(ey - cy, ex - cx));
      const t = tailShape(cx, cy, r, ex, ey, tw, cv);
      if (t) shapes.push(t);
    }
  };
  switch (b.kind) {
    case 'speech':
      shapes.push({ tag: 'path', d: superPath(cx, cy, a, hh, 2.7) });
      addTail(2.7);
      break;
    case 'whisper':
      shapes.push({ tag: 'path', d: superPath(cx, cy, a, hh, 2.4) });
      addTail(2.4);
      break;
    case 'thought': {
      shapes.push({ tag: 'path', d: cloudPath(cx, cy, a, hh) });
      if (b.tail) {
        const r = superRadius(a, hh, 2, Math.atan2(b.tailY - cy, b.tailX - cx));
        const dx = b.tailX - cx;
        const dy = b.tailY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > r * 1.1) {
          const ux = dx / dist;
          const uy = dy / dist;
          const sx = cx + ux * r * 1.0;
          const sy = cy + uy * r * 1.0;
          const ex = b.tailX;
          const ey = b.tailY;
          [
            [0.2, 0.42],
            [0.55, 0.3],
            [0.92, 0.2],
          ].forEach(([t, k]) => {
            const rr = b.tailWidth * k;
            shapes.push({ tag: 'ellipse', cx: sx + (ex - sx) * t, cy: sy + (ey - sy) * t, rx: rr, ry: rr * 0.92 });
          });
        }
      }
      break;
    }
    case 'shout':
      shapes.push({ tag: 'path', d: burstPath(cx, cy, a, hh, Math.max(12, Math.round(Math.sqrt(a * hh) / 7)), 0.8, 0.5, b.seed) });
      addTail(2);
      break;
    case 'shock':
      shapes.push({ tag: 'path', d: burstPath(cx, cy, a, hh, Math.max(10, Math.round(Math.sqrt(a * hh) / 11)), 0.5, 0.9, b.seed) });
      addTail(2);
      break;
    case 'soft':
      shapes.push({ tag: 'path', d: roundRectPath(b.x, b.y, b.w, b.h, Math.min(b.h / 2, 46)) });
      addTail(2.5, b.tailWidth);
      break;
    case 'horror':
      shapes.push({ tag: 'path', d: horrorPath(cx, cy, a * 0.96, hh * 0.9, b.seed) });
      addTail(2, b.tailWidth * 0.8);
      break;
    case 'narration':
    case 'mono':
      shapes.push({ tag: 'path', d: roundRectPath(b.x, b.y, b.w, b.h, 2) });
      break;
    case 'box':
      shapes.push({ tag: 'path', d: roundRectPath(b.x, b.y, b.w, b.h, Math.min(14, b.h / 4)) });
      addTail(6);
      break;
    case 'phone': {
      const perim = 2 * Math.PI * Math.sqrt((a * a + hh * hh) / 2);
      shapes.push({ tag: 'path', d: burstPath(cx, cy, a, hh, Math.max(24, Math.round(perim / 16)), 0.93, 0, b.seed) });
      addTail(2);
      break;
    }
    case 'wobble':
      shapes.push({ tag: 'path', d: wobblePath(cx, cy, a, hh, b.seed) });
      addTail(2.5);
      break;
    case 'flash': {
      const perim = 2 * Math.PI * Math.sqrt((a * a + hh * hh) / 2);
      shapes.push({ tag: 'path', d: burstPath(cx, cy, a, hh, Math.max(36, Math.round(perim / 13)), 0.82, 0.55, b.seed) });
      addTail(2);
      break;
    }
    case 'sfx':
      break;
  }
  return shapes;
}

/* ------------------------------ 텍스트 ------------------------------ */

const isWide = (c: string) => /[ᄀ-ᇿ㄰-㆏가-힯⺀-鿿＀-￯]/.test(c);

function charW(c: string, fs: number) {
  if (isWide(c)) return fs * 1.0;
  if (c === ' ') return fs * 0.3;
  if (/[A-Z0-9]/.test(c)) return fs * 0.64;
  if (/[.,!?'":;·…]/.test(c)) return fs * 0.4;
  return fs * 0.56;
}

export const textWidth = (s: string, fs: number) => [...s].reduce((w, c) => w + charW(c, fs), 0);

export function wrapText(text: string, maxW: number, fs: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const tokens = para.match(/[A-Za-z0-9'’\-.,!?]+|\s+|[^\sA-Za-z0-9]/g) ?? [];
    let line = '';
    for (const tk of tokens) {
      const tryLine = line + tk;
      if (textWidth(tryLine.trimEnd(), fs) <= maxW || line === '') {
        line = tryLine;
      } else {
        lines.push(line.trimEnd());
        line = tk.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** 말풍선 종류별로 글자가 들어갈 수 있는 비율 */
const TEXT_AREA: Record<BubbleKind, { w: number; h: number }> = {
  speech: { w: 0.78, h: 0.66 },
  whisper: { w: 0.78, h: 0.66 },
  thought: { w: 0.7, h: 0.6 },
  shout: { w: 0.62, h: 0.52 },
  shock: { w: 0.55, h: 0.46 },
  soft: { w: 0.86, h: 0.7 },
  horror: { w: 0.74, h: 0.6 },
  narration: { w: 0.92, h: 0.76 },
  box: { w: 0.86, h: 0.72 },
  phone: { w: 0.72, h: 0.6 },
  wobble: { w: 0.74, h: 0.62 },
  mono: { w: 0.92, h: 0.76 },
  flash: { w: 0.52, h: 0.44 },
  sfx: { w: 1, h: 1 },
};

/** 세로쓰기에서 눕혀 쓰는 문장부호 */
const ROTATE_V = /[…~\-—–()\[\]{}<>〈〉「」『』:;=]/;

const isBoldKind = (k: BubbleKind) => k === 'shout' || k === 'shock' || k === 'flash';

function textStyle(b: Bubble) {
  const bold = b.bold ?? isBoldKind(b.kind);
  const custom = b.font && b.font !== 'default';
  const weight = custom ? fontWeight(b.font, bold) : bold ? 800 : b.kind === 'soft' ? 600 : 500;
  const italic = b.kind === 'shock' && !custom ? ' font-style="italic"' : '';
  const ls = b.kind === 'horror' ? ' letter-spacing="1.2"' : '';
  return `font-family="${fontStack(b.font)}" font-size="${b.fontSize}" font-weight="${weight}"${italic}${ls} fill="${esc(b.textColor)}"`;
}

/** 세로쓰기: 문단마다 오른쪽에서 왼쪽으로 줄을 놓는다 */
function verticalColumns(b: Bubble) {
  const area = TEXT_AREA[b.kind];
  const step = b.fontSize * 1.06;
  const maxPer = Math.max(1, Math.floor((b.h * area.h) / step));
  const cols: string[][] = [];
  for (const para of b.text.split('\n')) {
    const chars = [...para];
    if (!chars.length) cols.push([]);
    for (let i = 0; i < chars.length; i += maxPer) cols.push(chars.slice(i, i + maxPer));
  }
  return { cols, step, colW: b.fontSize * 1.4 };
}


function textMarkup(b: Bubble) {
  if (b.vertical) {
    // 눕혀 쓰는 문장부호는 <text> 하나씩(tspan 은 회전이 안 된다)
    const { cols, step, colW } = verticalColumns(b);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const longest = Math.max(1, ...cols.map((c) => c.length));
    const totalW = cols.length * colW;
    const y0 = cy - ((longest - 1) * step) / 2;
    let plain = '';
    let rotated = '';
    cols.forEach((col, i) => {
      const x = cx + totalW / 2 - colW * (i + 0.5);
      col.forEach((ch, j) => {
        const y = y0 + j * step;
        if (ROTATE_V.test(ch)) rotated += `<text x="${f(x)}" y="${f(y)}" transform="rotate(90 ${f(x)} ${f(y)})">${esc(ch)}</text>`;
        else if (ch.trim()) plain += `<tspan x="${f(x)}" y="${f(y)}">${esc(ch)}</tspan>`;
      });
    });
    return `<g ${textStyle(b)} text-anchor="middle" dominant-baseline="central"><text>${plain}</text>${rotated}</g>`;
  }
  const area = TEXT_AREA[b.kind];
  const lines = wrapText(b.text, b.w * area.w, b.fontSize);
  const lh = b.fontSize * 1.32;
  const left = b.align === 'left';
  const tx = left ? b.x + (b.w * (1 - area.w)) / 2 : b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const top = cy - ((lines.length - 1) * lh) / 2;
  const spans = lines.map((ln, i) => `<tspan x="${f(tx)}" y="${f(top + i * lh)}">${esc(ln) || ' '}</tspan>`).join('');
  return `<text ${textStyle(b)} text-anchor="${left ? 'start' : 'middle'}" dominant-baseline="central">${spans}</text>`;
}

/* ------------------------------ 의성어 그리기 ------------------------------ */

const SFX_UNIT = 100;

interface Glyph {
  c: string;
  x: number;
  y: number;
  r: number;
  s: number;
}

/** 의성어 글자 배치(단위 좌표, 가운데가 0,0). W·H 는 자연스러운 크기 */
export function sfxLayout(b: Pick<Bubble, 'text' | 'vertical' | 'seed' | 'sfx'>) {
  const st = sfxStyleOf(b);
  const rand = mulberry32((b.seed || 1) * 7919);
  const lines = b.text.split('\n').map((l) => [...l]);
  const fs = SFX_UNIT;
  const glyphs: Glyph[] = [];
  const j = Math.max(0, Math.min(1, st.jitter));
  const sp = Math.max(-0.4, st.spacing);
  let W: number;
  let H: number;
  if (!b.vertical) {
    const lh = fs * 1.08;
    const widths = lines.map((l) => l.reduce((w, c) => w + charW(c, fs) * (1 + sp), 0));
    W = Math.max(fs * 0.6, ...widths);
    H = Math.max(1, lines.length) * lh;
    lines.forEach((l, li) => {
      const lw = Math.max(1, widths[li]);
      let x = -lw / 2;
      const y0 = -H / 2 + lh * (li + 0.5);
      const n = l.length;
      l.forEach((c, i) => {
        const cw = charW(c, fs) * (1 + sp);
        const cx = x + cw / 2;
        x += cw;
        if (!c.trim()) return;
        const u = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
        const bend = st.arc * W * 0.18;
        const arcY = -bend * (1 - u * u);
        const arcR = (Math.atan2(2 * bend * u, lw / 2) * 180) / Math.PI;
        glyphs.push({
          c,
          x: cx + (rand() - 0.5) * j * fs * 0.14,
          y: y0 + arcY + (rand() - 0.5) * j * fs * 0.5,
          r: arcR + (rand() - 0.5) * j * 36,
          s: (1 + st.grow * u * 0.45) * (1 + (rand() - 0.5) * j * 0.36),
        });
      });
    });
  } else {
    const colW = fs * 1.12;
    const step = fs * (1 + sp) * 0.98;
    const heights = lines.map((l) => l.length * step);
    H = Math.max(fs * 0.6, ...heights);
    W = Math.max(1, lines.length) * colW;
    lines.forEach((l, li) => {
      const lh = Math.max(1, heights[li]);
      const x0 = W / 2 - colW * (li + 0.5);
      const n = l.length;
      l.forEach((c, i) => {
        const y = -lh / 2 + step * (i + 0.5);
        if (!c.trim()) return;
        const u = n > 1 ? (i / (n - 1)) * 2 - 1 : 0;
        const bend = st.arc * H * 0.18;
        const arcX = bend * (1 - u * u);
        const arcR = -(Math.atan2(2 * bend * u, lh / 2) * 180) / Math.PI;
        glyphs.push({
          c,
          x: x0 + arcX + (rand() - 0.5) * j * fs * 0.5,
          y: y + (rand() - 0.5) * j * fs * 0.14,
          r: arcR + (rand() - 0.5) * j * 36 + (ROTATE_V.test(c) ? 90 : 0),
          s: (1 + st.grow * u * 0.45) * (1 + (rand() - 0.5) * j * 0.36),
        });
      });
    });
  }
  return { glyphs, W, H };
}

/** 글자 비율에 맞춰 상자 크기를 다시 정한다(높이는 h 로, 가운데는 그대로) */
export function fitSfx(b: Bubble, h = b.h): Bubble {
  const { W, H } = sfxLayout(b);
  const nh = Math.max(30, h);
  const nw = Math.max(30, (nh * W) / H);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { ...b, w: Math.round(nw), h: Math.round(nh), x: Math.round(cx - nw / 2), y: Math.round(cy - nh / 2) };
}

function sfxMarkup(b: Bubble): string {
  const st = sfxStyleOf(b);
  const { glyphs, W, H } = sfxLayout(b);
  const sx = b.w / W;
  const sy = b.h / H;
  const k = Math.sqrt(Math.abs(sx * sy)) || 1;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const gid = `sfx-${b.id}`;
  const weight = fontWeight(b.font, b.bold ?? true, 900, 600);
  const glyphMarkup = glyphs
    .map((g) => `<text x="${f(g.x)}" y="${f(g.y)}" font-size="${f(SFX_UNIT * g.s)}"${g.r ? ` transform="rotate(${f(g.r)} ${f(g.x)} ${f(g.y)})"` : ''}>${esc(g.c)}</text>`)
    .join('');
  const grad = st.gradient
    ? `<linearGradient id="${gid}-gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0.12" stop-color="${esc(b.textColor)}"/><stop offset="0.95" stop-color="${esc(st.fill2)}"/></linearGradient>`
    : '';
  const defs = `<defs><g id="${gid}" font-family="${fontStack(b.font)}" font-weight="${weight}" text-anchor="middle" dominant-baseline="central" stroke-linejoin="round" stroke-linecap="round">${glyphMarkup}</g>${grad}</defs>`;
  const use = (attrs: string) => `<use href="#${gid}" ${attrs}/>`;
  const sw1 = Math.max(0, b.strokeWidth);
  const sw2 = Math.max(0, st.stroke2Width);
  const outerW = ((sw1 + sw2) * 2) / k;
  const outerColor = sw2 > 0 ? st.stroke2 : b.stroke;
  const layers: string[] = [];
  // 잔상: 멀리 있는 것부터
  const mot = Math.max(0, Math.min(8, Math.round(st.motion)));
  if (mot) {
    const ma = (st.motionAngle * Math.PI) / 180;
    for (let m = mot; m >= 1; m--) {
      const d = m * b.h * 0.2;
      const op = 0.55 * (1 - m / (mot + 1));
      layers.push(`<g opacity="${f(op)}" transform="translate(${f((Math.cos(ma) * d) / sx)} ${f((Math.sin(ma) * d) / sy)})">${outerW > 0 ? use(`fill="${esc(outerColor)}" stroke="${esc(outerColor)}" stroke-width="${f(outerW)}"`) : ''}${use(`fill="${esc(b.textColor)}"`)}</g>`);
    }
  }
  // 입체(두께)
  const ext = Math.max(0, st.extrude);
  if (ext > 0) {
    const ea = (st.extrudeAngle * Math.PI) / 180;
    const steps = Math.min(40, Math.ceil(ext / 1.2));
    for (let i = steps; i >= 1; i--) {
      const d = (ext * i) / steps;
      layers.push(use(`transform="translate(${f((Math.cos(ea) * d) / sx)} ${f((Math.sin(ea) * d) / sy)})" fill="${esc(st.extrudeColor)}" stroke="${esc(st.extrudeColor)}" stroke-width="${f(Math.max(outerW, 0.01))}"`));
    }
  }
  if (sw2 > 0) layers.push(use(`fill="${esc(st.stroke2)}" stroke="${esc(st.stroke2)}" stroke-width="${f(outerW)}"`));
  if (sw1 > 0) layers.push(use(`fill="${esc(b.stroke)}" stroke="${esc(b.stroke)}" stroke-width="${f((sw1 * 2) / k)}"`));
  layers.push(use(`fill="${st.gradient ? `url(#${gid}-gr)` : esc(b.textColor)}"`));
  const tf = `translate(${f(cx)} ${f(cy)}) rotate(${f(st.rotation)}) skewX(${f(st.skew)}) scale(${f(sx)} ${f(sy)})`;
  return `<g data-bubble="${b.id}" opacity="${b.opacity}">${defs}<g transform="${tf}">${layers.join('')}</g></g>`;
}

/* ------------------------------ 조립 ------------------------------ */

/** 말풍선 하나를 <g> 마크업으로 만든다 (페이지 좌표 그대로) */
export function bubbleMarkup(b: Bubble): string {
  if (b.kind === 'sfx') return sfxMarkup(b);
  const shapes = geometry(b);
  const sw = Math.max(0, b.strokeWidth);
  const dash = b.kind === 'whisper' ? ` stroke-dasharray="${f(sw * 3.2)} ${f(sw * 2.6)}"` : '';
  const strokeLayer =
    sw > 0
      ? shapes
          .map((s) => `<${s.tag} ${shapeAttrs(s)} fill="none" stroke="${esc(b.stroke)}" stroke-width="${f(sw * 2)}" stroke-linejoin="round" stroke-linecap="round"${dash}/>`)
          .join('')
      : '';
  const fillLayer = shapes.map((s) => `<${s.tag} ${shapeAttrs(s)} fill="${esc(b.fill)}"/>`).join('');
  const fid = `sh${b.id}`;
  const shadow = b.kind === 'soft' ? `<filter id="${fid}" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#8a4a62" flood-opacity="0.22"/></filter>` : '';
  const filterAttr = b.kind === 'soft' ? ` filter="url(#${fid})"` : '';
  return `<g data-bubble="${b.id}">${shadow}<g opacity="${b.opacity}"${filterAttr}>${strokeLayer}${fillLayer}</g>${textMarkup(b)}</g>`;
}

export function bubblesSvgDocument(bubbles: Bubble[], w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bubbles.map(bubbleMarkup).join('')}</svg>`;
}

/** 꼬리와 윤곽선을 포함한 경계 상자 */
export function bubbleBounds(b: Bubble, pad = 0) {
  if (b.kind === 'sfx') {
    const st = sfxStyleOf(b);
    const skew = Math.min(3, Math.abs(Math.tan((st.skew * Math.PI) / 180)));
    const r = Math.hypot(b.w * (1 + skew), b.h) / 2 + (b.strokeWidth + st.stroke2Width) * 2 + st.extrude + st.motion * b.h * 0.2 + b.h * st.jitter * 0.3 + 24 + pad;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
  }
  const m = b.strokeWidth * 2 + 24 + pad;
  const t2 = b.tail && b.tail2 ? b.tail2 : null;
  const xs = [b.x, b.x + b.w, ...(b.tail ? [b.tailX] : []), ...(t2 ? [t2.x] : [])];
  const ys = [b.y, b.y + b.h, ...(b.tail ? [b.tailY] : []), ...(t2 ? [t2.y] : [])];
  return { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + m * 2, h: Math.max(...ys) - Math.min(...ys) + m * 2 };
}

/** 글자 길이에 맞춰 크기를 자동으로 맞춘다 (중심과 꼬리 상대 위치 유지) */
export function fitBubble(b: Bubble): Bubble {
  if (b.kind === 'sfx') return fitSfx(b);
  const area = TEXT_AREA[b.kind];
  if (b.vertical) {
    const longest = Math.max(1, ...b.text.split('\n').map((l) => [...l].length));
    const per = Math.min(longest, 12);
    const h = Math.max(90, (per * b.fontSize * 1.06 + b.fontSize * 0.6) / area.h);
    const cols = b.text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil([...l].length / per)), 0);
    const w = Math.max(80, (cols * b.fontSize * 1.4 + b.fontSize * 0.4) / area.w);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return { ...b, x: cx - w / 2, y: cy - h / 2, w, h };
  }
  const lh = b.fontSize * 1.32;
  const target = b.kind === 'narration' || b.kind === 'mono' ? 3.4 : b.kind === 'soft' || b.kind === 'box' ? 2.6 : 1.55;
  let best = { w: b.w, h: b.h, score: Infinity };
  for (let w = 110; w <= 520; w += 10) {
    const lines = wrapText(b.text, w * area.w, b.fontSize);
    const widest = Math.max(...lines.map((l) => textWidth(l, b.fontSize)));
    if (widest > w * area.w + 1) continue;
    const h = Math.max(70, (lines.length * lh + b.fontSize * 0.6) / area.h);
    const score = Math.abs(w / h - target);
    if (score < best.score) best = { w, h, score };
  }
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const nx = cx - best.w / 2;
  const ny = cy - best.h / 2;
  return { ...b, x: nx, y: ny, w: best.w, h: best.h };
}
