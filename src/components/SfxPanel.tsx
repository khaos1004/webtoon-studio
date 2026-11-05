'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bubble, SfxStyle } from '@/lib/types';
import { bubbleMarkup, defaultSfx, sfxStyleOf } from '@/lib/bubble';
import { ALL_SFX_WORDS, SFX_CATEGORIES, SFX_PRESETS, applySfxPreset, type SfxPreset } from '@/lib/sfx';
import { FONTS, ensureFontLoaded, fontDef, fontStack } from '@/lib/fonts';
import { DRAG_SFX, endPanelDrag, startPanelDrag } from '@/lib/dragkinds';
import { Check, ColorField, Section, Slider } from './Panels';

/* ------------------------------ 글꼴 고르기 (말풍선·의성어 공용) ------------------------------ */

const GROUPS = ['기본', '제목·효과음', '손글씨', '명조'] as const;

export function FontSelect({ value, onChange, sample = '가나다 쾅! 두근' }: { value?: string; onChange: (id: string) => void; sample?: string }) {
  const cur = fontDef(value);
  useEffect(() => ensureFontLoaded(cur.id), [cur.id]);
  return (
    <label className="field">
      <span className="fieldLabel">글꼴</span>
      <select className="text" value={cur.id} onChange={(e) => { ensureFontLoaded(e.target.value); onChange(e.target.value); }}>
        {GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {FONTS.filter((f) => f.group === g).map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="fontPreview" style={{ fontFamily: fontStack(cur.id) }}>{sample}</span>
    </label>
  );
}

/* ------------------------------ 미리보기 ------------------------------ */

function PresetThumb({ preset, text }: { preset: SfxPreset; text?: string }) {
  const b = useMemo(() => {
    const base = applySfxPreset(defaultSfx(0, 0, text || preset.sample), preset);
    return { ...base, id: `pv-${preset.id}`, seed: 7 };
  }, [preset, text]);
  // 글자 상자 둘레만 조금 넉넉히(두께·잔상이 보이게)
  const pad = Math.max(b.w, b.h) * 0.16;
  return <svg viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`} width="100%" height="58" preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{ __html: bubbleMarkup(b) }} />;
}

/* ------------------------------ 의성어 패널 ------------------------------ */

export interface SfxPanelProps {
  /** 선택한 의성어(없으면 null) */
  bubble: Bubble | null;
  styleId: string;
  onStyle: (id: string) => void;
  onAdd: (text: string, styleId: string) => void;
  onChange: (patch: Partial<Bubble>, coalesce?: boolean) => void;
  onFit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onZ: (dir: -1 | 1) => void;
  focusTick: number;
  hasCut: boolean;
}

export function SfxPanel(p: SfxPanelProps) {
  const b = p.bubble;
  const [draft, setDraft] = useState('');
  const [cat, setCat] = useState(SFX_CATEGORIES[0].id);
  const [q, setQ] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const st: SfxStyle | null = b ? sfxStyleOf(b) : null;

  useEffect(() => {
    for (const pr of SFX_PRESETS) if (pr.patch.font) ensureFontLoaded(pr.patch.font);
  }, []);
  useEffect(() => {
    if (p.focusTick > 0 && textRef.current) {
      textRef.current.focus();
      textRef.current.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusTick]);

  const setSt = (patch: Partial<SfxStyle>, co = true) => b && p.onChange({ sfx: { ...sfxStyleOf(b), ...patch } }, co);
  const category = SFX_CATEGORIES.find((c) => c.id === cat) ?? SFX_CATEGORIES[0];
  const words = q.trim() ? ALL_SFX_WORDS.filter((w) => w.word.includes(q.trim())) : category.words.map((w) => ({ word: w, cat: category }));
  const add = (text: string, styleId?: string) => {
    if (!text.trim()) return;
    p.onAdd(text.trim(), styleId ?? p.styleId);
  };

  return (
    <div>
      <Section title="의성어 넣기">
        <p className="hint">글자를 누르거나 <b>웹툰 화면으로 끌어다 놓으면</b> 고른 스타일로 들어가요. 화면에서 끌어 옮기고, 모서리로 늘리고, 위쪽 동그라미로 돌려요.</p>
        <div className="sfxInputRow">
          <input
            className="text"
            placeholder="직접 입력 (예: 콰과광)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                add(draft);
                setDraft('');
              }
            }}
          />
          <button className="btn primary" disabled={!p.hasCut || !draft.trim()} onClick={() => { add(draft); setDraft(''); }}>넣기</button>
        </div>
        <input type="search" className="matSearch" placeholder={`의성어 찾기 (${ALL_SFX_WORDS.length}개)`} value={q} onChange={(e) => setQ(e.target.value)} />
        {!q.trim() && (
          <div className="chips">
            {SFX_CATEGORIES.map((c) => (
              <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => { setCat(c.id); if (!b) p.onStyle(c.style); }} title="분류를 바꾸면 어울리는 스타일로 바뀌어요">{c.label}</button>
            ))}
          </div>
        )}
        <div className="wordGrid">
          {words.map(({ word }) => (
            <button
              key={word}
              className="wordBtn"
              disabled={!p.hasCut}
              onClick={() => add(word)}
              draggable={p.hasCut}
              onDragStart={(e) => startPanelDrag(e.nativeEvent, DRAG_SFX, JSON.stringify({ text: word, style: p.styleId }), `“${word}”`)}
              onDragEnd={endPanelDrag}
              title={`“${word}” 넣기 · 화면으로 끌어다 놓으면 그 자리에 들어가요`}
            >
              {word}
            </button>
          ))}
          {!words.length && <p className="hint">“{q}” 에 맞는 의성어가 없어요. 위 칸에 직접 입력해 넣으세요.</p>}
        </div>
        {!p.hasCut && <p className="hint warn">먼저 컷을 추가하세요.</p>}
      </Section>

      <Section title={b ? '스타일 바꾸기 (선택한 의성어에 적용)' : '스타일 (새 의성어에 적용)'}>
        <div className="sfxPresetGrid">
          {SFX_PRESETS.map((pr) => (
            <button
              key={pr.id}
              className={`sfxPreset ${p.styleId === pr.id ? 'on' : ''}`}
              title={pr.label}
              onClick={() => {
                p.onStyle(pr.id);
                if (b) p.onChange(applySfxPreset(b, pr));
              }}
            >
              <PresetThumb preset={pr} />
              <span>{pr.label}</span>
            </button>
          ))}
        </div>
      </Section>

      {b && st && (
        <>
          <Section title="글자">
            <textarea ref={textRef} className="text area" rows={2} value={b.text} onChange={(e) => p.onChange({ text: e.target.value }, true)} />
            <FontSelect value={b.font} sample={b.text || '쾅'} onChange={(id) => p.onChange({ font: id })} />
            <div className="grid2">
              <Check label="세로로 쓰기" value={!!b.vertical} onChange={(v) => p.onChange({ vertical: v })} />
              <Check label="굵게" value={b.bold ?? true} onChange={(v) => p.onChange({ bold: v })} />
            </div>
            <button className="btn wide" onClick={p.onFit} title="늘이거나 줄인 비율을 글자 원래 비율로 되돌려요">글자 비율로 되돌리기</button>
          </Section>
          <Section title="색·테두리">
            <ColorField label="글자 색" value={b.textColor} onChange={(v) => p.onChange({ textColor: v }, true)} />
            <Check label="그라데이션 (위→아래)" value={st.gradient} onChange={(v) => setSt({ gradient: v }, false)} />
            {st.gradient && <ColorField label="아래쪽 색" value={st.fill2} onChange={(v) => setSt({ fill2: v })} />}
            <ColorField label="테두리 색" value={b.stroke} onChange={(v) => p.onChange({ stroke: v }, true)} />
            <Slider label="테두리 굵기 (0 = 없음)" value={b.strokeWidth} min={0} max={20} step={0.5} onChange={(v) => p.onChange({ strokeWidth: v }, true)} />
            <ColorField label="바깥 테두리 색" value={st.stroke2} onChange={(v) => setSt({ stroke2: v })} />
            <Slider label="바깥 테두리 굵기" value={st.stroke2Width} min={0} max={20} step={0.5} onChange={(v) => setSt({ stroke2Width: v })} />
          </Section>
          <Section title="모양">
            <Slider label="회전(도)" value={st.rotation} min={-180} max={180} step={1} onChange={(v) => setSt({ rotation: v })} />
            <Slider label="기울임(도)" value={st.skew} min={-40} max={40} step={1} onChange={(v) => setSt({ skew: v })} />
            <Slider label="휘어짐 (− 아래로 · + 위로)" value={st.arc} min={-1} max={1} step={0.01} onChange={(v) => setSt({ arc: v })} />
            <Slider label="뒤로 갈수록 커지기 (−면 작아짐)" value={st.grow} min={-1} max={1} step={0.01} onChange={(v) => setSt({ grow: v })} />
            <Slider label="자간" value={st.spacing} min={-0.3} max={1} step={0.01} onChange={(v) => setSt({ spacing: v })} />
            <Slider label="들쭉날쭉" value={st.jitter} min={0} max={1} step={0.01} onChange={(v) => setSt({ jitter: v })} />
            {st.jitter > 0 && <button className="linkBtn" onClick={() => p.onChange({ seed: Math.floor(Math.random() * 98) + 1 })}>들쭉날쭉 다시 섞기</button>}
          </Section>
          <Section title="입체·잔상">
            <Slider label="두께(입체, px)" value={st.extrude} min={0} max={40} step={1} onChange={(v) => setSt({ extrude: v })} />
            {st.extrude > 0 && (
              <>
                <ColorField label="두께 색" value={st.extrudeColor} onChange={(v) => setSt({ extrudeColor: v })} />
                <Slider label="두께 방향(도)" value={st.extrudeAngle} min={0} max={360} step={5} onChange={(v) => setSt({ extrudeAngle: v })} />
              </>
            )}
            <Slider label="잔상 개수" value={st.motion} min={0} max={6} step={1} onChange={(v) => setSt({ motion: v })} />
            {st.motion > 0 && <Slider label="잔상 방향(도) · 180 = 왼쪽" value={st.motionAngle} min={0} max={360} step={5} onChange={(v) => setSt({ motionAngle: v })} />}
            <Slider label="불투명도" value={b.opacity} min={0.1} max={1} step={0.01} onChange={(v) => p.onChange({ opacity: v }, true)} />
          </Section>
          <div className="grid3 pad">
            <button className="btn" onClick={() => p.onZ(1)}>앞으로</button>
            <button className="btn" onClick={() => p.onZ(-1)}>뒤로</button>
            <button className="btn" onClick={p.onDuplicate} title="Ctrl+D">복제</button>
          </div>
          <div className="pad">
            <button className="btn danger wide" onClick={p.onDelete}>의성어 삭제 (Delete)</button>
          </div>
        </>
      )}
    </div>
  );
}
