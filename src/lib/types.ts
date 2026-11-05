/** 모든 컷은 가로 900px 기준 좌표계를 사용한다. */
export const PAGE_WIDTH = 900;

export type MaskMode = 'add' | 'sub';

/** 마스크는 벡터 연산 목록으로 저장 → 비파괴, 저장/불러오기 가능 */
export type MaskOp =
  | { kind: 'poly'; mode: MaskMode; points: number[] }
  | { kind: 'stroke'; mode: MaskMode; points: number[]; radius: number }
  | { kind: 'rect'; mode: MaskMode; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; mode: MaskMode; x: number; y: number; w: number; h: number }
  /** 마술봉 등으로 만든 픽셀 영역. runs = [y, x, 길이] 3개씩 */
  | { kind: 'region'; mode: MaskMode; w: number; h: number; runs: number[] };

export interface MaskDef {
  ops: MaskOp[];
  /** 경계 부드러움(px) */
  feather: number;
  /** 선택 영역 반전 (배경만 효과 적용 등) */
  invert?: boolean;
}

export type EffectType =
  | 'shake'
  | 'afterimage'
  | 'motionblur'
  | 'blur'
  | 'speedlines'
  | 'focuslines'
  | 'halftone'
  | 'glow'
  | 'color'
  | 'zoomblur'
  | 'chroma'
  | 'glitch'
  | 'wave'
  | 'shade'
  | 'outline'
  | 'shadow'
  | 'grain'
  | 'poster'
  | 'sparkle'
  | 'swoosh'
  | 'material';

export interface EffectParams {
  /** 방향(도). 0 = 오른쪽, 90 = 아래 */
  angle: number;
  /** 이동/흐림 거리(px) */
  distance: number;
  /** 잔상/복제 개수 */
  count: number;
  /** 효과 강도/불투명도 0..1 */
  strength: number;
  /** 잔상 회전(도) */
  rotation: number;
  /** 흔들림 방식: line=방향선, random=진동 */
  style: 'line' | 'random';
  /** 모션블러 한쪽 방향 꼬리 */
  oneSided: boolean;
  /** 모션블러에서 선명한 원본을 남기는 비율 0..1 */
  sharp: number;
  /** 블러 반경(px) */
  blur: number;
  lineCount: number;
  lineLength: number;
  lineWidth: number;
  /** 속도선이 대상 주변으로 퍼지는 범위 */
  spread: number;
  color: string;
  seed: number;
  /** 속도선: 선택한 물체 위에는 선을 그리지 않고 주변에만 그린다 */
  avoidObject: boolean;
  /** 집중선 중심 빈 공간 비율 0..1 */
  innerRadius: number;
  dot: number;
  dotAngle: number;
  threshold: number;
  mode: 'none' | 'gray' | 'sepia' | 'invert';
  saturation: number;
  contrast: number;
  brightness: number;
  hue: number;
  /** 0..1 효과량(줌 블러·파동·노이즈 등) */
  amount: number;
  /** 파동 길이(px) */
  period: number;
  /** 포스터화 단계 */
  levels: number;
  /** 잔상 색 입히기 0..1 */
  tint: number;
  tintColor: string;
  /** 잔상/복제본 흐림(px) */
  soft: number;
  /** 잔상이 뒤로 갈수록 옅어지는 정도 0..1 */
  falloff: number;
  /** 흑백 노이즈 */
  mono: boolean;
  /** 집중선/속도선 스타일 */
  lineStyle: 'taper' | 'thick-thin' | 'burst';
  /** true 면 centerX/centerY 를 효과 중심으로 사용 */
  useCenter: boolean;
  centerX: number;
  centerY: number;
  /** 소재 효과: 사용할 소재 id, 해석 방식, 배치, 크기(%), 합성 */
  materialId: string;
  matMode: 'color' | 'ink' | 'light';
  matFit: 'stamp' | 'tile' | 'cover';
  matScale: number;
  matBlend: BlendMode;
  matFlip: boolean;
  /** 망점: 모양, 농도 기준, 평면 농도 */
  tone: 'dot' | 'line' | 'cross' | 'stipple';
  toneSource: 'image' | 'flat' | 'gradient';
  density: number;
}

export interface Effect {
  id: string;
  type: EffectType;
  name: string;
  visible: boolean;
  /** 레이어 전체 불투명도 0..1 (기본 1) */
  opacity?: number;
  /** 같은 그룹의 레이어는 영역(마스크) 편집이 함께 적용된다 */
  group?: string;
  mask: MaskDef;
  params: EffectParams;
}

export interface Cut {
  id: string;
  /** PAGE_WIDTH 로 리사이즈된 이미지 dataURL */
  src: string;
  height: number;
  effects: Effect[];
  /** 이미지가 투명할 때 뒤에 깔리는 색 */
  bg?: string;
  /** 컷 좌우 여백(px): 배경이 보인다 */
  inset?: number;
  /** 모서리 둥글기(px) */
  radius?: number;
  /** 컷 테두리 굵기(px)/색 */
  border?: number;
  borderColor?: string;
  /** 이 컷 위쪽 간격(px). 없으면 프로젝트 기본 간격(gap)을 쓴다. 첫 컷에는 적용되지 않는다 */
  gapBefore?: number;
  /** 사선 컷: 위/아래 가장자리 기울기(px). + 면 오른쪽이 아래로 내려간다 */
  slantTop?: number;
  slantBottom?: number;
  /** 테두리 모양: 실선 / 두 줄 / 거친 붓선 */
  borderStyle?: 'solid' | 'double' | 'rough';
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'add';
export type PageLayerKind = 'color' | 'gradient' | 'pattern' | 'image' | 'shape';

/** 컷 뒤(back) 또는 앞(front)에 놓이는 페이지 배경/장식 레이어 */
export interface PageLayer {
  id: string;
  kind: PageLayerKind;
  name: string;
  visible: boolean;
  z: 'back' | 'front';
  /** color/gradient/pattern 에서 true 면 페이지 전체를 덮는다 */
  full: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  blend: BlendMode;
  color: string;
  color2: string;
  angle: number;
  pattern: 'dots' | 'stripes' | 'grid' | 'speed' | 'focus' | 'checker';
  scale: number;
  src: string;
  imgW: number;
  imgH: number;
  fit: 'cover' | 'contain' | 'stretch';
  flip: boolean;
  shape: 'rect' | 'ellipse' | 'triangle' | 'star' | 'burst';
  radius: number;
  stroke: string;
  strokeWidth: number;
  seed: number;
}

export type BubbleKind =
  | 'speech'
  | 'thought'
  | 'shout'
  | 'shock'
  | 'soft'
  | 'horror'
  | 'whisper'
  | 'narration'
  | 'box'
  | 'phone'
  | 'wobble'
  | 'mono'
  | 'flash'
  | 'sfx';

/** 글자 의성어(효과음) 스타일. kind === 'sfx' 일 때 쓴다 */
export interface SfxStyle {
  /** 그라데이션 아래쪽 색 (위쪽은 textColor) */
  fill2: string;
  gradient: boolean;
  /** 바깥 테두리 (안쪽 테두리는 stroke / strokeWidth) */
  stroke2: string;
  stroke2Width: number;
  /** 회전(도) · 기울임(도) */
  rotation: number;
  skew: number;
  /** 글자마다 들쭉날쭉 0..1 */
  jitter: number;
  /** 자간 -0.3..1 */
  spacing: number;
  /** 휘어짐 -1..1 (위로 볼록 +) */
  arc: number;
  /** 입체(두께) px · 색 · 방향(도) */
  extrude: number;
  extrudeColor: string;
  extrudeAngle: number;
  /** 잔상 개수 0..6 · 방향(도) */
  motion: number;
  motionAngle: number;
  /** 글자 크기 점점 커지기(+)/작아지기(-) -1..1 */
  grow: number;
}

export interface Bubble {
  id: string;
  kind: BubbleKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  textColor: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  tail: boolean;
  tailX: number;
  tailY: number;
  tailWidth: number;
  /** -1..1 꼬리 휘어짐 */
  tailCurve: number;
  seed: number;
  /** 글꼴 id (lib/fonts). 없으면 기본 고딕 */
  font?: string;
  /** 세로쓰기 */
  vertical?: boolean;
  /** 굵게 (없으면 말풍선 종류 기본값) */
  bold?: boolean;
  /** 글자 정렬 */
  align?: 'center' | 'left';
  /** 꼬리 두 개(두 사람이 함께 말할 때). 두 번째 꼬리 끝 */
  tail2?: { x: number; y: number } | null;
  /** 의성어 스타일 (kind === 'sfx') */
  sfx?: SfxStyle;
}

/** 가져온 소재(PNG/JPG/SVG 등). 톤·효과선·질감·스탬프 용도 */
export interface Material {
  id: string;
  name: string;
  /** PNG dataURL (알파 유지) */
  src: string;
  w: number;
  h: number;
  /** 가져올 때 추정한 성격: 투명 스탬프 / 흰 바탕 먹색 톤 / 검은 바탕 빛 */
  hint: 'alpha' | 'ink' | 'light' | 'color';
  /** 앱에 처음부터 들어 있는 소재(public/materials). src 는 파일 주소이며 컷에 쓸 때 dataURL 로 바꿔 .wtoon 에 담는다 */
  builtin?: boolean;
  /** 목록용 작은 그림 주소(내장 소재) */
  thumb?: string;
}

export interface Project {
  version: 1;
  gap: number;
  /** 첫 컷 위·마지막 컷 아래 여백 */
  padTop: number;
  padBottom: number;
  /** 페이지 바탕색 */
  bg: string;
  cuts: Cut[];
  layers: PageLayer[];
  bubbles: Bubble[];
  /** 이 프로젝트에서 쓰는 소재(.wtoon 에 함께 저장) */
  materials?: Material[];
}

export const uid = () => Math.random().toString(36).slice(2, 9);

export const emptyProject = (): Project => ({ version: 1, gap: 40, padTop: 0, padBottom: 0, bg: '#ffffff', cuts: [], layers: [], bubbles: [] });
