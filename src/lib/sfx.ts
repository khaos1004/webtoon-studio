import type { Bubble, SfxStyle } from './types';
import { DEFAULT_SFX } from './bubble';

/**
 * 글자 의성어: 스타일 프리셋과 웹툰에서 자주 쓰는 의성어·의태어 목록.
 * 스타일은 말풍선(kind 'sfx')에 덮어쓰는 값이다.
 */

export interface SfxPreset {
  id: string;
  label: string;
  /** 미리보기 글자 */
  sample: string;
  patch: Partial<Bubble> & { sfx: Partial<SfxStyle> };
}

const S = (p: Partial<SfxStyle>): SfxStyle => ({ ...DEFAULT_SFX, ...p });

export const SFX_PRESETS: SfxPreset[] = [
  {
    id: 'impact',
    label: '타격 (흰 테두리)',
    sample: '쾅',
    patch: { font: 'black-han-sans', textColor: '#111111', stroke: '#ffffff', strokeWidth: 6, sfx: S({ stroke2: '#111111', stroke2Width: 2, rotation: -8, skew: -10, jitter: 0.3 }) },
  },
  {
    id: 'explosion',
    label: '폭발 (불꽃)',
    sample: '콰광',
    patch: { font: 'black-han-sans', textColor: '#fff36b', stroke: '#1a0a00', strokeWidth: 4, sfx: S({ gradient: true, fill2: '#ff3b1f', stroke2: '#ffffff', stroke2Width: 4, extrude: 10, extrudeColor: '#7a1300', extrudeAngle: 60, jitter: 0.45, rotation: -4, skew: -6, grow: 0.5 }) },
  },
  {
    id: 'heavy',
    label: '묵직 (입체)',
    sample: '쿵',
    patch: { font: 'black-han-sans', textColor: '#2a2a2a', stroke: '#ffffff', strokeWidth: 5, sfx: S({ extrude: 14, extrudeColor: '#000000', extrudeAngle: 90, jitter: 0.1, rotation: 0, skew: 0, spacing: 0.05 }) },
  },
  {
    id: 'speed',
    label: '빠름 (잔상)',
    sample: '휘익',
    patch: { font: 'do-hyeon', textColor: '#1b1b1b', stroke: '#ffffff', strokeWidth: 4, sfx: S({ skew: -24, rotation: -4, jitter: 0.1, motion: 3, motionAngle: 180, spacing: 0.1 }) },
  },
  {
    id: 'shake',
    label: '떨림 (들쭉날쭉)',
    sample: '부들부들',
    patch: { font: 'do-hyeon', textColor: '#3a3a3a', stroke: '#ffffff', strokeWidth: 4, sfx: S({ jitter: 0.95, rotation: 0, skew: 0, spacing: -0.05 }) },
  },
  {
    id: 'heart',
    label: '설렘 (분홍)',
    sample: '두근',
    patch: { font: 'jua', textColor: '#ff5c93', stroke: '#ffffff', strokeWidth: 6, sfx: S({ stroke2: '#ff9fc0', stroke2Width: 2, jitter: 0.35, rotation: -6, skew: 0, arc: 0.25 }) },
  },
  {
    id: 'cute',
    label: '귀여움 (둥근)',
    sample: '뿅',
    patch: { font: 'jua', textColor: '#ffd23f', stroke: '#3b2a00', strokeWidth: 4, sfx: S({ stroke2: '#ffffff', stroke2Width: 4, jitter: 0.3, rotation: 6, skew: 0, arc: 0.3 }) },
  },
  {
    id: 'scream',
    label: '비명 (빨강)',
    sample: '꺄아악',
    patch: { font: 'black-han-sans', textColor: '#ff2d2d', stroke: '#ffffff', strokeWidth: 5, sfx: S({ stroke2: '#000000', stroke2Width: 2, jitter: 0.7, rotation: -5, skew: -6, grow: 0.6 }) },
  },
  {
    id: 'horror',
    label: '공포 (붓)',
    sample: '스윽',
    patch: { font: 'dokdo', textColor: '#7a0000', stroke: '#000000', strokeWidth: 2, sfx: S({ jitter: 0.4, rotation: 4, skew: 0, spacing: 0.15, extrude: 4, extrudeColor: '#000000', extrudeAngle: 100 }) },
  },
  {
    id: 'quiet',
    label: '조용 (얇게)',
    sample: '스르륵',
    patch: { font: 'nanum-pen', textColor: '#555555', stroke: '#ffffff', strokeWidth: 3, bold: false, sfx: S({ jitter: 0.15, rotation: -3, skew: -6, spacing: 0.1 }) },
  },
  {
    id: 'sparkle',
    label: '반짝 (금빛)',
    sample: '반짝',
    patch: { font: 'jua', textColor: '#fffbe0', stroke: '#c48a00', strokeWidth: 3, sfx: S({ gradient: true, fill2: '#ffc400', stroke2: '#ffffff', stroke2Width: 4, jitter: 0.2, rotation: -4, skew: 0 }) },
  },
  {
    id: 'electric',
    label: '전기·기계 (네온)',
    sample: '파지직',
    patch: { font: 'gugi', textColor: '#e9fbff', stroke: '#00b7ff', strokeWidth: 4, sfx: S({ stroke2: '#003a66', stroke2Width: 3, jitter: 0.6, rotation: -3, skew: -12 }) },
  },
  {
    id: 'cold',
    label: '차가움 (얼음)',
    sample: '쩌억',
    patch: { font: 'do-hyeon', textColor: '#ffffff', stroke: '#2a6fb0', strokeWidth: 4, sfx: S({ gradient: true, fill2: '#9fd7ff', stroke2: '#0d2a45', stroke2Width: 2, extrude: 6, extrudeColor: '#0d2a45', extrudeAngle: 70, rotation: -2, skew: 0 }) },
  },
  {
    id: 'comic',
    label: '코믹 (흑백)',
    sample: '털썩',
    patch: { font: 'jua', textColor: '#ffffff', stroke: '#111111', strokeWidth: 5, sfx: S({ jitter: 0.35, rotation: 5, skew: 0 }) },
  },
  {
    id: 'hand',
    label: '손글씨 (작은 효과음)',
    sample: '바스락',
    patch: { font: 'nanum-pen', textColor: '#222222', stroke: '#ffffff', strokeWidth: 4, bold: false, sfx: S({ jitter: 0.2, rotation: -2, skew: 0, spacing: -0.02 }) },
  },
  {
    id: 'romance',
    label: '로맨스 (부드럽게)',
    sample: '쪽',
    patch: { font: 'gaegu', textColor: '#e2557d', stroke: '#ffffff', strokeWidth: 5, sfx: S({ jitter: 0.25, rotation: -8, skew: 0, arc: 0.2 }) },
  },
  {
    id: 'outline',
    label: '속 빈 글자',
    sample: '두둥',
    patch: { font: 'black-han-sans', textColor: '#ffffff', stroke: '#111111', strokeWidth: 4, sfx: S({ jitter: 0.1, rotation: 0, skew: 0, spacing: 0.1, extrude: 6, extrudeColor: '#111111', extrudeAngle: 45 }) },
  },
  {
    id: 'big-black',
    label: '큰 먹글씨',
    sample: '쿠구궁',
    patch: { font: 'dokdo', textColor: '#000000', stroke: '#ffffff', strokeWidth: 3, sfx: S({ jitter: 0.5, rotation: -3, skew: 0, grow: 0.4 }) },
  },
];

export const presetById = (id: string) => SFX_PRESETS.find((p) => p.id === id) ?? SFX_PRESETS[0];

export interface SfxCategory {
  id: string;
  label: string;
  /** 이 분류의 글자를 누르면 처음 쓰는 스타일 */
  style: string;
  words: string[];
}

export const SFX_CATEGORIES: SfxCategory[] = [
  {
    id: 'hit',
    label: '타격·충격',
    style: 'impact',
    words: ['쾅', '콰광', '쿵', '쿠궁', '퍽', '퍼억', '빡', '빠악', '탁', '타악', '팍', '파악', '콱', '꽝', '콰앙', '쿠웅', '뻑', '뻐억', '짝', '짜악', '찰싹', '철썩', '와장창', '와지끈', '우지끈', '콰직', '우직', '빠직', '쨍그랑', '쨍', '와르르', '털썩', '철퍼덕', '쿵탕', '덜컹', '드드득', '퍼버벅', '콰콰콱', '퍽퍽', '쾅쾅'],
  },
  {
    id: 'move',
    label: '움직임·속도',
    style: 'speed',
    words: ['휙', '휘익', '쉭', '쉬익', '슉', '슈욱', '휭', '쌩', '쌔앵', '휘리릭', '후다닥', '다다다', '우다다', '스윽', '스르륵', '슥', '쓱', '사삭', '파바박', '휘청', '비틀', '펄럭', '폴짝', '팔짝', '쭈욱', '쑤욱', '휙휙', '붕', '부웅', '쑥', '번쩍', '샤샥', '타다닥', '후욱', '훅', '휘청휘청', '데굴데굴', '빙글', '뱅글', '흔들'],
  },
  {
    id: 'boom',
    label: '폭발·불·전기',
    style: 'explosion',
    words: ['펑', '퍼엉', '콰과광', '쾅콰광', '콰쾅', '화르륵', '활활', '타닥', '타닥타닥', '지글지글', '치익', '파지직', '빠지직', '찌릿', '지지직', '번쩍', '콰르릉', '우르릉', '쿠르릉', '쿠구궁', '두두두', '콰가가가', '퍼버벙', '슈우욱', '피융', '타앙', '탕', '타타타', '드르륵', '철컥'],
  },
  {
    id: 'feel',
    label: '감정·반응',
    style: 'shake',
    words: ['두근', '두근두근', '콩닥콩닥', '쿵쾅쿵쾅', '움찔', '흠칫', '깜짝', '덜덜', '부들부들', '오싹', '소름', '히익', '헉', '허억', '흑', '훌쩍', '울컥', '뜨끔', '철렁', '멍', '휴', '하아', '후우', '끄응', '피식', '큭', '킥킥', '크크', '하하', '히히', '흐흐', '으으', '으악', '꺄악', '꺄아', '우와', '와아', '오오', '흥', '칫', '쳇', '에휴', '헐', '짜잔', '두둥', '띠용', '뿅', '뾰로롱', '반짝', '반짝반짝', '부글부글', '욱', '빠직', '드르렁', '쿨쿨'],
  },
  {
    id: 'life',
    label: '생활음',
    style: 'hand',
    words: ['똑똑', '딩동', '따르릉', '띠리링', '지잉', '위잉', '찰칵', '딸깍', '달칵', '끼익', '덜컥', '삐걱', '부스럭', '바스락', '사각사각', '똑', '뚝', '뚝뚝', '보글보글', '지글', '후루룩', '냠냠', '쩝쩝', '꿀꺽', '짝짝짝', '쿵쿵', '저벅저벅', '터벅터벅', '또각또각', '사뿐', '빵빵', '부릉', '부우웅', '끼이익', '삐뽀삐뽀', '띠띠', '삐빅', '탁탁', '톡', '톡톡', '드르륵', '쏴아', '콸콸', '쪼르륵', '탈칵', '덜그럭', '달그락', '바삭', '와그작', '쭈욱'],
  },
  {
    id: 'nature',
    label: '자연·날씨',
    style: 'quiet',
    words: ['쏴아아', '후두둑', '주룩주룩', '우르르쾅', '휘이잉', '쌔앵', '살랑', '사르르', '출렁', '철썩', '졸졸', '펑펑', '소복소복', '짹짹', '멍멍', '왈왈', '야옹', '꼬끼오', '음메', '부엉', '맴맴', '개굴', '찌르르', '윙윙', '바스스', '쿠르릉', '부슬부슬', '팔랑', '나풀나풀', '스스스'],
  },
  {
    id: 'romance',
    label: '로맨스',
    style: 'romance',
    words: ['두근', '쿵', '쪽', '쪼옥', '츄', '쪽쪽', '움찔', '찌릿', '화끈', '후끈', '홧', '꼬옥', '꽈악', '와락', '스윽', '쓰담', '토닥', '살포시', '폭', '포옥', '부비', '꼭', '하앗', '흐읏', '앗', '흣', '으응', '하아', '흐응', '오싹', '두근두근', '콩닥', '사르르', '몽글몽글', '말랑'],
  },
  {
    id: 'horror',
    label: '공포·긴장',
    style: 'horror',
    words: ['끼이익', '스윽', '뚝', '또각', '사각', '스스스', '쿵', '똑…똑', '히히히', '키득', '끄으윽', '크르르', '그르릉', '으르렁', '쉬익', '찌익', '철컥', '덜컹', '오싹', '쿠웅', '지이익', '삐걱', '서걱', '뚜벅', '휘이이', '꾸욱', '쩌억', '두근', '흐흐흐', '쿠구구'],
  },
];

/** 모든 분류의 글자(중복 없이) — 검색용 */
export const ALL_SFX_WORDS: { word: string; cat: SfxCategory }[] = (() => {
  const seen = new Set<string>();
  const out: { word: string; cat: SfxCategory }[] = [];
  for (const cat of SFX_CATEGORIES)
    for (const w of cat.words)
      if (!seen.has(w)) {
        seen.add(w);
        out.push({ word: w, cat });
      }
  return out;
})();

/** 스타일 프리셋을 의성어에 적용(글자·위치·크기는 그대로) */
export function applySfxPreset(b: Bubble, preset: SfxPreset): Bubble {
  const { sfx, ...rest } = preset.patch;
  return { ...b, ...rest, bold: rest.bold ?? true, sfx: { ...DEFAULT_SFX, ...sfx } };
}
