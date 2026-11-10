'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Bubble, BubbleKind, Cut, EffectParams, EffectType, MaskDef, Material, PageLayer, PageLayerKind, Project } from '@/lib/types';
import { EFFECT_GROUPS, EFFECT_META } from '@/lib/effectMeta';
import { PRESETS, PRESET_CATEGORIES, type Preset } from '@/lib/presets';
import { BLEND_LABELS, KIND_LABELS, PATTERN_LABELS, SHAPE_LABELS } from '@/lib/pagelayers';
import { BUBBLE_KINDS, BUBBLE_LABELS, bubbleBounds, bubbleMarkup, defaultBubble } from '@/lib/bubble';
import { FontSelect } from './SfxPanel';
import { DRAG_BUBBLE, DRAG_MAT, endPanelDrag, startPanelDrag } from '@/lib/dragkinds';

/* ------------------------------ 공용 입력 ------------------------------ */

export function Slider(props: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const { label, value, min, max, step, onChange } = props;
  return (
    <label className="field">
      <span className="fieldLabel">
        {label}
        <b>{Number.isInteger(step) ? Math.round(value) : value.toFixed(2)}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  );
}

export function Check(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
      {props.label}
    </label>
  );
}

export function ColorField(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field row">
      <span className="fieldLabel">{props.label}</span>
      <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

export function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

/* ------------------------------ 효과 패널 ------------------------------ */

export interface EffectPanelProps {
  cut: Cut | null;
  selEffectId: string | null;
  /** 지금 편집 중인 영역: 선택한 효과 레이어의 마스크 또는 임시 선택 */
  activeMask: MaskDef | null;
  maskTarget: 'effect' | 'pending' | 'none';
  onAdd: (type: EffectType) => void;
  onPreset: (preset: Preset) => void;
  onSelect: (id: string) => void;
  onParam: (effectId: string, key: keyof EffectParams, value: EffectParams[keyof EffectParams]) => void;
  onOpacity: (effectId: string, v: number) => void;
  onToggle: (effectId: string) => void;
  onDelete: (effectId: string) => void;
  onDuplicate: (effectId: string) => void;
  onMove: (effectId: string, dir: -1 | 1) => void;
  onRename: (effectId: string, name: string) => void;
  onFeather: (v: number) => void;
  onInvert: (v: boolean) => void;
  onGrow: (n: number) => void;
  onFullMask: () => void;
  onUndoOp: () => void;
  onClearMask: () => void;
  onResetCenter: (effectId: string) => void;
  /** 효과 복사/붙여넣기: 복사해 둔 효과가 있으면 개수와 이름이 들어온다 */
  fxClip: { count: number; names: string } | null;
  onCopy: (effectId: string) => void;
  onPaste: () => void;
  onClearClip: () => void;
  /** 소재 선택 목록(라이브러리 + 이 프로젝트의 소재) */
  materials: Material[];
  onOpenMaterials: () => void;
  /** 영역 고르는 도구(패널에서 바로 고를 수 있게) */
  tool: string;
  onTool: (t: 'select' | 'wand' | 'lasso' | 'brush' | 'rect' | 'ellipse') => void;
}

const REGION_TOOLS = [
  { id: 'wand', icon: '✦', label: '마술봉', tip: '클릭 한 번으로 선에 둘러싸인 부분 선택 (W)' },
  { id: 'lasso', icon: '➰', label: '올가미', tip: '윤곽을 따라 그려서 선택 (L)' },
  { id: 'brush', icon: '🖌', label: '브러시', tip: '칠해서 선택 (B)' },
  { id: 'rect', icon: '▭', label: '사각', tip: '사각형으로 선택 (M)' },
  { id: 'ellipse', icon: '◯', label: '타원', tip: '타원으로 선택 (E)' },
] as const;

export function EffectPanel(p: EffectPanelProps) {
  const [cat, setCat] = useState<(typeof PRESET_CATEGORIES)[number]>('움직임');
  const [mode, setMode] = useState<'preset' | 'single'>('preset');
  const [group, setGroup] = useState(EFFECT_GROUPS[0].title);
  const [growPx, setGrowPx] = useState(3);
  const effects = p.cut ? [...p.cut.effects].reverse() : [];
  const sel = p.cut?.effects.find((e) => e.id === p.selEffectId) ?? null;
  const m = p.activeMask;
  const opCount = m?.ops.length ?? 0;
  return (
    <div>
      <Section title="① 어디에 줄까요?">
        {!p.cut && <p className="hint warn">먼저 컷을 추가하거나 ⋯ 메뉴의 샘플 장면을 불러오세요.</p>}
        {p.cut && (
          <>
            <div className="regionTools">
              {REGION_TOOLS.map((t) => (
                <button key={t.id} className={`regionTool ${p.tool === t.id ? 'on' : ''}`} title={t.tip} onClick={() => p.onTool(p.tool === t.id ? 'select' : t.id)}>
                  <span>{t.icon}</span>
                  {t.label}
                </button>
              ))}
              <button className="regionTool" title="컷 전체를 영역으로" onClick={p.onFullMask}>
                <span>▦</span>
                컷 전체
              </button>
            </div>
            <p className={`hint ${opCount ? 'ok' : ''}`}>
              {opCount
                ? `✓ ${p.maskTarget === 'effect' ? '선택한 효과의 영역' : '고른 영역'} · 조각 ${opCount}개 — 아래에서 효과를 고르세요`
                : '영역을 안 고르면 효과가 컷 전체에 들어가요. 나중에 영역을 고르면 그 부분으로 바뀌어요.'}
            </p>
            {opCount > 0 && (
              <details className="note">
                <summary>영역 다듬기 (부드럽게 · 반전 · 넓히기)</summary>
                <Slider label="경계 부드러움(px)" value={m?.feather ?? 3} min={0} max={40} step={1} onChange={p.onFeather} />
                <Check label="영역 반전 (고른 곳 말고 나머지에 적용)" value={!!m?.invert} onChange={p.onInvert} />
                <div className="grid3">
                  <button className="btn" onClick={() => p.onGrow(-growPx)}>축소 −</button>
                  <button className="btn" onClick={() => p.onGrow(growPx)}>확대 ＋</button>
                  <input className="text" type="number" min={1} max={40} value={growPx} onChange={(e) => setGrowPx(Math.max(1, Math.min(40, parseInt(e.target.value, 10) || 1)))} title="확대/축소 px" />
                </div>
                <div className="grid2 gapTop">
                  <button className="btn" onClick={p.onUndoOp}>마지막 조각 취소</button>
                  <button className="btn" onClick={p.onClearMask}>영역 지우기</button>
                </div>
              </details>
            )}
          </>
        )}
      </Section>

      <Section title="② 효과 고르기">
        <div className="seg segWide">
          <button className={mode === 'preset' ? 'on' : ''} onClick={() => setMode('preset')}>원클릭 프리셋</button>
          <button className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>효과 하나씩</button>
        </div>
        {mode === 'preset' ? (
          <>
            <div className="chips">
              {PRESET_CATEGORIES.map((c) => (
                <button key={c} className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
              ))}
            </div>
            <div className="presetGrid">
              {PRESETS.filter((x) => x.category === cat).map((x) => (
                <button key={x.id} className="presetCard" disabled={!p.cut} onClick={() => p.onPreset(x)} title={x.desc}>
                  <b>{x.label}</b>
                  <span>{x.desc}</span>
                  <i>{x.layers.length}겹</i>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="chips">
              {EFFECT_GROUPS.map((g) => (
                <button key={g.title} className={`chip ${group === g.title ? 'on' : ''}`} onClick={() => setGroup(g.title)}>{g.title}</button>
              ))}
            </div>
            <div className="effList">
              {(EFFECT_GROUPS.find((g) => g.title === group) ?? EFFECT_GROUPS[0]).types.map((t) => (
                <button key={t} className="effItem" disabled={!p.cut} onClick={() => p.onAdd(t)}>
                  <b>+ {EFFECT_META[t].label}</b>
                  <span>{EFFECT_META[t].desc}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Section>

      <Section title={`③ 넣은 효과 (${effects.length}) · 위가 맨 나중에 적용`}>
        {p.fxClip && (
          <div className="clipBar" role="status" data-testid="fx-clip">
            <span>복사한 효과 {p.fxClip.count}개 · {p.fxClip.names}</span>
            <button className="btn primary" disabled={!p.cut} onClick={p.onPaste} title="지금 선택한 컷에 붙여넣기 (Ctrl+V)">이 컷에 붙여넣기</button>
            <button className="btn" onClick={p.onClearClip}>지우기</button>
          </div>
        )}
        {effects.length === 0 && <p className="hint">아직 효과 레이어가 없어요.</p>}
        {effects.map((e) => (
          <div key={e.id} className={`layerRow ${e.id === p.selEffectId ? 'layerSel' : ''}`} onClick={() => p.onSelect(e.id)}>
            <button className="iconBtn" title={e.visible ? '숨기기' : '보이기'} onClick={(ev) => { ev.stopPropagation(); p.onToggle(e.id); }}>
              {e.visible ? '👁' : '—'}
            </button>
            <span className="layerName">{e.name}</span>
            {e.group && <span className="layerType" title="같은 프리셋의 레이어는 영역이 함께 편집돼요">묶음</span>}
            <span className="layerType">{EFFECT_META[e.type].label}</span>
            <button className="iconBtn" title="위로" onClick={(ev) => { ev.stopPropagation(); p.onMove(e.id, 1); }}>↑</button>
            <button className="iconBtn" title="아래로" onClick={(ev) => { ev.stopPropagation(); p.onMove(e.id, -1); }}>↓</button>
            <button className="iconBtn" title="복제 (Ctrl+D)" onClick={(ev) => { ev.stopPropagation(); p.onDuplicate(e.id); }}>⧉</button>
            <button className="iconBtn" title="복사 — 다른 컷을 고르고 붙여넣기 (Ctrl+C)" aria-label="효과 복사" onClick={(ev) => { ev.stopPropagation(); p.onCopy(e.id); }}>⎘</button>
            <button className="iconBtn danger" title="삭제" onClick={(ev) => { ev.stopPropagation(); p.onDelete(e.id); }}>✕</button>
          </div>
        ))}
      </Section>

      {sel && p.cut && (
        <Section title={`④ ${EFFECT_META[sel.type].label} 세부 조절`}>
          <p className="hint">{EFFECT_META[sel.type].desc}</p>
          {EFFECT_META[sel.type].handle && (
            <p className="hint tip">
              {EFFECT_META[sel.type].handle!.kind === 'dir' ? '화면의 파란 화살표 끝을 끌면 방향과 거리가 바로 바뀌어요.' : '화면의 십자 표시를 끌어 효과 중심을 옮기세요.'}
              {EFFECT_META[sel.type].handle!.kind === 'center' && sel.params.useCenter && (
                <button className="linkBtn" onClick={() => p.onResetCenter(sel.id)}>중심을 영역 중앙으로</button>
              )}
            </p>
          )}
          <label className="field">
            <span className="fieldLabel">레이어 이름</span>
            <input className="text" value={sel.name} onChange={(e) => p.onRename(sel.id, e.target.value)} />
          </label>
          <Slider label="레이어 불투명도" value={sel.opacity ?? 1} min={0} max={1} step={0.01} onChange={(v) => p.onOpacity(sel.id, v)} />
          {EFFECT_META[sel.type].controls.map((c) => {
            const v = sel.params[c.key];
            if (c.t === 'range') return <Slider key={c.key} label={c.label} value={v as number} min={c.min} max={c.max} step={c.step} onChange={(n) => p.onParam(sel.id, c.key, n)} />;
            if (c.t === 'color') return <ColorField key={c.key} label={c.label} value={v as string} onChange={(s) => p.onParam(sel.id, c.key, s)} />;
            if (c.t === 'toggle') return <Check key={c.key} label={c.label} value={v as boolean} onChange={(b) => p.onParam(sel.id, c.key, b)} />;
            if (c.t === 'material')
              return (
                <label key={c.key} className="field">
                  <span className="fieldLabel">{c.label}</span>
                  <select className="text" value={v as string} onChange={(e) => p.onParam(sel.id, c.key, e.target.value)}>
                    <option value="">(소재를 고르세요)</option>
                    {p.materials.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  {p.materials.length === 0 && (
                    <button className="linkBtn" onClick={p.onOpenMaterials}>소재 탭에서 가져오기</button>
                  )}
                </label>
              );
            return (
              <label key={c.key} className="field">
                <span className="fieldLabel">{c.label}</span>
                <select className="text" value={v as string} onChange={(e) => p.onParam(sel.id, c.key, e.target.value)}>
                  {c.options.map(([val, name]) => (
                    <option key={val} value={val}>{name}</option>
                  ))}
                </select>
              </label>
            );
          })}
        </Section>
      )}
    </div>
  );
}

/* ------------------------------ 말풍선 패널 ------------------------------ */

function KindThumb({ kind }: { kind: BubbleKind }) {
  const b = defaultBubble(kind, 0, 0);
  const bb = bubbleBounds({ ...b, text: BUBBLE_LABELS[kind], fontSize: 24 });
  return (
    <svg viewBox={`${bb.x} ${bb.y} ${bb.w} ${bb.h}`} width="100%" height="64" dangerouslySetInnerHTML={{ __html: bubbleMarkup({ ...b, id: 'th' + kind, text: BUBBLE_LABELS[kind], fontSize: 24 }) }} />
  );
}

export interface BubblePanelProps {
  bubble: Bubble | null;
  onAdd: (kind: BubbleKind) => void;
  onChange: (patch: Partial<Bubble>, coalesce?: boolean) => void;
  onFit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onZ: (dir: -1 | 1) => void;
  /** 값이 바뀔 때마다 글자 입력칸에 포커스를 준다(말풍선을 더블클릭했을 때) */
  focusTick: number;
}

export function BubblePanel(p: BubblePanelProps) {
  const b = p.bubble;
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (p.focusTick > 0 && textRef.current) {
      textRef.current.focus();
      textRef.current.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusTick]);
  return (
    <div>
      <Section title="말풍선 추가">
        <div className="kindGrid">
          {BUBBLE_KINDS.map((k) => (
            <button
              key={k}
              className="kindBtn"
              onClick={() => p.onAdd(k)}
              draggable
              onDragStart={(e) => startPanelDrag(e.nativeEvent, DRAG_BUBBLE, k, `${BUBBLE_LABELS[k]} 말풍선`, e.currentTarget.querySelector('svg'))}
              onDragEnd={endPanelDrag}
              title={`${BUBBLE_LABELS[k]} 말풍선 추가 · 화면으로 끌어다 놓으면 그 자리에 들어가요`}
            >
              <KindThumb kind={k} />
              <span>{BUBBLE_LABELS[k]}</span>
            </button>
          ))}
        </div>
      </Section>
      {!b && <p className="hint pad">말풍선을 추가하거나, 화면에서 말풍선을 클릭해 선택하세요. 드래그로 이동, 모서리로 크기, 빨간 점으로 꼬리 방향을 바꿀 수 있어요.</p>}
      {b && (
        <>
          <Section title="내용">
            <textarea ref={textRef} className="text area" value={b.text} onChange={(e) => p.onChange({ text: e.target.value }, true)} rows={3} />
            <div className="grid2">
              <button className="btn" onClick={p.onFit}>글자에 맞춰 크기 조정</button>
              <select className="text" value={b.kind} onChange={(e) => p.onChange({ kind: e.target.value as BubbleKind })}>
                {BUBBLE_KINDS.map((k) => (
                  <option key={k} value={k}>{BUBBLE_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <Slider label="글자 크기" value={b.fontSize} min={12} max={80} step={1} onChange={(v) => p.onChange({ fontSize: v }, true)} />
            <ColorField label="글자 색" value={b.textColor} onChange={(v) => p.onChange({ textColor: v }, true)} />
            <FontSelect value={b.font} sample={b.text.split('\n')[0] || '안녕!'} onChange={(id) => p.onChange({ font: id })} />
            <div className="grid2">
              <Check label="굵게" value={b.bold ?? (b.kind === 'shout' || b.kind === 'shock' || b.kind === 'flash')} onChange={(v) => p.onChange({ bold: v })} />
              <Check label="세로쓰기" value={!!b.vertical} onChange={(v) => p.onChange({ vertical: v })} />
            </div>
            {!b.vertical && (
              <div className="seg segWide">
                <button className={b.align !== 'left' ? 'on' : ''} onClick={() => p.onChange({ align: 'center' })}>가운데 정렬</button>
                <button className={b.align === 'left' ? 'on' : ''} onClick={() => p.onChange({ align: 'left' })}>왼쪽 정렬</button>
              </div>
            )}
          </Section>
          <Section title="모양·색 (본체와 꼬리 동일 적용)">
            <ColorField label="배경색" value={b.fill} onChange={(v) => p.onChange({ fill: v }, true)} />
            <ColorField label="테두리색" value={b.stroke} onChange={(v) => p.onChange({ stroke: v }, true)} />
            <Slider label="테두리 굵기 (0 = 없음)" value={b.strokeWidth} min={0} max={8} step={0.1} onChange={(v) => p.onChange({ strokeWidth: v }, true)} />
            <Slider label="배경 투명도" value={b.opacity} min={0.1} max={1} step={0.01} onChange={(v) => p.onChange({ opacity: v }, true)} />
          </Section>
          <Section title="꼬리">
            <Check label="꼬리 사용" value={b.tail} onChange={(v) => p.onChange({ tail: v })} />
            {b.tail && (
              <>
                <Check
                  label="꼬리 두 개 (둘이 같이 말할 때)"
                  value={!!b.tail2}
                  onChange={(v) => p.onChange({ tail2: v ? { x: b.x + b.w - (b.tailX - b.x), y: b.tailY } : null })}
                />
                {b.tail2 && <p className="hint">화면의 주황 점으로 두 번째 꼬리를 옮겨요.</p>}
                <Slider label="꼬리 폭" value={b.tailWidth} min={10} max={90} step={1} onChange={(v) => p.onChange({ tailWidth: v }, true)} />
                <Slider label="꼬리 휘어짐" value={b.tailCurve} min={-1} max={1} step={0.01} onChange={(v) => p.onChange({ tailCurve: v }, true)} />
              </>
            )}
            {(['shout', 'shock', 'horror', 'phone', 'wobble', 'flash'] as BubbleKind[]).includes(b.kind) && <Slider label="모양 변화(시드)" value={b.seed} min={1} max={99} step={1} onChange={(v) => p.onChange({ seed: v }, true)} />}
          </Section>
          <div className="grid3 pad">
            <button className="btn" onClick={() => p.onZ(1)}>앞으로</button>
            <button className="btn" onClick={() => p.onZ(-1)}>뒤로</button>
            <button className="btn" onClick={p.onDuplicate}>복제</button>
          </div>
          <div className="pad">
            <button className="btn danger wide" onClick={p.onDelete}>말풍선 삭제</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------ 컷 패널 ------------------------------ */

export interface CutPanelProps {
  project: Project;
  selCutId: string | null;
  onSelect: (id: string) => void;
  /** id 컷을 to 번째(맨 위 = 0)로 옮긴다 */
  onReorder: (id: string, to: number) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onGap: (v: number) => void;
  onCut: (id: string, patch: Partial<Cut>, coalesce?: boolean) => void;
  /** 이 컷 위 간격을 컷마다 따로 정한다(null 이면 기본 간격으로 되돌림) */
  onGapBefore: (id: string, v: number | null) => void;
  /** 모든 컷의 개별 간격을 지우고 기본 간격으로 되돌린다 */
  onResetGaps: () => void;
  /** 복사해 둔 효과가 있는가 / 이 컷에 붙여넣기 */
  hasFxClip: boolean;
  onPasteTo: (id: string) => void;
  /** 컷을 위치(px 목록)에서 나눈다 */
  onSplit: (id: string, at: number[]) => void;
  /** 이 컷 아래 사선과 다음 컷 위 사선을 같이 바꾼다 */
  onSlantJoint: (id: string, v: number) => void;
}

const FRAME_PRESETS: { label: string; patch: Partial<Cut> }[] = [
  { label: '없음', patch: { border: 0, inset: 0, radius: 0, borderStyle: 'solid' } },
  { label: '기본 컷선', patch: { border: 4, inset: 40, radius: 0, borderStyle: 'solid', borderColor: '#111111' } },
  { label: '두 줄', patch: { border: 4, inset: 40, radius: 0, borderStyle: 'double', borderColor: '#111111' } },
  { label: '붓선', patch: { border: 5, inset: 40, radius: 0, borderStyle: 'rough', borderColor: '#111111' } },
  { label: '둥근 컷', patch: { border: 3, inset: 40, radius: 28, borderStyle: 'solid', borderColor: '#111111' } },
  { label: '회상 (흰 테)', patch: { border: 10, inset: 60, radius: 6, borderStyle: 'solid', borderColor: '#ffffff' } },
];

function SplitBox({ cut, onSplit }: { cut: Cut; onSplit: (at: number[]) => void }) {
  const [pos, setPos] = useState(50);
  const [n, setN] = useState(2);
  return (
    <div className="splitBox">
      <Slider label={`나눌 위치 (위에서 ${pos}% · ${Math.round((cut.height * pos) / 100)}px)`} value={pos} min={5} max={95} step={1} onChange={setPos} />
      <div className="grid2">
        <button className="btn" onClick={() => onSplit([(cut.height * pos) / 100])}>여기서 둘로 나누기</button>
        <div className="splitN">
          <input className="text" type="number" min={2} max={10} value={n} onChange={(e) => setN(Math.max(2, Math.min(10, parseInt(e.target.value, 10) || 2)))} aria-label="나눌 개수" />
          <button className="btn" onClick={() => onSplit(Array.from({ length: n - 1 }, (_, i) => (cut.height * (i + 1)) / n))}>등분</button>
        </div>
      </div>
      {cut.effects.length > 0 && <p className="hint warn">효과 {cut.effects.length}개는 그림에 합쳐진 채로 나뉘어요 (Ctrl+Z 로 되돌릴 수 있어요).</p>}
    </div>
  );
}

function CutIndexInput({ index, count, onCommit }: { index: number; count: number; onCommit: (to: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() !== '' && Number.isFinite(n)) onCommit(Math.max(0, Math.min(count - 1, Math.round(n))));
  };
  return (
    <input
      className="idxInput"
      type="number"
      min={0}
      max={Math.max(0, count - 1)}
      step={1}
      value={draft ?? String(index)}
      title={`번호를 입력하면 그 자리로 옮겨요 (맨 위 0 ~ 맨 아래 ${count - 1})`}
      aria-label="컷 번호"
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); (e.currentTarget as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { setDraft(null); (e.currentTarget as HTMLInputElement).blur(); }
      }}
    />
  );
}

export function CutPanel(p: CutPanelProps) {
  const sel = p.project.cuts.find((c) => c.id === p.selCutId) ?? null;
  const n = p.project.cuts.length;
  const [dragId, setDragId] = useState<string | null>(null);
  /** 놓을 위치: 0..n (i 번째 행의 위쪽 = i, 아래쪽 = i+1) */
  const [dropPos, setDropPos] = useState<number | null>(null);
  const finishDrop = () => {
    if (dragId !== null && dropPos !== null) {
      const from = p.project.cuts.findIndex((c) => c.id === dragId);
      const to = dropPos > from ? dropPos - 1 : dropPos;
      if (from >= 0 && to !== from) p.onReorder(dragId, to);
    }
    setDragId(null);
    setDropPos(null);
  };
  return (
    <div>
      <Section title="컷 목록">
        {n === 0 && <p className="hint">컷이 없어요. 위의 “컷 추가”로 이미지를 올리세요.</p>}
        {n > 1 && <p className="hint">행을 끌어서 순서를 바꾸거나, 번호를 직접 입력해 그 자리로 옮겨요. 맨 위가 0번, 맨 아래가 {n - 1}번이에요.</p>}
        <div onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropPos(null); }}>
          {p.project.cuts.map((c, i) => (
            <div
              key={c.id}
              className={`layerRow cutRow ${c.id === p.selCutId ? 'layerSel' : ''} ${dragId === c.id ? 'dragging' : ''} ${dropPos === i ? 'dropBefore' : ''} ${dropPos === n && i === n - 1 ? 'dropAfter' : ''}`}
              draggable
              data-cut-row={i}
              onClick={() => p.onSelect(c.id)}
              onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }}
              onDragEnd={() => { setDragId(null); setDropPos(null); }}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                setDropPos(e.clientY < r.top + r.height / 2 ? i : i + 1);
              }}
              onDrop={(e) => { e.preventDefault(); finishDrop(); }}
            >
              <span className="dragHandle" title="끌어서 순서 바꾸기">⠿</span>
              <CutIndexInput index={i} count={n} onCommit={(to) => p.onReorder(c.id, to)} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.src} alt="" className="thumb" draggable={false} />
              <span className="layerName">효과 {c.effects.length}</span>
              {p.hasFxClip && <button className="iconBtn pasteBtn" title="복사한 효과를 이 컷에 붙여넣기" onClick={(e) => { e.stopPropagation(); p.onPasteTo(c.id); }}>붙여넣기</button>}
              <button className="iconBtn" title="한 칸 위로" disabled={i === 0} onClick={(e) => { e.stopPropagation(); p.onReorder(c.id, i - 1); }}>↑</button>
              <button className="iconBtn" title="한 칸 아래로" disabled={i === n - 1} onClick={(e) => { e.stopPropagation(); p.onReorder(c.id, i + 1); }}>↓</button>
              <button className="iconBtn" title="컷 복제 (효과 포함)" onClick={(e) => { e.stopPropagation(); p.onDuplicate(c.id); }}>⧉</button>
              <button className="iconBtn danger" title="컷 삭제 (Ctrl+Z로 되돌리기)" onClick={(e) => { e.stopPropagation(); p.onDelete(c.id); }}>✕</button>
            </div>
          ))}
        </div>
      </Section>
      {sel && (
        <Section title="선택한 컷 모양">
          {(() => {
            const idx = p.project.cuts.findIndex((c) => c.id === sel.id);
            const next = idx >= 0 ? p.project.cuts[idx + 1] : undefined;
            return (
              <>
                <p className="hint">아래 간격은 선택한 컷에만 적용돼요. 다른 컷은 그대로예요.</p>
                {idx > 0 && (
                  <>
                    <Slider label={`이 컷 위 간격(px)${sel.gapBefore === undefined ? ' · 기본값' : ''}`} value={sel.gapBefore ?? p.project.gap} min={0} max={800} step={5} onChange={(v) => p.onGapBefore(sel.id, v)} />
                    {sel.gapBefore !== undefined && <button className="linkBtn" onClick={() => p.onGapBefore(sel.id, null)}>위 간격을 기본값({p.project.gap}px)으로</button>}
                  </>
                )}
                {next && (
                  <>
                    <Slider label={`이 컷 아래 간격(px)${next.gapBefore === undefined ? ' · 기본값' : ''}`} value={next.gapBefore ?? p.project.gap} min={0} max={800} step={5} onChange={(v) => p.onGapBefore(next.id, v)} />
                    {next.gapBefore !== undefined && <button className="linkBtn" onClick={() => p.onGapBefore(next.id, null)}>아래 간격을 기본값({p.project.gap}px)으로</button>}
                  </>
                )}
              </>
            );
          })()}
          <h4 className="subHead">컷 테두리 빠른 설정</h4>
          <div className="chips">
            {FRAME_PRESETS.map((fp) => (
              <button key={fp.label} className="chip" onClick={() => p.onCut(sel.id, fp.patch)}>{fp.label}</button>
            ))}
          </div>
          <Slider label="좌우 여백(px) · 뒤 배경이 보여요" value={sel.inset ?? 0} min={0} max={300} step={2} onChange={(v) => p.onCut(sel.id, { inset: v }, true)} />
          <Slider label="모서리 둥글기(px) · 사선 컷에는 안 먹어요" value={sel.radius ?? 0} min={0} max={120} step={1} onChange={(v) => p.onCut(sel.id, { radius: v }, true)} />
          <Slider label="테두리 굵기(px)" value={sel.border ?? 0} min={0} max={24} step={1} onChange={(v) => p.onCut(sel.id, { border: v }, true)} />
          {(sel.border ?? 0) > 0 && (
            <>
              <ColorField label="테두리 색" value={sel.borderColor ?? '#000000'} onChange={(v) => p.onCut(sel.id, { borderColor: v }, true)} />
              <div className="seg segWide">
                {(['solid', 'double', 'rough'] as const).map((st) => (
                  <button key={st} className={(sel.borderStyle ?? 'solid') === st ? 'on' : ''} onClick={() => p.onCut(sel.id, { borderStyle: st })}>
                    {st === 'solid' ? '실선' : st === 'double' ? '두 줄' : '거친 붓선'}
                  </button>
                ))}
              </div>
            </>
          )}
          <h4 className="subHead">사선 컷</h4>
          <Slider label="위 가장자리 기울기(px) · + 오른쪽이 내려감" value={sel.slantTop ?? 0} min={-300} max={300} step={2} onChange={(v) => p.onCut(sel.id, { slantTop: v }, true)} />
          <Slider label="아래 가장자리 기울기(px)" value={sel.slantBottom ?? 0} min={-300} max={300} step={2} onChange={(v) => p.onCut(sel.id, { slantBottom: v }, true)} />
          {p.project.cuts.findIndex((c) => c.id === sel.id) < p.project.cuts.length - 1 && (
            <button className="linkBtn" onClick={() => p.onSlantJoint(sel.id, sel.slantBottom ?? 0)} title="두 컷 사이 틈이 평행한 사선이 돼요">다음 컷 위쪽도 같은 기울기로 맞추기</button>
          )}
          <h4 className="subHead">컷 나누기</h4>
          <SplitBox cut={sel} onSplit={(at) => p.onSplit(sel.id, at)} />
          <label className="field">
            <span className="fieldLabel">이미지 뒤 바탕</span>
            <select className="text" value={sel.bg === 'transparent' ? 'transparent' : 'color'} onChange={(e) => p.onCut(sel.id, { bg: e.target.value === 'transparent' ? 'transparent' : '#ffffff' })}>
              <option value="color">색으로 채움</option>
              <option value="transparent">투명 (뒤 배경이 비쳐요)</option>
            </select>
          </label>
          {sel.bg !== 'transparent' && <ColorField label="바탕 색" value={sel.bg ?? '#ffffff'} onChange={(v) => p.onCut(sel.id, { bg: v }, true)} />}
        </Section>
      )}
      <Section title="레이아웃">
        <Slider label="컷 사이 기본 간격(px)" value={p.project.gap} min={0} max={800} step={5} onChange={p.onGap} />
        <p className="hint">기본 간격은 따로 간격을 정하지 않은 컷에만 적용돼요. 컷을 선택하면 그 컷의 위·아래 간격을 따로 정할 수 있어요.</p>
        {p.project.cuts.some((c) => c.gapBefore !== undefined) && (
          <button className="linkBtn" onClick={p.onResetGaps}>모든 컷의 개별 간격 지우기</button>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------ 배경 패널 ------------------------------ */

export interface BgPanelProps {
  project: Project;
  selLayerId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (kind: PageLayerKind, patch?: Partial<PageLayer>) => void;
  onUploadImage: () => void;
  onReplaceImage: (id: string) => void;
  onChange: (id: string, patch: Partial<PageLayer>, coalesce?: boolean) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onPage: (patch: Partial<Pick<Project, 'bg' | 'padTop' | 'padBottom' | 'gap'>>, key?: string) => void;
}

const BG_PRESETS: { label: string; kind: PageLayerKind; patch: Partial<PageLayer> }[] = [
  { label: '맑은 하늘', kind: 'gradient', patch: { color: '#7ec8ff', color2: '#e6f6ff', angle: 90, name: '맑은 하늘' } },
  { label: '노을', kind: 'gradient', patch: { color: '#ff9a8b', color2: '#ffd8a8', angle: 90, name: '노을' } },
  { label: '밤하늘', kind: 'gradient', patch: { color: '#14163a', color2: '#4b3f8f', angle: 90, name: '밤하늘' } },
  { label: '집중선 배경', kind: 'pattern', patch: { pattern: 'focus', color: '#000000', color2: '#ffffff', opacity: 0.85, blend: 'normal', scale: 70, name: '집중선 배경' } },
  { label: '속도선 배경', kind: 'pattern', patch: { pattern: 'speed', color: '#000000', color2: '#ffffff', opacity: 0.8, blend: 'normal', angle: 0, scale: 40, name: '속도선 배경' } },
  { label: '망점 톤', kind: 'pattern', patch: { pattern: 'dots', color: '#000000', color2: '#ffffff', opacity: 0.22, blend: 'multiply', scale: 16, name: '망점 톤' } },
];

export function BgPanel(p: BgPanelProps) {
  const layers = [...p.project.layers].reverse();
  const l = p.project.layers.find((x) => x.id === p.selLayerId) ?? null;
  const ch = (patch: Partial<PageLayer>, co = true) => l && p.onChange(l.id, patch, co);
  return (
    <div>
      <Section title="페이지 바탕">
        <ColorField label="바탕색" value={p.project.bg} onChange={(v) => p.onPage({ bg: v }, 'bg')} />
        <Slider label="맨 위 여백(px)" value={p.project.padTop} min={0} max={800} step={10} onChange={(v) => p.onPage({ padTop: v }, 'padTop')} />
        <Slider label="맨 아래 여백(px)" value={p.project.padBottom} min={0} max={800} step={10} onChange={(v) => p.onPage({ padBottom: v }, 'padBottom')} />
        <Slider label="컷 사이 기본 간격(px)" value={p.project.gap} min={0} max={800} step={5} onChange={(v) => p.onPage({ gap: v }, 'gap')} />
        <p className="hint">컷 사이 간격·여백, 컷의 좌우 여백(“컷” 탭), 투명 PNG 컷에서 뒤 레이어가 보여요.</p>
      </Section>

      <Section title="배경·장식 추가">
        <div className="grid2">
          <button className="btn" onClick={() => p.onAdd('color')}>＋ 단색</button>
          <button className="btn" onClick={() => p.onAdd('gradient')}>＋ 그라데이션</button>
          <button className="btn" onClick={() => p.onAdd('pattern')}>＋ 패턴/톤</button>
          <button className="btn" onClick={() => p.onAdd('shape')}>＋ 도형</button>
          <button className="btn primary wide2" onClick={p.onUploadImage}>＋ 그림(이미지) 올리기</button>
        </div>
        <div className="effGroupTitle gapTop">빠른 배경</div>
        <div className="chips wrap">
          {BG_PRESETS.map((b) => (
            <button key={b.label} className="chip" onClick={() => p.onAdd(b.kind, b.patch)}>{b.label}</button>
          ))}
        </div>
      </Section>

      <Section title="레이어 (위가 앞)">
        {layers.length === 0 && <p className="hint">아직 배경 레이어가 없어요. 위에서 추가해 보세요.</p>}
        {layers.map((x) => (
          <div key={x.id} className={`layerRow ${x.id === p.selLayerId ? 'layerSel' : ''}`} onClick={() => p.onSelect(x.id)}>
            <button className="iconBtn" title={x.visible ? '숨기기' : '보이기'} onClick={(e) => { e.stopPropagation(); p.onChange(x.id, { visible: !x.visible }, false); }}>
              {x.visible ? '👁' : '—'}
            </button>
            <span className="layerName">{x.name}</span>
            <span className="layerType">{x.z === 'back' ? '컷 뒤' : '컷 앞'}</span>
            <button className="iconBtn" title="앞으로" onClick={(e) => { e.stopPropagation(); p.onMove(x.id, 1); }}>↑</button>
            <button className="iconBtn" title="뒤로" onClick={(e) => { e.stopPropagation(); p.onMove(x.id, -1); }}>↓</button>
            <button className="iconBtn danger" title="삭제" onClick={(e) => { e.stopPropagation(); p.onDelete(x.id); }}>✕</button>
          </div>
        ))}
      </Section>

      {l && (
        <>
          <Section title={`${KIND_LABELS[l.kind]} 설정`}>
            <label className="field">
              <span className="fieldLabel">이름</span>
              <input className="text" value={l.name} onChange={(e) => ch({ name: e.target.value })} />
            </label>
            <div className="seg segWide">
              <button className={l.z === 'back' ? 'on' : ''} onClick={() => ch({ z: 'back' }, false)}>컷 뒤</button>
              <button className={l.z === 'front' ? 'on' : ''} onClick={() => ch({ z: 'front' }, false)}>컷 앞</button>
            </div>
            <Slider label="불투명도" value={l.opacity} min={0} max={1} step={0.01} onChange={(v) => ch({ opacity: v })} />
            <label className="field">
              <span className="fieldLabel">합성 모드</span>
              <select className="text" value={l.blend} onChange={(e) => ch({ blend: e.target.value as PageLayer['blend'] }, false)}>
                {(Object.keys(BLEND_LABELS) as PageLayer['blend'][]).map((k) => (
                  <option key={k} value={k}>{BLEND_LABELS[k]}</option>
                ))}
              </select>
            </label>

            {(l.kind === 'color' || l.kind === 'gradient' || l.kind === 'pattern' || l.kind === 'shape') && <ColorField label={l.kind === 'pattern' ? '무늬 색' : '색'} value={l.color} onChange={(v) => ch({ color: v })} />}
            {(l.kind === 'gradient' || l.kind === 'pattern') && <ColorField label={l.kind === 'pattern' ? '종이 색(투명도 낮추면 무늬만)' : '색 2'} value={l.color2} onChange={(v) => ch({ color2: v })} />}
            {(l.kind === 'gradient' || (l.kind === 'pattern' && ['stripes', 'speed', 'grid', 'dots'].includes(l.pattern))) && (
              <Slider label="각도(°)" value={l.angle} min={0} max={360} step={1} onChange={(v) => ch({ angle: v })} />
            )}
            {l.kind === 'pattern' && (
              <>
                <label className="field">
                  <span className="fieldLabel">패턴 종류</span>
                  <select className="text" value={l.pattern} onChange={(e) => ch({ pattern: e.target.value as PageLayer['pattern'] }, false)}>
                    {(Object.keys(PATTERN_LABELS) as PageLayer['pattern'][]).map((k) => (
                      <option key={k} value={k}>{PATTERN_LABELS[k]}</option>
                    ))}
                  </select>
                </label>
                <Slider label="크기/간격" value={l.scale} min={4} max={200} step={1} onChange={(v) => ch({ scale: v })} />
                <Slider label="무작위 시드" value={l.seed} min={1} max={99} step={1} onChange={(v) => ch({ seed: v })} />
              </>
            )}
            {l.kind === 'image' && (
              <>
                <button className="btn wide" onClick={() => p.onReplaceImage(l.id)}>그림 바꾸기</button>
                <div className="gapTop" />
                <label className="field">
                  <span className="fieldLabel">맞춤</span>
                  <select className="text" value={l.fit} onChange={(e) => ch({ fit: e.target.value as PageLayer['fit'] }, false)}>
                    <option value="cover">채우기(잘림)</option>
                    <option value="contain">전체 보이기</option>
                    <option value="stretch">늘이기</option>
                  </select>
                </label>
                <Check label="좌우 뒤집기" value={l.flip} onChange={(v) => ch({ flip: v }, false)} />
              </>
            )}
            {l.kind === 'shape' && (
              <>
                <label className="field">
                  <span className="fieldLabel">도형</span>
                  <select className="text" value={l.shape} onChange={(e) => ch({ shape: e.target.value as PageLayer['shape'] }, false)}>
                    {(Object.keys(SHAPE_LABELS) as PageLayer['shape'][]).map((k) => (
                      <option key={k} value={k}>{SHAPE_LABELS[k]}</option>
                    ))}
                  </select>
                </label>
                {l.shape === 'rect' && <Slider label="모서리 둥글기" value={l.radius} min={0} max={200} step={1} onChange={(v) => ch({ radius: v })} />}
                {(l.shape === 'burst' || l.shape === 'star') && <Slider label="모양 변화(시드)" value={l.seed} min={1} max={99} step={1} onChange={(v) => ch({ seed: v })} />}
                <ColorField label="테두리 색" value={l.stroke} onChange={(v) => ch({ stroke: v })} />
                <Slider label="테두리 굵기" value={l.strokeWidth} min={0} max={30} step={0.5} onChange={(v) => ch({ strokeWidth: v })} />
              </>
            )}
            {(l.kind === 'color' || l.kind === 'gradient' || l.kind === 'pattern') && <Check label="페이지 전체를 덮기" value={l.full} onChange={(v) => ch({ full: v }, false)} />}
          </Section>
          {!l.full && (
            <Section title="위치·크기 (화면에서 끌어도 돼요)">
              <Slider label="가로 위치" value={l.x} min={-600} max={1500} step={1} onChange={(v) => ch({ x: v })} />
              <Slider label="세로 위치" value={l.y} min={-600} max={Math.max(4000, l.y + 800)} step={1} onChange={(v) => ch({ y: v })} />
              <Slider label="폭" value={l.w} min={20} max={2400} step={1} onChange={(v) => ch({ w: v })} />
              <Slider label="높이" value={l.h} min={20} max={4000} step={1} onChange={(v) => ch({ h: v })} />
              <Slider label="회전(°)" value={l.rotation} min={-180} max={180} step={1} onChange={(v) => ch({ rotation: v })} />
            </Section>
          )}
          <div className="grid2 pad">
            <button className="btn" onClick={() => p.onDuplicate(l.id)}>복제</button>
            <button className="btn danger" onClick={() => p.onDelete(l.id)}>삭제</button>
          </div>
        </>
      )}
    </div>
  );
}


/* ------------------------------ 소재 패널 ------------------------------ */

export interface MaterialPanelProps {
  materials: Material[];
  selId: string | null;
  hasCut: boolean;
  onSelect: (id: string | null) => void;
  onPick: () => void;
  onPickSheet: () => void;
  onDropFiles: (files: File[]) => void;
  onToCut: (m: Material, fit: 'stamp' | 'tile' | 'cover') => void;
  onToPage: (m: Material) => void;
  onToBack: (m: Material) => void;
  onDelete: (id: string) => void;
}


const HINT_LABEL: Record<Material['hint'], string> = {
  alpha: '투명 배경 소재',
  ink: '흰 바탕 + 먹색(톤·선)',
  light: '검은 바탕 + 밝은 빛',
  color: '일반 컬러 이미지',
};

function MatGrid({ list, selId, onSelect, onPlace }: { list: Material[]; selId: string | null; onSelect: (id: string | null) => void; onPlace: (m: Material) => void }) {
  if (!list.length) return null;
  return (
    <div className="matGrid">
      {list.map((m) => (
        <button
          key={m.id}
          className={`matItem ${m.id === selId ? 'on' : ''}`}
          onClick={() => onSelect(m.id)}
          onDoubleClick={() => onPlace(m)}
          draggable
          onDragStart={(e) => {
            // 끄는 도중에 선택을 바꾸면 위에 넣기 바가 생겨 목록이 밀리고, 브라우저가 끌기를 바로 취소해 버린다
            startPanelDrag(e.nativeEvent, DRAG_MAT, m.id, m.name, e.currentTarget.querySelector('img'));
          }}
          onDragEnd={endPanelDrag}
          title={`${m.name} · 웹툰 화면으로 끌어다 놓거나 두 번 클릭하면 붙어요`}
        >
          <span className="matThumb">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={m.thumb ?? m.src} alt={m.name} loading="lazy" decoding="async" draggable={false} /></span>
          <span className="matName">{m.name}</span>
        </button>
      ))}
    </div>
  );
}

export function MaterialPanel(p: MaterialPanelProps) {
  const [over, setOver] = useState(false);
  const [q, setQ] = useState('');
  const sel = p.materials.find((m) => m.id === p.selId) ?? null;
  const filtered = useMemo(() => (q.trim() ? p.materials.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())) : p.materials), [p.materials, q]);
  const mine = filtered.filter((m) => !m.builtin);
  const fixed = filtered.filter((m) => m.builtin);
  return (
    <div>
      <Section title="소재 가져오기">
        <div
          className={`dropZone ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); p.onDropFiles(Array.from(e.dataTransfer.files)); }}
        >
          <button className="btn primary wide" onClick={p.onPick}>＋ 소재 파일 가져오기</button>
          <button className="btn wide" data-testid="sheet-pick" onClick={p.onPickSheet} title="효과음이 한 장에 모여 있는 그림을 한 개씩 자동으로 잘라 등록">✂ 효과음 시트 자르기…</button>
          <span>PNG · JPG · WebP · SVG · PSD · 클립스튜디오 .clip(합쳐진 이미지), 또는 이 파일들이 든 ZIP. 여러 개를 한 번에 올릴 수 있어요. 끌어다 놓아도 돼요.</span>
        </div>
        <details className="note">
          <summary>클립스튜디오 소재는 어떻게 가져오나요?</summary>
          <p>
            <b>.clip(클립스튜디오 원고 파일)</b>은 바로 올릴 수 있어요. 클립스튜디오가 파일에 함께 저장해 둔 <b>합쳐진 그림 한 장</b>으로 가져와요(레이어는 나뉘지 않아요). 그 그림이 원본보다 작게 저장돼 있으면 알려 드려요.
            소재 전용 형식(.lip · .sut · .cmc · 3D)은 직접 읽을 수 없어요. 클립스튜디오에서 소재를 캔버스에 붙이거나 열어서 <b>PNG로 내보내거나 PSD로 저장한 파일</b>을 올리면 돼요(PSD도 합쳐진 이미지 한 장으로 가져와요).
            ASSETS에서 받은 소재가 PNG·JPG 이미지라면 그대로 올릴 수 있어요.
          </p>
          <p>
            소재 이용 규칙은 소재마다 달라요. 보통은 내려받은 본인만 쓸 수 있고 다른 사람에게 줄 수 없어요. 가져온 소재는 이 브라우저에만 저장되지만,
            .wtoon 파일에는 사용한 소재가 함께 들어가니 파일을 남에게 줄 때는 조심하세요.
          </p>
        </details>
      </Section>

      <Section title={`소재 목록 (${p.materials.length})`}>
        {p.materials.length > 12 && <input type="search" className="matSearch" data-testid="mat-search" placeholder="이름으로 찾기 (예: 쭈웁, 허억)" value={q} onChange={(e) => setQ(e.target.value)} />}
        {sel ? (
          <div className="matActions" role="toolbar">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sel.thumb ?? sel.src} alt="" />
            <div className="matActionsBody">
              <b>{sel.name}</b>
              <button className="btn primary wide" disabled={!p.hasCut} onClick={() => p.onToPage(sel)}>화면에 놓기 (옮기기·크기·회전 자유)</button>
              <details>
                <summary>다른 방법으로 넣기</summary>
                <div className="grid2">
                  <button className="btn" disabled={!p.hasCut} onClick={() => p.onToCut(sel, 'stamp')} title="고른 영역(없으면 컷) 안에만 보이게">영역 안에 한 장</button>
                  <button className="btn" disabled={!p.hasCut} onClick={() => p.onToCut(sel, 'tile')}>반복 톤으로 채우기</button>
                  <button className="btn" disabled={!p.hasCut} onClick={() => p.onToCut(sel, 'cover')}>영역 가득 채우기</button>
                  <button className="btn" onClick={() => p.onToBack(sel)}>컷 뒤 배경으로</button>
                </div>
                <p className="hint">{sel.w}×{sel.h}px · {HINT_LABEL[sel.hint]}</p>
                {!sel.builtin && <button className="btn danger wide" onClick={() => p.onDelete(sel.id)}>라이브러리에서 삭제</button>}
              </details>
            </div>
            <button className="iconBtn" title="선택 해제" onClick={() => p.onSelect(null)}>✕</button>
          </div>
        ) : (
          p.materials.length > 0 && <p className="hint tip">소재를 <b>웹툰 화면으로 끌어다 놓으면</b> 그 자리에 바로 붙어요. 두 번 클릭해도 돼요.</p>
        )}
        {p.materials.length === 0 && <p className="hint">아직 가져온 소재가 없어요.</p>}
        {mine.length > 0 && <h4 className="matHead">내가 가져온 소재 ({mine.length})</h4>}
        <MatGrid list={mine} selId={p.selId} onSelect={p.onSelect} onPlace={p.onToPage} />
        {fixed.length > 0 && <h4 className="matHead">내장 소재 ({fixed.length})</h4>}
        <MatGrid list={fixed} selId={p.selId} onSelect={p.onSelect} onPlace={p.onToPage} />
        {filtered.length === 0 && p.materials.length > 0 && <p className="hint">“{q}” 에 맞는 소재가 없어요.</p>}
      </Section>

    </div>
  );
}
