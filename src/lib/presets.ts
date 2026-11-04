import type { Effect, EffectParams, EffectType, MaskDef } from './types';
import { uid } from './types';
import { createEffect } from './effectMeta';

export interface PresetLayer {
  type: EffectType;
  name?: string;
  params?: Partial<EffectParams>;
  /** 이 레이어만 선택 영역을 반전 (예: 배경만 흐르게) */
  invert?: boolean;
  feather?: number;
  opacity?: number;
}

export interface Preset {
  id: string;
  label: string;
  desc: string;
  category: '움직임' | '충격' | '분위기' | '만화 톤';
  layers: PresetLayer[];
}

/** 선택 영역 하나에 여러 효과 레이어를 한 번에 쌓는 원클릭 프리셋 */
export const PRESETS: Preset[] = [
  {
    id: 'shake-hold',
    label: '흔들어 든 물체',
    desc: '손에 든 콜라·컵을 흔드는 느낌. 복제본 잔상 + 약한 모션 블러',
    category: '움직임',
    layers: [
      { type: 'shake', name: '흔들림 잔상', params: { distance: 26, count: 4, rotation: 3.5, strength: 0.72, soft: 2, angle: 0 } },
      { type: 'motionblur', name: '미세 번짐', params: { distance: 14, strength: 0.65, sharp: 0.45, angle: 0 } },
    ],
  },
  {
    id: 'swing',
    label: '휘두르기',
    desc: '팔·무기를 빠르게 휘두를 때. 꼬리 모션 블러 + 색 입힌 잔상 + 속도선',
    category: '움직임',
    layers: [
      { type: 'motionblur', name: '꼬리 블러', params: { distance: 70, oneSided: true, sharp: 0.5, strength: 1, angle: 0, falloff: 0.8 } },
      { type: 'afterimage', name: '잔상', params: { distance: 100, count: 4, tint: 0.3, strength: 0.5, angle: 0 } },
      { type: 'speedlines', name: '속도선', params: { angle: 0, lineCount: 70, lineLength: 280, color: '#ffffff', spread: 90 } },
    ],
  },
  {
    id: 'tremble',
    label: '부들부들 떨림',
    desc: '무섭거나 추울 때 떠는 몸. 무작위 진동 + 약한 색수차',
    category: '움직임',
    layers: [
      { type: 'shake', name: '진동', params: { style: 'random', distance: 9, count: 4, rotation: 1.2, strength: 0.6, soft: 0.8 } },
      { type: 'chroma', name: '색 어긋남', params: { distance: 3, angle: 0, strength: 0.8 } },
    ],
  },
  {
    id: 'bg-flow',
    label: '배경 흘러가기',
    desc: '주인공은 선명하게, 배경만 속도감 있게 흘러간다 (영역은 주인공을 선택)',
    category: '움직임',
    layers: [
      { type: 'motionblur', name: '배경 블러', invert: true, params: { distance: 60, angle: 0, strength: 1, oneSided: false }, feather: 6 },
      { type: 'speedlines', name: '배경 속도선', invert: true, params: { angle: 0, lineCount: 110, lineLength: 340, color: '#ffffff', strength: 0.8, avoidObject: false } },
    ],
  },
  {
    id: 'dash',
    label: '돌진',
    desc: '앞으로 달려드는 장면. 줌 블러 + 방사 집중선',
    category: '움직임',
    layers: [
      { type: 'zoomblur', name: '줌 블러', params: { amount: 0.5, innerRadius: 0.32, strength: 1 } },
      { type: 'focuslines', name: '집중선', params: { lineStyle: 'thick-thin', color: '#ffffff', lineCount: 80, strength: 0.85, innerRadius: 0.5 } },
    ],
  },
  {
    id: 'impact',
    label: '충격!',
    desc: '번쩍 하는 충격 컷. 검은 폭발 집중선 + 줌 블러',
    category: '충격',
    layers: [
      { type: 'zoomblur', name: '줌 블러', params: { amount: 0.3, innerRadius: 0.4, strength: 0.9 } },
      { type: 'focuslines', name: '폭발 집중선', params: { lineStyle: 'burst', color: '#000000', lineCount: 54, innerRadius: 0.42, strength: 1 } },
    ],
  },
  {
    id: 'surprise',
    label: '깜짝 놀람',
    desc: '얼굴이 굳는 순간. 가는 집중선 + 색수차 + 살짝 줌',
    category: '충격',
    layers: [
      { type: 'focuslines', name: '가는 집중선', params: { lineStyle: 'taper', color: '#000000', lineCount: 140, lineWidth: 3, innerRadius: 0.5, strength: 0.95 } },
      { type: 'chroma', name: '색수차', params: { distance: 5, angle: 20, strength: 1 } },
      { type: 'zoomblur', name: '약한 줌', params: { amount: 0.18, innerRadius: 0.5, strength: 0.8 } },
    ],
  },
  {
    id: 'flash',
    label: '번쩍 섬광',
    desc: '밝게 터지는 빛. 빛 번짐 + 흰 폭발선 + 반짝임',
    category: '충격',
    layers: [
      { type: 'glow', name: '섬광', params: { threshold: 120, blur: 40, strength: 1 } },
      { type: 'focuslines', name: '흰 폭발선', params: { lineStyle: 'burst', color: '#ffffff', lineCount: 48, innerRadius: 0.35, strength: 0.9 } },
      { type: 'sparkle', name: '반짝임', params: { count: 6, lineLength: 110, threshold: 170 } },
    ],
  },
  {
    id: 'dreamy',
    label: '몽환 글로우',
    desc: '부드럽게 번지는 꿈 같은 빛. 글로우 + 약한 블러 + 반짝임',
    category: '분위기',
    layers: [
      { type: 'glow', name: '글로우', params: { threshold: 140, blur: 30, strength: 0.85 } },
      { type: 'blur', name: '부드러움', params: { blur: 3, strength: 0.4 } },
      { type: 'sparkle', name: '반짝임', params: { count: 10, lineLength: 70, threshold: 190, seed: 5 } },
    ],
  },
  {
    id: 'horror',
    label: '공포 어둠',
    desc: '으스스한 장면. 푸른 음영 + 채도 낮춤 + 노이즈',
    category: '분위기',
    layers: [
      { type: 'shade', name: '어두운 음영', params: { angle: 90, amount: 0.95, color: '#141a3a', strength: 0.85 } },
      { type: 'color', name: '채도 낮춤', params: { saturation: 0.45, contrast: 1.2, brightness: -8, strength: 1 } },
      { type: 'grain', name: '노이즈', params: { amount: 0.3, dot: 3, strength: 0.9 } },
    ],
  },
  {
    id: 'heat',
    label: '열기·아지랑이',
    desc: '뜨거운 공기가 일렁이는 느낌. 파동 왜곡 + 약한 글로우',
    category: '분위기',
    layers: [
      { type: 'wave', name: '파동', params: { angle: 90, distance: 5, period: 38, strength: 1 } },
      { type: 'glow', name: '열기 빛', params: { threshold: 170, blur: 20, strength: 0.4 } },
    ],
  },
  {
    id: 'sticker',
    label: '스티커 외곽선',
    desc: '물체를 흰 윤곽선과 그림자로 도드라지게',
    category: '분위기',
    layers: [
      { type: 'outline', name: '흰 윤곽선', params: { lineWidth: 6, color: '#ffffff', strength: 1 } },
      { type: 'shadow', name: '그림자', params: { distance: 14, angle: 55, blur: 12, strength: 0.5 } },
    ],
  },
  {
    id: 'neon',
    label: '네온 윤곽',
    desc: '반짝이는 네온 테두리',
    category: '분위기',
    layers: [{ type: 'outline', name: '네온', params: { lineWidth: 3, blur: 28, color: '#59d8ff', strength: 1 } }],
  },
  {
    id: 'tone',
    label: '만화 망점 톤',
    desc: '선택 영역을 스크린톤 망점으로',
    category: '만화 톤',
    layers: [{ type: 'halftone', name: '망점', params: { dot: 6, dotAngle: 45, color: '#000000', strength: 1 } }],
  },
  {
    id: 'ink',
    label: '흑백 잉크',
    desc: '흑백으로 바꾸고 색 단계를 줄여 잉크 느낌으로',
    category: '만화 톤',
    layers: [
      { type: 'color', name: '흑백', params: { mode: 'gray', contrast: 1.25, strength: 1 } },
      { type: 'poster', name: '단계 줄이기', params: { levels: 3, strength: 1 } },
    ],
  },
  {
    id: 'glitch',
    label: '글리치',
    desc: '화면이 깨지는 디지털 오류',
    category: '만화 톤',
    layers: [
      { type: 'glitch', name: '줄 어긋남', params: { count: 10, distance: 46, strength: 1 } },
      { type: 'chroma', name: '색수차', params: { distance: 7, strength: 1 } },
    ],
  },
  {
    id: 'film',
    label: '필름 질감',
    desc: '낡은 필름처럼 입자와 약한 음영',
    category: '만화 톤',
    layers: [
      { type: 'grain', name: '필름 그레인', params: { amount: 0.4, dot: 3, strength: 1 } },
      { type: 'shade', name: '가장자리 음영', params: { angle: 90, amount: 0.6, color: '#3a2a20', strength: 0.4 } },
    ],
  },
];

export const PRESET_CATEGORIES = ['움직임', '충격', '분위기', '만화 톤'] as const;

/** 프리셋/효과를 선택 영역(mask)과 함께 레이어로 만든다. 같은 그룹이라 영역 편집이 함께 적용된다. */
export function buildPreset(preset: Preset, mask: MaskDef): Effect[] {
  const group = preset.layers.length > 1 ? uid() : undefined;
  return preset.layers.map((l) => {
    const e = createEffect(l.type);
    return {
      ...e,
      name: l.name ?? e.name,
      group,
      opacity: l.opacity ?? 1,
      mask: { ops: mask.ops, feather: l.feather ?? mask.feather, invert: l.invert ? !mask.invert : mask.invert },
      params: { ...e.params, ...l.params },
    };
  });
}
