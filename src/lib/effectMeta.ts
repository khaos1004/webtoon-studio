import type { Effect, EffectParams, EffectType } from './types';
import { uid } from './types';

export const BASE_PARAMS: EffectParams = {
  angle: 0,
  distance: 20,
  count: 3,
  strength: 0.6,
  rotation: 0,
  style: 'line',
  oneSided: false,
  sharp: 0,
  blur: 8,
  lineCount: 60,
  lineLength: 220,
  lineWidth: 3,
  spread: 60,
  color: '#ffffff',
  seed: 1,
  avoidObject: true,
  innerRadius: 0.35,
  dot: 8,
  dotAngle: 45,
  threshold: 160,
  mode: 'none',
  saturation: 1,
  contrast: 1,
  brightness: 0,
  hue: 0,
  amount: 0.5,
  period: 40,
  levels: 4,
  tint: 0,
  tintColor: '#5b8cff',
  soft: 0,
  falloff: 0.7,
  mono: true,
  lineStyle: 'taper',
  useCenter: false,
  centerX: 0,
  centerY: 0,
  materialId: '',
  matMode: 'color',
  matFit: 'stamp',
  matScale: 100,
  matBlend: 'normal',
  matFlip: false,
  tone: 'dot',
  toneSource: 'image',
  density: 0.5,
};

export type Control =
  | { t: 'range'; key: keyof EffectParams; label: string; min: number; max: number; step: number }
  | { t: 'color'; key: keyof EffectParams; label: string }
  | { t: 'toggle'; key: keyof EffectParams; label: string }
  | { t: 'material'; key: keyof EffectParams; label: string }
  | { t: 'select'; key: keyof EffectParams; label: string; options: [string, string][] };

const angle: Control = { t: 'range', key: 'angle', label: '방향(°)', min: 0, max: 360, step: 1 };
const strength = (label = '강도'): Control => ({ t: 'range', key: 'strength', label, min: 0, max: 1, step: 0.01 });
const seed: Control = { t: 'range', key: 'seed', label: '무작위 시드', min: 1, max: 99, step: 1 };

export type HandleSpec = { kind: 'dir'; distKey?: keyof EffectParams; min?: number; max?: number } | { kind: 'center' };

export interface EffectMeta {
  label: string;
  desc: string;
  /** 화면에서 직접 끌어 조절하는 핸들 */
  handle?: HandleSpec;
  defaults: Partial<EffectParams>;
  controls: Control[];
}

export const EFFECT_META: Record<EffectType, EffectMeta> = {
  shake: {
    label: '흔들림',
    desc: '선택한 물체를 복제해 좌우로 겹쳐 떨리는 느낌을 만든다',
    handle: { kind: 'dir', distKey: 'distance', min: 2, max: 120 },
    defaults: { distance: 30, count: 3, strength: 0.85, angle: 0, rotation: 2, style: 'line', soft: 1.2, falloff: 0.65 },
    controls: [
      { t: 'select', key: 'style', label: '방식', options: [['line', '방향선'], ['random', '진동(무작위)']] },
      angle,
      { t: 'range', key: 'distance', label: '이동 거리(px)', min: 2, max: 120, step: 1 },
      { t: 'range', key: 'count', label: '잔상 개수', min: 1, max: 6, step: 1 },
      { t: 'range', key: 'rotation', label: '회전(°)', min: 0, max: 20, step: 0.5 },
      strength('잔상 진하기'),
      { t: 'range', key: 'falloff', label: '멀수록 옅게', min: 0, max: 1, step: 0.01 },
      { t: 'range', key: 'soft', label: '잔상 흐림(px)', min: 0, max: 20, step: 0.5 },
      { t: 'range', key: 'tint', label: '잔상 색 입히기', min: 0, max: 1, step: 0.01 },
      { t: 'color', key: 'tintColor', label: '잔상 색' },
      seed,
    ],
  },
  afterimage: {
    label: '잔상',
    desc: '움직임 반대 방향으로 이전 위치의 복제본을 남긴다',
    handle: { kind: 'dir', distKey: 'distance', min: 5, max: 300 },
    defaults: { distance: 70, count: 4, strength: 0.6, angle: 0, rotation: 0, soft: 2, falloff: 0.8, tint: 0.2 },
    controls: [
      angle,
      { t: 'range', key: 'distance', label: '이동 거리(px)', min: 5, max: 300, step: 1 },
      { t: 'range', key: 'count', label: '잔상 개수', min: 1, max: 8, step: 1 },
      { t: 'range', key: 'rotation', label: '회전(°)', min: 0, max: 30, step: 0.5 },
      strength('잔상 진하기'),
      { t: 'range', key: 'falloff', label: '뒤로 갈수록 옅게', min: 0, max: 1, step: 0.01 },
      { t: 'range', key: 'soft', label: '잔상 흐림(px)', min: 0, max: 30, step: 0.5 },
      { t: 'range', key: 'tint', label: '잔상 색 입히기', min: 0, max: 1, step: 0.01 },
      { t: 'color', key: 'tintColor', label: '잔상 색' },
    ],
  },
  motionblur: {
    label: '모션 블러',
    desc: '선택한 물체의 픽셀만 지정 방향으로 번지게 한다',
    handle: { kind: 'dir', distKey: 'distance', min: 4, max: 200 },
    defaults: { distance: 40, strength: 1, angle: 0, oneSided: false, sharp: 0, falloff: 0.7 },
    controls: [
      angle,
      { t: 'range', key: 'distance', label: '흐림 길이(px)', min: 4, max: 200, step: 1 },
      { t: 'toggle', key: 'oneSided', label: '한쪽 꼬리만(진행 방향 뒤로)' },
      { t: 'range', key: 'falloff', label: '꼬리 끝 옅기(한쪽)', min: 0, max: 1, step: 0.01 },
      { t: 'range', key: 'sharp', label: '선명한 원본 남기기', min: 0, max: 1, step: 0.01 },
      strength(),
    ],
  },
  blur: {
    label: '블러',
    desc: '선택 영역만 부드럽게 흐린다',
    defaults: { blur: 10, strength: 1 },
    controls: [{ t: 'range', key: 'blur', label: '반경(px)', min: 1, max: 60, step: 1 }, strength()],
  },
  speedlines: {
    handle: { kind: 'dir' },
    label: '속도선',
    desc: '방향에 맞춘 선을 선택한 물체 주변에 그린다',
    defaults: { angle: 0, lineCount: 90, lineLength: 260, lineWidth: 4, spread: 80, color: '#ffffff', strength: 0.95, avoidObject: true },
    controls: [
      angle,
      { t: 'range', key: 'lineCount', label: '선 개수', min: 5, max: 250, step: 1 },
      { t: 'range', key: 'lineLength', label: '선 길이', min: 40, max: 700, step: 5 },
      { t: 'range', key: 'lineWidth', label: '선 굵기', min: 1, max: 12, step: 0.5 },
      { t: 'range', key: 'spread', label: '퍼지는 범위', min: 10, max: 300, step: 5 },
      { t: 'select', key: 'lineStyle', label: '선 모양', options: [['taper', '양끝이 뾰족한 선'], ['thick-thin', '굵고 가는 선 섞기'], ['burst', '혜성(앞이 굵고 뒤로 끌림)']] },
      { t: 'range', key: 'soft', label: '번짐(부드럽게)', min: 0, max: 6, step: 0.5 },
      { t: 'toggle', key: 'avoidObject', label: '물체 위에는 그리지 않기' },
      { t: 'color', key: 'color', label: '선 색' },
      strength('선 진하기'),
      seed,
    ],
  },
  focuslines: {
    label: '집중선',
    desc: '선택 영역의 중심으로 모이는 방사형 선을 그린다',
    handle: { kind: 'center' },
    defaults: { lineCount: 90, lineWidth: 5, innerRadius: 0.35, color: '#000000', strength: 1, lineStyle: 'taper' },
    controls: [
      { t: 'select', key: 'lineStyle', label: '모양', options: [['taper', '끝이 뾰족한 선'], ['thick-thin', '굵고 가는 선'], ['burst', '폭발(삼각형)']] },
      { t: 'range', key: 'lineCount', label: '선 개수', min: 10, max: 300, step: 1 },
      { t: 'range', key: 'lineWidth', label: '선 굵기', min: 1, max: 20, step: 0.5 },
      { t: 'range', key: 'innerRadius', label: '중심 빈 공간', min: 0, max: 0.9, step: 0.01 },
      { t: 'color', key: 'color', label: '선 색' },
      strength('선 진하기'),
      seed,
    ],
  },
  halftone: {
    label: '망점',
    desc: '선택 영역을 만화식 망점(스크린톤)으로 바꾼다',
    defaults: { dot: 7, dotAngle: 45, color: '#000000', strength: 1, tone: 'dot', toneSource: 'image', density: 0.5, angle: 90 },
    controls: [
      { t: 'select', key: 'tone', label: '톤 모양', options: [['dot', '망점'], ['line', '선(라인톤)'], ['cross', '그물(크로스)'], ['stipple', '점묘(모래알)']] },
      { t: 'select', key: 'toneSource', label: '농도 기준', options: [['image', '그림의 밝기를 따라감'], ['flat', '일정한 농도'], ['gradient', '그라데이션 톤']] },
      { t: 'range', key: 'density', label: '농도(일정/그라데이션)', min: 0.05, max: 1, step: 0.01 },
      { t: 'range', key: 'angle', label: '그라데이션 방향(°)', min: 0, max: 360, step: 1 },
      { t: 'range', key: 'dot', label: '망점 크기(px)', min: 3, max: 24, step: 1 },
      { t: 'range', key: 'dotAngle', label: '망점 각도(°)', min: 0, max: 90, step: 1 },
      { t: 'color', key: 'color', label: '점 색' },
      strength(),
    ],
  },
  glow: {
    label: '빛 번짐',
    desc: '선택 영역의 밝은 부분이 주변으로 번진다',
    defaults: { threshold: 150, blur: 24, strength: 0.9 },
    controls: [
      { t: 'range', key: 'threshold', label: '밝기 기준', min: 0, max: 250, step: 1 },
      { t: 'range', key: 'blur', label: '번짐 반경(px)', min: 4, max: 80, step: 1 },
      strength(),
    ],
  },
  color: {
    label: '색 보정',
    desc: '흑백·세피아·반전·채도·대비·밝기·색조를 선택 영역에만 적용',
    defaults: { mode: 'none', saturation: 1, contrast: 1, brightness: 0, hue: 0, strength: 1 },
    controls: [
      { t: 'select', key: 'mode', label: '프리셋', options: [['none', '없음'], ['gray', '흑백'], ['sepia', '세피아'], ['invert', '색 반전']] },
      { t: 'range', key: 'saturation', label: '채도', min: 0, max: 2.5, step: 0.01 },
      { t: 'range', key: 'contrast', label: '대비', min: 0.3, max: 2.5, step: 0.01 },
      { t: 'range', key: 'brightness', label: '밝기', min: -100, max: 100, step: 1 },
      { t: 'range', key: 'hue', label: '색조 회전(°)', min: -180, max: 180, step: 1 },
      strength('적용 강도'),
    ],
  },
  zoomblur: {
    label: '줌 블러',
    desc: '중심에서 바깥으로 쏟아지는 방사형 블러 (충격·돌진)',
    handle: { kind: 'center' },
    defaults: { amount: 0.55, innerRadius: 0.3, strength: 1 },
    controls: [
      { t: 'range', key: 'amount', label: '세기', min: 0.05, max: 1, step: 0.01 },
      { t: 'range', key: 'innerRadius', label: '중심 선명 범위', min: 0, max: 0.9, step: 0.01 },
      strength(),
    ],
  },
  chroma: {
    label: '색수차',
    desc: '빨강·파랑 채널을 어긋나게 해서 충격·떨림을 강조',
    handle: { kind: 'dir', distKey: 'distance', min: 1, max: 40 },
    defaults: { distance: 6, angle: 0, strength: 1 },
    controls: [angle, { t: 'range', key: 'distance', label: '어긋남(px)', min: 1, max: 40, step: 0.5 }, strength()],
  },
  glitch: {
    label: '글리치',
    desc: '가로 줄이 어긋나고 색이 갈라지는 디지털 노이즈',
    defaults: { count: 8, distance: 40, strength: 1 },
    controls: [
      { t: 'range', key: 'count', label: '줄 개수', min: 1, max: 30, step: 1 },
      { t: 'range', key: 'distance', label: '어긋남(px)', min: 4, max: 160, step: 1 },
      strength(),
      seed,
    ],
  },
  wave: {
    label: '파동·아지랑이',
    desc: '픽셀을 물결처럼 일렁이게 해서 열기·동요·꿈 장면을 만든다',
    handle: { kind: 'dir' },
    defaults: { angle: 90, distance: 6, period: 40, strength: 1 },
    controls: [
      angle,
      { t: 'range', key: 'distance', label: '흔들림 폭(px)', min: 1, max: 40, step: 0.5 },
      { t: 'range', key: 'period', label: '파장(px)', min: 8, max: 240, step: 1 },
      strength(),
      { t: 'range', key: 'seed', label: '위상', min: 1, max: 99, step: 1 },
    ],
  },
  shade: {
    label: '음영(그라데이션)',
    desc: '선택 영역 한쪽을 곱하기로 어둡게 깔아 입체감·공포·저녁 분위기를 만든다',
    handle: { kind: 'dir' },
    defaults: { angle: 90, amount: 0.85, color: '#1b2150', strength: 0.75 },
    controls: [
      angle,
      { t: 'range', key: 'amount', label: '범위', min: 0.1, max: 1, step: 0.01 },
      { t: 'color', key: 'color', label: '음영 색' },
      strength('진하기'),
    ],
  },
  outline: {
    label: '외곽선·네온',
    desc: '선택한 물체 바깥에 스티커 같은 윤곽선이나 네온 빛을 두른다',
    defaults: { lineWidth: 5, blur: 0, color: '#ffffff', strength: 1 },
    controls: [
      { t: 'range', key: 'lineWidth', label: '선 굵기(px)', min: 1, max: 30, step: 0.5 },
      { t: 'range', key: 'blur', label: '번짐(네온)', min: 0, max: 60, step: 1 },
      { t: 'color', key: 'color', label: '색' },
      strength(),
    ],
  },
  shadow: {
    label: '그림자',
    desc: '선택한 물체 뒤에 부드러운 그림자를 드리운다',
    handle: { kind: 'dir', distKey: 'distance', min: 0, max: 80 },
    defaults: { distance: 16, angle: 50, blur: 12, color: '#000000', strength: 0.55 },
    controls: [
      angle,
      { t: 'range', key: 'distance', label: '거리(px)', min: 0, max: 80, step: 1 },
      { t: 'range', key: 'blur', label: '번짐(px)', min: 0, max: 60, step: 1 },
      { t: 'color', key: 'color', label: '그림자 색' },
      strength('진하기'),
    ],
  },
  grain: {
    label: '노이즈·그레인',
    desc: '필름 입자 같은 노이즈로 거친 질감을 만든다',
    defaults: { amount: 0.4, dot: 3, mono: true, strength: 1 },
    controls: [
      { t: 'range', key: 'amount', label: '세기', min: 0.05, max: 1, step: 0.01 },
      { t: 'range', key: 'dot', label: '입자 크기', min: 1, max: 12, step: 1 },
      { t: 'toggle', key: 'mono', label: '흑백 노이즈' },
      strength(),
      seed,
    ],
  },
  poster: {
    label: '포스터화(툰 색)',
    desc: '색 단계를 줄여 셀 애니·만화 같은 평평한 색으로 만든다',
    defaults: { levels: 4, strength: 1 },
    controls: [{ t: 'range', key: 'levels', label: '색 단계', min: 2, max: 8, step: 1 }, strength()],
  },
  sparkle: {
    label: '반짝임',
    desc: '밝은 부분에 십자 모양 빛 반짝임을 뿌린다',
    defaults: { count: 8, lineLength: 90, lineWidth: 3, threshold: 185, color: '#ffffff', strength: 1, seed: 3 },
    controls: [
      { t: 'range', key: 'count', label: '개수', min: 1, max: 40, step: 1 },
      { t: 'range', key: 'lineLength', label: '크기', min: 20, max: 260, step: 2 },
      { t: 'range', key: 'lineWidth', label: '굵기', min: 1, max: 10, step: 0.5 },
      { t: 'range', key: 'threshold', label: '밝기 기준', min: 0, max: 250, step: 1 },
      { t: 'color', key: 'color', label: '색' },
      strength(),
      seed,
    ],
  },
  swoosh: {
    label: '휘두르기 궤적',
    desc: '팔·무기·물체가 지나간 자리를 초승달 모양 곡선으로 그린다 (클립스튜디오의 동작선)',
    handle: { kind: 'dir', distKey: 'distance', min: 40, max: 400 },
    defaults: { angle: 0, distance: 150, rotation: 80, count: 3, lineWidth: 16, color: '#ffffff', strength: 0.92, soft: 0, avoidObject: true, seed: 4 },
    controls: [
      angle,
      { t: 'range', key: 'distance', label: '궤적 반지름(px)', min: 40, max: 400, step: 2 },
      { t: 'range', key: 'rotation', label: '호의 길이(°)', min: 15, max: 220, step: 1 },
      { t: 'range', key: 'count', label: '가닥 수', min: 1, max: 6, step: 1 },
      { t: 'range', key: 'lineWidth', label: '굵기', min: 3, max: 50, step: 0.5 },
      { t: 'range', key: 'soft', label: '번짐', min: 0, max: 10, step: 0.5 },
      { t: 'toggle', key: 'avoidObject', label: '물체 뒤로 보내기(위에는 안 그림)' },
      { t: 'color', key: 'color', label: '색' },
      strength('진하기'),
      seed,
    ],
  },
  material: {
    label: '소재 붙이기',
    desc: '가져온 소재(톤·효과선·질감·스탬프)를 선택 영역에 붙인다. 화면에서 상자 안을 끌어 옮기고, 모서리로 크기, 위 동그라미로 회전한다',
    handle: { kind: 'center' },
    defaults: { matFit: 'stamp', matMode: 'color', matBlend: 'normal', matScale: 100, rotation: 0, strength: 1, color: '#000000' },
    controls: [
      { t: 'material', key: 'materialId', label: '소재' },
      { t: 'select', key: 'matFit', label: '배치', options: [['stamp', '한 장(스탬프)'], ['tile', '반복(톤 패턴)'], ['cover', '영역 가득 채우기']] },
      { t: 'select', key: 'matMode', label: '색 해석', options: [['color', '원래 색 그대로'], ['ink', '어두운 부분을 잉크로(흰 바탕 톤)'], ['light', '밝은 부분을 빛으로(검은 바탕)']] },
      { t: 'color', key: 'color', label: '잉크/빛 색(위 두 방식)' },
      { t: 'select', key: 'matBlend', label: '합성 방식', options: [['normal', '보통'], ['multiply', '곱하기(어둡게)'], ['screen', '스크린(밝게)'], ['overlay', '오버레이'], ['soft-light', '소프트 라이트'], ['add', '더하기(빛)']] },
      { t: 'range', key: 'matScale', label: '크기(%)', min: 5, max: 800, step: 1 },
      { t: 'range', key: 'rotation', label: '회전(°)', min: -180, max: 180, step: 1 },
      { t: 'toggle', key: 'matFlip', label: '좌우 반전' },
      strength('불투명도'),
    ],
  },
};

export const EFFECT_GROUPS: { title: string; types: EffectType[] }[] = [
  { title: '움직임', types: ['shake', 'afterimage', 'motionblur', 'zoomblur', 'wave', 'glitch', 'chroma'] },
  { title: '선·기호', types: ['speedlines', 'focuslines', 'swoosh', 'sparkle'] },
  { title: '소재', types: ['material'] },
  { title: '빛·색·질감', types: ['glow', 'shade', 'color', 'poster', 'grain', 'halftone'] },
  { title: '윤곽·흐림', types: ['outline', 'shadow', 'blur'] },
];

export const EFFECT_ORDER: EffectType[] = EFFECT_GROUPS.flatMap((g) => g.types);

export function createEffect(type: EffectType): Effect {
  const meta = EFFECT_META[type];
  return {
    id: uid(),
    type,
    name: meta.label,
    visible: true,
    opacity: 1,
    mask: { ops: [], feather: 3 },
    params: { ...BASE_PARAMS, ...meta.defaults },
  };
}
