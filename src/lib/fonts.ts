import type { Bubble } from './types';

/**
 * 말풍선·의성어 글꼴.
 * - 화면: 고른 글꼴만 Google Fonts 에서 그때그때 불러온다(처음 화면이 무거워지지 않게).
 * - 내보내기(JPG·PNG·PSD): SVG 를 그림으로 바꿀 때는 바깥 글꼴을 못 쓰므로,
 *   쓰인 글자만 담은 작은 글꼴 파일을 받아 SVG 안에 넣는다(Google Fonts 의 text= 기능).
 *   인터넷이 안 되면 기본 고딕으로 대신 그려진다.
 */

export interface FontDef {
  id: string;
  label: string;
  /** CSS font-family 이름 */
  family: string;
  /** Google Fonts family 파라미터(공백은 +). 없으면 시스템 글꼴 */
  gf?: string;
  /** 쓸 수 있는 굵기(첫 값이 보통, 마지막 값이 굵게) */
  weights?: number[];
  group: '기본' | '제목·효과음' | '손글씨' | '명조';
}

const SYSTEM = `'Pretendard','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif`;

export const FONTS: FontDef[] = [
  { id: 'default', label: '기본 고딕', family: '', group: '기본' },
  { id: 'noto-sans', label: '본고딕', family: 'Noto Sans KR', gf: 'Noto+Sans+KR', weights: [400, 700, 900], group: '기본' },
  { id: 'nanum-gothic', label: '나눔고딕', family: 'Nanum Gothic', gf: 'Nanum+Gothic', weights: [400, 700, 800], group: '기본' },
  { id: 'gothic-a1', label: '고딕 A1', family: 'Gothic A1', gf: 'Gothic+A1', weights: [400, 700, 900], group: '기본' },
  { id: 'black-han-sans', label: '검은고딕 (굵은 효과음)', family: 'Black Han Sans', gf: 'Black+Han+Sans', group: '제목·효과음' },
  { id: 'do-hyeon', label: '도현 (각진 효과음)', family: 'Do Hyeon', gf: 'Do+Hyeon', group: '제목·효과음' },
  { id: 'jua', label: '주아 (둥근 코믹)', family: 'Jua', gf: 'Jua', group: '제목·효과음' },
  { id: 'gugi', label: '구기 (게임·판타지)', family: 'Gugi', gf: 'Gugi', group: '제목·효과음' },
  { id: 'dokdo', label: '독도 (거친 붓)', family: 'Dokdo', gf: 'Dokdo', group: '제목·효과음' },
  { id: 'east-sea-dokdo', label: '동해독도 (마커)', family: 'East Sea Dokdo', gf: 'East+Sea+Dokdo', group: '제목·효과음' },
  { id: 'kirang', label: '기랑해랑 (장난스러운)', family: 'Kirang Haerang', gf: 'Kirang+Haerang', group: '제목·효과음' },
  { id: 'single-day', label: '싱글데이 (귀여운)', family: 'Single Day', gf: 'Single+Day', group: '제목·효과음' },
  { id: 'nanum-pen', label: '나눔손글씨 펜', family: 'Nanum Pen Script', gf: 'Nanum+Pen+Script', group: '손글씨' },
  { id: 'nanum-brush', label: '나눔손글씨 붓', family: 'Nanum Brush Script', gf: 'Nanum+Brush+Script', group: '손글씨' },
  { id: 'gaegu', label: '개구', family: 'Gaegu', gf: 'Gaegu', weights: [400, 700], group: '손글씨' },
  { id: 'hi-melody', label: '하이멜로디', family: 'Hi Melody', gf: 'Hi+Melody', group: '손글씨' },
  { id: 'gamja', label: '감자꽃', family: 'Gamja Flower', gf: 'Gamja+Flower', group: '손글씨' },
  { id: 'yeon-sung', label: '연성', family: 'Yeon Sung', gf: 'Yeon+Sung', group: '손글씨' },
  { id: 'nanum-myeongjo', label: '나눔명조', family: 'Nanum Myeongjo', gf: 'Nanum+Myeongjo', weights: [400, 700, 800], group: '명조' },
  { id: 'noto-serif', label: '본명조', family: 'Noto Serif KR', gf: 'Noto+Serif+KR', weights: [400, 700, 900], group: '명조' },
  { id: 'song-myung', label: '송명', family: 'Song Myung', gf: 'Song+Myung', group: '명조' },
];

const BY_ID = new Map(FONTS.map((f) => [f.id, f]));

export const fontDef = (id?: string): FontDef => BY_ID.get(id ?? 'default') ?? FONTS[0];

/** SVG/CSS 에 넣을 font-family 값(작은따옴표 사용) */
export function fontStack(id?: string): string {
  const f = fontDef(id);
  return f.family ? `'${f.family}',${SYSTEM}` : SYSTEM;
}

/** 이 글꼴에서 굵게/보통 요청에 맞는 굵기 */
export function fontWeight(id: string | undefined, bold: boolean, fallbackBold = 800, fallbackNormal = 500): number {
  const f = fontDef(id);
  if (!f.gf) return bold ? fallbackBold : fallbackNormal;
  const w = f.weights ?? [400];
  return bold ? w[w.length - 1] : w[0];
}

const familyParam = (f: FontDef) => (f.weights && f.weights.length > 1 ? `${f.gf}:wght@${f.weights.join(';')}` : f.gf!);

/* ------------------------------ 화면용 불러오기 ------------------------------ */

const linked = new Set<string>();

/** 화면에서 이 글꼴을 쓸 수 있게 한다(한 번만 <link> 를 붙인다) */
export function ensureFontLoaded(id?: string) {
  if (typeof document === 'undefined') return;
  const f = fontDef(id);
  if (!f.gf || linked.has(f.id)) return;
  linked.add(f.id);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${familyParam(f)}&display=swap`;
  link.dataset.font = f.id;
  document.head.appendChild(link);
}

export function ensureFontsForBubbles(bubbles: Bubble[]) {
  for (const b of bubbles) if (b.font) ensureFontLoaded(b.font);
}

/** 글꼴 고르기 목록에서 미리보기를 보여 주려고 모든 글꼴을 불러온다 */
export function ensureAllFonts() {
  for (const f of FONTS) ensureFontLoaded(f.id);
}

/* ------------------------------ 내보내기용 글꼴 넣기 ------------------------------ */

const embedCache = new Map<string, Promise<string>>();

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function embedOne(f: FontDef, chars: string): Promise<string> {
  const url = `https://fonts.googleapis.com/css2?family=${familyParam(f)}&text=${encodeURIComponent(chars)}`;
  const css = await (await fetch(url)).text();
  const blocks = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  const out: string[] = [];
  for (const block of blocks) {
    const src = block.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, '');
    if (!src) continue;
    const res = await fetch(src);
    if (!res.ok) continue;
    const type = /woff2/.test(block) ? 'font/woff2' : /woff\)/.test(block) ? 'font/woff' : 'font/ttf';
    const data = `url(data:${type};base64,${toBase64(await res.arrayBuffer())})`;
    out.push(block.replace(/src:[^;]+;/, `src: ${data};`));
  }
  return out.join('\n');
}

/**
 * 말풍선들이 쓰는 글꼴을 SVG 안에 넣을 CSS(@font-face) 로 만든다.
 * 글꼴마다 실제로 쓰인 글자만 담아서 작다. 실패하면 빈 문자열(기본 글꼴로 그려짐).
 */
export async function embeddedFontCss(bubbles: Bubble[]): Promise<string> {
  const chars = new Map<string, Set<string>>();
  for (const b of bubbles) {
    const f = fontDef(b.font);
    if (!f.gf) continue;
    const set = chars.get(f.id) ?? new Set<string>();
    for (const c of b.text) if (c.trim()) set.add(c);
    chars.set(f.id, set);
  }
  const parts: string[] = [];
  for (const [id, set] of chars) {
    if (!set.size) continue;
    const text = [...set].sort().join('');
    const key = `${id}|${text}`;
    let p = embedCache.get(key);
    if (!p) {
      p = embedOne(fontDef(id), text).catch(() => '');
      embedCache.set(key, p);
    }
    parts.push(await p);
  }
  return parts.filter(Boolean).join('\n');
}

/** SVG 문서 안에 넣을 <defs><style> 조각 */
export const fontStyleTag = (css: string) => (css ? `<defs><style><![CDATA[${css}]]></style></defs>` : '');
