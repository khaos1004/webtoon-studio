'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as RDragEvent } from 'react';
import {
  PAGE_WIDTH,
  emptyProject,
  uid,
  type Bubble,
  type BubbleKind,
  type Cut,
  type Effect,
  type EffectParams,
  type EffectType,
  type MaskDef,
  type MaskMode,
  type MaskOp,
  type Material,
  type PageLayer,
  type PageLayerKind,
  type Project,
} from '@/lib/types';
import { createEffect } from '@/lib/effectMeta';
import { buildPreset, type Preset } from '@/lib/presets';
import { growMaskDef } from '@/lib/mask';
import { DEFAULT_WAND, type WandOptions } from '@/lib/select';
import { createLayer, fileToLayerImage } from '@/lib/pagelayers';
import { defaultBubble, defaultSfx, fitBubble } from '@/lib/bubble';
import { applySfxPreset, presetById } from '@/lib/sfx';
import { ensureFontsForBubbles } from '@/lib/fonts';
import { fileToCut } from '@/lib/imageIO';
import { canvasToBlob, downloadBlob, ensureProjectMaterials, exportPsd, layoutCuts, parseProject, renderStrip, serializeProject } from '@/lib/project';
import { ensureMaterialPixels, importMaterialFiles, loadBuiltinMaterials, loadLibrary, materialToPortable, removeFromLibrary, saveToLibrary } from '@/lib/materials';
import { createSampleCut } from '@/lib/sample';
import { cloneEffects, duplicateCut, duplicateEffect, splitCut } from '@/lib/cutops';
import { canOverwrite, saveProjectFile, type FileHandleLike } from '@/lib/filesave';
import { clearAutosave, loadAutosave, saveAutosave, type AutosaveRecord } from '@/lib/autosave';
import Stage, { type Tool } from './Stage';
import { BgPanel, BubblePanel, CutPanel, EffectPanel, MaterialPanel } from './Panels';
import { DRAG_BUBBLE, DRAG_MAT, DRAG_SFX, dragLabel, endPanelDrag, panelDragType } from '@/lib/dragkinds';
import { ExportDialog, HelpDialog, MoreMenu, SheetDialog } from './Dialogs';
import { SfxPanel } from './SfxPanel';

const EMPTY: MaskDef = { ops: [], feather: 3 };

type Tab = 'effects' | 'sfx' | 'bubbles' | 'bg' | 'materials' | 'cuts';

const TAB_LABELS: Record<Tab, string> = { effects: '효과', sfx: '의성어', materials: '소재', bubbles: '말풍선', bg: '배경·장식', cuts: '컷' };
const TAB_ORDER: Tab[] = ['effects', 'sfx', 'bubbles', 'materials', 'bg', 'cuts'];

const TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: 'select', label: '선택/이동', icon: '↖', hint: '컷·말풍선을 선택하고 옮깁니다' },
  { id: 'wand', label: '마술봉', icon: '✦', hint: '클릭한 곳과 색이 비슷한(선으로 둘러싸인) 부분을 한 번에 선택해요. 손·콜라처럼 칠해진 물체에 편해요' },
  { id: 'lasso', label: '올가미', icon: '➰', hint: '손·물체의 윤곽을 따라 드래그하고 놓으면 영역이 선택돼요' },
  { id: 'brush', label: '브러시', icon: '🖌', hint: '효과를 줄 부분을 직접 칠하세요' },
  { id: 'rect', label: '사각', icon: '▭', hint: '드래그해서 사각형 영역을 선택해요' },
  { id: 'ellipse', label: '타원', icon: '◯', hint: '드래그해서 타원 영역을 선택해요' },
];

export default function Editor() {
  const [project, setProject] = useState<Project>(emptyProject);
  const projectRef = useRef(project);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const lastKey = useRef<{ key: string; t: number } | null>(null);
  const [, bump] = useState(0);

  const [tab, setTab] = useState<Tab>('effects');
  const [tool, setTool] = useState<Tool>('select');
  const [maskMode, setMaskMode] = useState<MaskMode>('add');
  const [brushSize, setBrushSize] = useState(36);
  const [zoom, setZoom] = useState(0.8);
  const [selCutId, setSelCutId] = useState<string | null>(null);
  const [selEffectId, setSelEffectId] = useState<string | null>(null);
  const [selBubbleId, setSelBubbleId] = useState<string | null>(null);
  const [selLayerId, setSelLayerId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ cutId: string; mask: MaskDef } | null>(null);
  const [wand, setWand] = useState<WandOptions>(DEFAULT_WAND);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [recover, setRecover] = useState<AutosaveRecord | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  /** 패널에서 화면으로 끄는 중: 커서 위치와 놓을 것 이름(웹툰 위가 아니면 ok=false) */
  const [dragHint, setDragHint] = useState<{ x: number; y: number; label: string; ok: boolean } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const hadContent = useRef(false);
  const autosaveWarned = useRef(false);
  /** 복사해 둔 효과 레이어(다른 컷에 붙여넣기용) */
  const [fxClip, setFxClip] = useState<Effect[] | null>(null);
  const fxClipRef = useRef<Effect[] | null>(null);
  fxClipRef.current = fxClip;
  const selCutRef = useRef<string | null>(null);
  selCutRef.current = selCutId;
  /** 마지막으로 저장한 파일(같은 파일에 덮어쓰기용)과 그때의 프로젝트 */
  const fileHandle = useRef<FileHandleLike | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [savedProject, setSavedProject] = useState<Project | null>(null);
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const [panning, setPanning] = useState(false);
  const spaceHeld = useRef(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);
  const layerFileRef = useRef<HTMLInputElement>(null);
  const matFileRef = useRef<HTMLInputElement>(null);
  const sheetFileRef = useRef<HTMLInputElement>(null);
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const replaceLayerId = useRef<string | null>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  const [library, setLibrary] = useState<Material[]>([]);
  const [builtin, setBuiltin] = useState<Material[]>([]);
  const [selMatId, setSelMatId] = useState<string | null>(null);
  const [sfxStyle, setSfxStyle] = useState('impact');

  useEffect(() => {
    let on = true;
    void loadLibrary().then((l) => on && setLibrary(l));
    void loadBuiltinMaterials().then((l) => on && setBuiltin(l));
    return () => {
      on = false;
    };
  }, []);

  const say = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 3200);
  }, []);

  /* ---------- 히스토리 ---------- */
  const commit = useCallback((fn: (p: Project) => Project, key?: string) => {
    const prev = projectRef.current;
    const next = fn(prev);
    if (next === prev) return;
    const now = Date.now();
    const lk = lastKey.current;
    if (!(key && lk && lk.key === key && now - lk.t < 700)) {
      past.current.push(prev);
      if (past.current.length > 80) past.current.shift();
    }
    lastKey.current = key ? { key, t: now } : null;
    future.current = [];
    projectRef.current = next;
    setProject(next);
    bump((n) => n + 1);
  }, []);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const selEffectRef = useRef(selEffectId);
  selEffectRef.current = selEffectId;

  const undo = useCallback(() => {
    const pd = pendingRef.current;
    if (pd && !selEffectRef.current && pd.mask.ops.length) {
      setPending({ ...pd, mask: { ...pd.mask, ops: pd.mask.ops.slice(0, -1) } });
      return;
    }
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(projectRef.current);
    projectRef.current = prev;
    lastKey.current = null;
    setProject(prev);
    bump((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(projectRef.current);
    projectRef.current = next;
    lastKey.current = null;
    setProject(next);
    bump((n) => n + 1);
  }, []);

  /* ---------- 컷 ---------- */
  const targetCut = (): Cut | null => {
    const p = projectRef.current;
    return p.cuts.find((c) => c.id === selCutId) ?? p.cuts[p.cuts.length - 1] ?? null;
  };

  /** 화면을 그 컷 위치로 부드럽게 스크롤한다 */
  const scrollToCut = useCallback((id: string) => {
    window.setTimeout(() => {
      const el = document.querySelector('.stageScroll') as HTMLElement | null;
      const it = layoutCuts(projectRef.current).items.find((i) => i.cut.id === id);
      if (!el || !it) return;
      el.scrollTo({ top: Math.max(0, 28 + it.top * zoomRef.current - 24), behavior: 'smooth' });
    }, 60);
  }, []);

  /** 새 컷은 선택한 컷 바로 뒤에 넣는다(선택이 없거나 마지막 컷이면 맨 끝) */
  const addCuts = useCallback(
    (cuts: Cut[]) => {
      if (!cuts.length) return;
      const cur = projectRef.current.cuts;
      const at = cur.findIndex((c) => c.id === selCutRef.current);
      const insertAt = at >= 0 ? at + 1 : cur.length;
      commit((p) => {
        const arr = [...p.cuts];
        arr.splice(Math.min(insertAt, arr.length), 0, ...cuts);
        return { ...p, cuts: arr };
      });
      setSelCutId(cuts[cuts.length - 1].id);
      setSelEffectId(null);
      scrollToCut(cuts[cuts.length - 1].id);
      if (insertAt < cur.length) say(`컷 ${at}번 뒤에 ${cuts.length}장을 넣었어요`);
    },
    [commit, scrollToCut, say],
  );

  const onFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return say('이미지 파일을 선택하세요');
    setBusy('이미지 불러오는 중…');
    try {
      const cuts: Cut[] = [];
      for (const f of list) cuts.push(await fileToCut(f));
      addCuts(cuts);
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const updateCut = (cutId: string, fn: (c: Cut) => Cut, key?: string) =>
    commit((p) => ({ ...p, cuts: p.cuts.map((c) => (c.id === cutId ? fn(c) : c)) }), key);

  const updateEffect = (effectId: string, fn: (e: Effect) => Effect, key?: string) => {
    const cut = projectRef.current.cuts.find((c) => c.effects.some((e) => e.id === effectId));
    if (!cut) return;
    updateCut(cut.id, (c) => ({ ...c, effects: c.effects.map((e) => (e.id === effectId ? fn(e) : e)) }), key);
  };

  /* ---------- 효과 / 영역 ---------- */
    /** 지금 효과를 적용할 영역: 임시 선택 → 선택한 효과 레이어의 영역 순서 */
  const takeSelection = (cut: Cut): MaskDef | null => {
    const pd = pendingRef.current;
    if (pd && pd.cutId === cut.id && pd.mask.ops.length) return pd.mask;
    const se = cut.effects.find((e) => e.id === selEffectRef.current);
    if (se && se.mask.ops.length) return { ...se.mask };
    return null;
  };

  /** 영역 없이 넣어서 '컷 전체'로 들어간 효과. 처음 영역을 고르면 컷 전체 대신 그 영역으로 바뀐다 */
  const autoFull = useRef(new Set<string>());

  const addLayersToCut = (cut: Cut, effects: Effect[], mask: MaskDef | null) => {
    if (!mask) {
      // 영역을 안 골랐으면 일단 컷 전체에 적용해서 바로 결과가 보이게 한다
      const full: MaskOp = { kind: 'rect', mode: 'add', x: 0, y: 0, w: PAGE_WIDTH, h: cut.height };
      effects = effects.map((e) => (e.mask.ops.length ? e : { ...e, mask: { ...e.mask, ops: [full] } }));
      for (const e of effects) autoFull.current.add(e.id);
    }
    updateCut(cut.id, (c) => ({ ...c, effects: [...c.effects, ...effects] }));
    setSelCutId(cut.id);
    setSelEffectId(effects[effects.length - 1].id);
    setPending(null);
    setSelLayerId(null);
    setTab('effects');
    if (!mask) say('컷 전체에 적용했어요 · 일부분만 원하면 마술봉·올가미로 고르세요 (고른 부분으로 바뀌어요)');
  };

  const addEffect = (type: EffectType) => {
    const cut = targetCut();
    if (!cut) return say('먼저 컷을 추가하세요');
    const mask = takeSelection(cut);
    const eff = createEffect(type);
    if (mask) eff.mask = { ops: mask.ops, feather: mask.feather, invert: mask.invert };
    addLayersToCut(cut, [eff], mask);
  };

  const applyPreset = (preset: Preset) => {
    const cut = targetCut();
    if (!cut) return say('먼저 컷을 추가하세요');
    const mask = takeSelection(cut);
    addLayersToCut(cut, buildPreset(preset, mask ?? { ops: [], feather: 3 }), mask);
  };

  /** 선택 도구로 만든 영역 조각 추가 → 효과 레이어(같은 묶음 포함) 또는 임시 선택에 쌓인다 */
  const onMaskOp = (cutId: string, op: MaskOp) => {
    const cut = projectRef.current.cuts.find((c) => c.id === cutId);
    if (!cut) return;
    const se = cut.effects.find((e) => e.id === selEffectRef.current);
    if (se) {
      const replace = autoFull.current.has(se.id) && op.mode === 'add';
      const ids = new Set(cut.effects.filter((e) => e.id === se.id || (se.group && e.group === se.group)).map((e) => e.id));
      for (const id of ids) autoFull.current.delete(id);
      updateCut(cutId, (c) => ({
        ...c,
        effects: c.effects.map((e) => (ids.has(e.id) ? { ...e, mask: { ...e.mask, ops: replace ? [op] : [...e.mask.ops, op] } } : e)),
      }));
    } else {
      setPending((pd) => {
        const base = pd && pd.cutId === cutId ? pd.mask : { ops: [], feather: 3 };
        return { cutId, mask: { ...base, ops: [...base.ops, op] } };
      });
    }
  };

  /** 영역 편집(지우기·확대·전체 선택 등): 효과 레이어면 같은 묶음 전체, 아니면 임시 선택 */
  const editOps = (fn: (def: MaskDef, cut: Cut) => MaskOp[], key?: string) => {
    const cut = targetCut();
    if (!cut) return;
    const se = cut.effects.find((e) => e.id === selEffectRef.current);
    if (se) {
      updateCut(cut.id, (c) => ({
        ...c,
        effects: c.effects.map((e) => (e.id === se.id || (se.group && e.group === se.group) ? { ...e, mask: { ...e.mask, ops: fn(e.mask, c) } } : e)),
      }), key);
    } else {
      setPending((pd) => {
        const base = pd && pd.cutId === cut.id ? pd.mask : { ops: [], feather: 3 };
        return { cutId: cut.id, mask: { ...base, ops: fn(base, cut) } };
      });
    }
  };

  const editMaskProp = (patch: Partial<MaskDef>, key: string) => {
    const cut = targetCut();
    if (!cut) return;
    const se = cut.effects.find((e) => e.id === selEffectRef.current);
    if (se) updateEffect(se.id, (e) => ({ ...e, mask: { ...e.mask, ...patch } }), key);
    else
      setPending((pd) => {
        const base = pd && pd.cutId === cut.id ? pd.mask : { ops: [], feather: 3 };
        return { cutId: cut.id, mask: { ...base, ...patch } };
      });
  };

  const growSelection = (n: number) => {
    editOps((def, cut) => growMaskDef({ ...def, invert: false }, PAGE_WIDTH, cut.height, n).ops);
  };

  const setParam = (id: string, key: keyof EffectParams, value: EffectParams[keyof EffectParams]) => {
    if (key === 'materialId' && value) {
      const m = allMaterials.find((x) => x.id === value);
      if (m) void adoptMaterial(m);
    }
    updateEffect(id, (e) => ({ ...e, params: { ...e.params, [key]: value } }), `param-${id}-${String(key)}`);
  };

  const setParams = (id: string, patch: Partial<EffectParams>, key: string) =>
    updateEffect(id, (e) => ({ ...e, params: { ...e.params, ...patch } }), key);

  /** 컷을 to 번째(맨 위가 0)로 옮긴다. 범위를 벗어나면 맨 위/맨 아래로 맞춘다. */
  const reorderCut = (id: string, to: number) => {
    const n = projectRef.current.cuts.length;
    const t = Math.max(0, Math.min(n - 1, Math.round(to)));
    const from = projectRef.current.cuts.findIndex((c) => c.id === id);
    if (from < 0 || from === t) return;
    commit((p) => {
      const arr = [...p.cuts];
      const [it] = arr.splice(from, 1);
      arr.splice(t, 0, it);
      return { ...p, cuts: arr };
    });
    setSelCutId(id);
    scrollToCut(id);
    say(`컷을 ${t}번 자리로 옮겼어요`);
  };

  const moveEffect = (id: string, dir: -1 | 1) => {
    const cut = projectRef.current.cuts.find((c) => c.effects.some((e) => e.id === id));
    if (!cut) return;
    updateCut(cut.id, (c) => {
      const i = c.effects.findIndex((e) => e.id === id);
      const j = i + dir;
      if (j < 0 || j >= c.effects.length) return c;
      const arr = [...c.effects];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...c, effects: arr };
    });
  };

  const deleteEffect = (id: string) => {
    const cut = projectRef.current.cuts.find((c) => c.effects.some((e) => e.id === id));
    if (!cut) return;
    updateCut(cut.id, (c) => ({ ...c, effects: c.effects.filter((e) => e.id !== id) }));
    if (selEffectId === id) setSelEffectId(null);
  };

  const dupEffect = (id: string) => {
    const cut = projectRef.current.cuts.find((c) => c.effects.some((e) => e.id === id));
    const src = cut?.effects.find((e) => e.id === id);
    if (!cut || !src) return;
    const copy = duplicateEffect(src);
    updateCut(cut.id, (c) => {
      const i = c.effects.findIndex((e) => e.id === id);
      const arr = [...c.effects];
      arr.splice(i + 1, 0, copy);
      return { ...c, effects: arr };
    });
    setSelCutId(cut.id);
    setSelEffectId(copy.id);
    say('효과 레이어를 복제했어요');
  };

  const dupCut = (id: string) => {
    const idx = projectRef.current.cuts.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const copy = duplicateCut(projectRef.current.cuts[idx]);
    commit((p) => {
      const arr = [...p.cuts];
      arr.splice(idx + 1, 0, copy);
      return { ...p, cuts: arr };
    });
    setSelCutId(copy.id);
    setSelEffectId(null);
    scrollToCut(copy.id);
    say('컷을 복제했어요 (효과 포함)');
  };

  const copyEffect = (id: string) => {
    const cut = projectRef.current.cuts.find((c) => c.effects.some((e) => e.id === id));
    const src = cut?.effects.find((e) => e.id === id);
    if (!cut || !src) return;
    const list = src.group ? cut.effects.filter((e) => e.group === src.group) : [src];
    setFxClip(cloneEffects(list));
    say(`효과 ${list.length}개를 복사했어요 · 붙여넣을 컷을 고르고 “붙여넣기”(Ctrl+V)를 누르세요`);
  };

  const pasteEffects = (cutId?: string) => {
    const clip = fxClipRef.current;
    if (!clip?.length) return say('복사한 효과가 없어요');
    const cut = cutId ? projectRef.current.cuts.find((c) => c.id === cutId) : targetCut();
    if (!cut) return say('붙여넣을 컷이 없어요');
    const copies = cloneEffects(clip);
    updateCut(cut.id, (c) => ({ ...c, effects: [...c.effects, ...copies] }));
    setSelCutId(cut.id);
    setSelEffectId(copies[copies.length - 1].id);
    setSelLayerId(null);
    setPending(null);
    scrollToCut(cut.id);
    const n = projectRef.current.cuts.findIndex((c) => c.id === cut.id);
    say(`효과 ${copies.length}개를 컷 ${n}번에 붙여넣었어요 (영역은 같은 위치로 붙어요)`);
  };

  const setGapBefore = (id: string, v: number | null) =>
    updateCut(
      id,
      (c) => {
        const { gapBefore: _drop, ...rest } = c;
        void _drop;
        return v === null ? rest : { ...rest, gapBefore: Math.max(0, Math.round(v)) };
      },
      `gapb-${id}`,
    );

  const doSplitCut = async (id: string, at: number[]) => {
    const cut = projectRef.current.cuts.find((c) => c.id === id);
    if (!cut || !at.length) return;
    setBusy('컷 나누는 중…');
    try {
      const parts = await splitCut(cut, at);
      if (parts.length < 2) return say('너무 가장자리라 나눌 수 없어요');
      commit((p) => {
        const i = p.cuts.findIndex((c) => c.id === id);
        if (i < 0) return p;
        const arr = [...p.cuts];
        arr.splice(i, 1, ...parts);
        return { ...p, cuts: arr };
      });
      setSelCutId(parts[0].id);
      setSelEffectId(null);
      say(`컷을 ${parts.length}개로 나눴어요. 컷 사이 간격은 “이 컷 위 간격”으로 바꿀 수 있어요`);
    } catch (e) {
      say('나누지 못했어요: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const slantJoint = (id: string, v: number) =>
    commit((p) => {
      const i = p.cuts.findIndex((c) => c.id === id);
      if (i < 0 || i >= p.cuts.length - 1) return p;
      return { ...p, cuts: p.cuts.map((c, j) => (j === i ? { ...c, slantBottom: v } : j === i + 1 ? { ...c, slantTop: v } : c)) };
    });

  const deleteCut = (id: string) => {
    commit((p) => ({ ...p, cuts: p.cuts.filter((c) => c.id !== id) }));
    if (selCutId === id) {
      setSelCutId(null);
      setSelEffectId(null);
    }
    say('컷을 지웠어요 (Ctrl+Z 로 되돌릴 수 있어요)');
  };

  const newProject = () => {
    if (!projectRef.current.cuts.length && !projectRef.current.bubbles.length && !projectRef.current.layers.length) return;
    commit(() => emptyProject());
    fileHandle.current = null;
    setFileName(null);
    setSavedProject(null);
    setSelCutId(null);
    setSelEffectId(null);
    setSelBubbleId(null);
    setSelLayerId(null);
    setPending(null);
    say('새로 시작했어요 (Ctrl+Z 로 되돌릴 수 있어요)');
  };

  /* ---------- 배경 / 장식 레이어 ---------- */
  /** keepTab: 소재를 연달아 놓을 수 있게 지금 탭을 그대로 둔다 */
  const addLayer = (kind: PageLayerKind, patch: Partial<PageLayer> = {}, keepTab = false) => {
    const { total } = layoutCuts(projectRef.current);
    const l = createLayer(kind, total, patch);
    commit((p) => ({ ...p, layers: [...p.layers, l] }));
    setSelLayerId(l.id);
    setSelBubbleId(null);
    if (!keepTab) setTab('bg');
    setTool('select');
  };

  const changeLayer = (id: string, patch: Partial<PageLayer>, coalesce?: boolean) =>
    commit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }), coalesce ? `layer-${id}-${Object.keys(patch).join(',')}` : undefined);

  const deleteLayer = (id: string) => {
    commit((p) => ({ ...p, layers: p.layers.filter((l) => l.id !== id) }));
    if (selLayerId === id) setSelLayerId(null);
  };

  const onLayerFile = async (file: File) => {
    setBusy('그림 불러오는 중…');
    try {
      const img = await fileToLayerImage(file);
      const rid = replaceLayerId.current;
      replaceLayerId.current = null;
      if (rid) {
        changeLayer(rid, { src: img.src, imgW: img.w, imgH: img.h });
      } else {
        const { items, total } = layoutCuts(projectRef.current);
        const target = items.find((i) => i.cut.id === selCutId) ?? items[0];
        const w = Math.min(PAGE_WIDTH, img.w);
        const h = Math.round((w * img.h) / img.w);
        addLayer('image', {
          src: img.src,
          imgW: img.w,
          imgH: img.h,
          w,
          h,
          x: Math.round((PAGE_WIDTH - w) / 2),
          y: Math.round(Math.max(0, Math.min(total - h, (target?.top ?? 0) + 30))),
          fit: 'stretch',
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || '이미지',
        });
      }
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /* ---------- 소재 ---------- */
  const allMaterials = useMemo(() => {
    const map = new Map<string, Material>();
    for (const m of builtin) map.set(m.id, m);
    for (const m of library) map.set(m.id, m);
    // 내장 소재를 컷에 쓰면 프로젝트에도 복사본이 생긴다 — 목록에서는 내장 쪽(작은 그림)을 그대로 보여 준다
    for (const m of project.materials ?? []) if (!map.has(m.id)) map.set(m.id, m);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [builtin, library, project.materials]);

  /** 소재를 이 프로젝트에 담고(.wtoon 에 저장됨) 픽셀을 준비한다 */
  const adoptMaterial = async (m: Material) => {
    await ensureMaterialPixels(m);
    const portable = await materialToPortable(m);
    commit((p) => ((p.materials ?? []).some((x) => x.id === m.id) ? p : { ...p, materials: [...(p.materials ?? []), portable] }));
  };

  const importMaterials = async (files: File[]) => {
    if (!files.length) return;
    setBusy('소재 가져오는 중…');
    try {
      const { added, skipped } = await importMaterialFiles(files, (m) => setBusy(m));
      if (added.length) {
        setLibrary((l) => [...l, ...added]);
        void saveToLibrary(added);
        setSelMatId(added[added.length - 1].id);
        setTab('materials');
      }
      say(added.length ? `소재 ${added.length}개를 가져왔어요${skipped.length ? ` · 건너뜀 ${skipped.length}개` : ''}` : `가져올 수 있는 소재가 없어요${skipped[0] ? ': ' + skipped[0] : ''}`);
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const materialToCut = async (m: Material, fit: 'stamp' | 'tile' | 'cover') => {
    const cut = targetCut();
    if (!cut) return say('먼저 컷을 추가하세요');
    await adoptMaterial(m);
    const sel = takeSelection(cut);
    const mask: MaskDef = sel ?? { ops: [{ kind: 'rect', mode: 'add', x: 0, y: 0, w: PAGE_WIDTH, h: cut.height }], feather: 0 };
    const eff = createEffect('material');
    eff.name = m.name.slice(0, 18);
    eff.mask = { ops: mask.ops, feather: mask.feather, invert: mask.invert };
    const scale = fit === 'stamp' ? Math.round(Math.min(100, ((PAGE_WIDTH * 0.55) / m.w) * 100)) : fit === 'tile' ? Math.round(Math.max(8, Math.min(100, (140 / m.w) * 100))) : 100;
    eff.params = {
      ...eff.params,
      materialId: m.id,
      matFit: fit,
      matScale: scale,
      matMode: m.hint === 'ink' ? 'ink' : m.hint === 'light' ? 'light' : 'color',
      matBlend: m.hint === 'ink' ? 'multiply' : m.hint === 'light' ? 'add' : 'normal',
      color: m.hint === 'light' ? '#ffffff' : '#000000',
    };
    addLayersToCut(cut, [eff], mask);
    say('소재를 붙였어요. 효과 탭에서 크기·색·합성 방식을 바꿀 수 있어요');
  };

  /**
   * 소재를 화면 위에 자유롭게 놓는다(컷 위 장식 레이어). 끌어서 옮기고, 모서리로 크기, 동그라미로 회전.
   * at 을 주면 그 위치(페이지 좌표)를 가운데로, 아니면 선택한 컷 가운데에 놓는다. z='back' 이면 컷 뒤 배경으로.
   */
  const materialToPage = async (m: Material, at?: { x: number; y: number }, z: 'front' | 'back' = 'front') => {
    await adoptMaterial(m);
    const portableSrc = (await materialToPortable(m)).src; // 내장 소재도 파일 안에 그림이 들어가도록
    const { items, total } = layoutCuts(projectRef.current);
    const target = items.find((i) => i.cut.id === selCutRef.current) ?? items[0];
    const w = Math.round(z === 'back' ? Math.min(PAGE_WIDTH, m.w) : Math.min(m.w, PAGE_WIDTH * 0.45));
    const h = Math.round((w * m.h) / m.w);
    const cx = at?.x ?? PAGE_WIDTH / 2;
    const cy = at?.y ?? (target ? target.top + target.cut.height / 2 : total / 2);
    addLayer('image', {
      src: portableSrc,
      imgW: m.w,
      imgH: m.h,
      w,
      h,
      z,
      x: Math.round(cx - w / 2),
      y: Math.round(Math.max(-h / 2, Math.min(total - h / 2, cy - h / 2))),
      fit: 'stretch',
      blend: m.hint === 'ink' ? 'multiply' : m.hint === 'light' ? 'screen' : 'normal',
      name: m.name.slice(0, 24),
    }, true);
    say('소재를 붙였어요 · 끌어서 옮기고, 모서리로 크기, 위 동그라미로 회전 · 더 끌어다 놓아도 돼요');
  };

  /** 화면 좌표 → 페이지 좌표 (소재를 끌어다 놓을 때) */
  const clientToPage = (clientX: number, clientY: number) => {
    const strip = document.querySelector('.strip') as HTMLElement | null;
    if (!strip) return null;
    const r = strip.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    return { x: ((clientX - r.left) / r.width) * PAGE_WIDTH, y: ((clientY - r.top) / r.height) * layoutCuts(projectRef.current).total };
  };

  const deleteMaterial = (id: string) => {
    if (builtin.some((m) => m.id === id)) return say('내장 소재는 지울 수 없어요');
    setLibrary((l) => l.filter((m) => m.id !== id));
    void removeFromLibrary(id);
    if (selMatId === id) setSelMatId(null);
    say('라이브러리에서 지웠어요. 이미 컷에 붙인 소재는 그대로 남아요');
  };

  /* ---------- 말풍선 ---------- */
  const addBubble = (kind: BubbleKind, at?: { x: number; y: number }) => {
    const { items } = layoutCuts(projectRef.current);
    const target = items.find((i) => i.cut.id === selCutId) ?? items[items.length - 1];
    const y = target ? target.top + 40 : 60;
    let b = defaultBubble(kind, PAGE_WIDTH / 2 - 120, y);
    if (at) {
      // 놓은 곳이 말풍선 가운데가 되게(꼬리도 같이 옮긴다)
      const dx = Math.round(at.x - (b.x + b.w / 2));
      const dy = Math.round(at.y - (b.y + b.h / 2));
      b = { ...b, x: b.x + dx, y: b.y + dy, tailX: b.tailX + dx, tailY: b.tailY + dy };
    }
    commit((p) => ({ ...p, bubbles: [...p.bubbles, b] }));
    setSelBubbleId(b.id);
    setTool('select');
    setTab('bubbles');
  };

  /** 글자 의성어를 선택한 컷 가운데쯤에 넣는다(연달아 넣으면 조금씩 비켜서) */
  const sfxCount = useRef(0);
  const addSfx = (text: string, styleId: string, at?: { x: number; y: number }) => {
    const { items } = layoutCuts(projectRef.current);
    const target = items.find((i) => i.cut.id === selCutRef.current) ?? items[items.length - 1];
    if (!target) return say('먼저 컷을 추가하세요');
    const n = sfxCount.current++ % 5;
    const h = Math.round(Math.min(170, Math.max(90, target.cut.height * 0.16)));
    let b = defaultSfx(0, 0, text, { h });
    b = applySfxPreset(b, presetById(styleId));
    b = fitBubble({ ...b, h });
    const x = Math.round(at ? at.x - b.w / 2 : PAGE_WIDTH / 2 - b.w / 2 + (n - 2) * 40);
    const y = Math.round(at ? at.y - b.h / 2 : target.top + target.cut.height / 2 - b.h / 2 + (n - 2) * 30);
    b = { ...b, x, y, tailX: x, tailY: y };
    commit((p) => ({ ...p, bubbles: [...p.bubbles, b] }));
    setSelBubbleId(b.id);
    setSelLayerId(null);
    setTool('select');
    setTab('sfx');
  };

  const moveBubbleZ = (id: string, dir: -1 | 1) =>
    commit((p) => {
      const i = p.bubbles.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.bubbles.length) return p;
      const arr = [...p.bubbles];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...p, bubbles: arr };
    });

  const changeBubble = (id: string, patch: Partial<Bubble>, coalesce?: boolean) =>
    commit(
      (p) => ({ ...p, bubbles: p.bubbles.map((b) => (b.id === id ? { ...b, ...patch } : b)) }),
      coalesce ? `bubble-${id}-${Object.keys(patch).join(',')}` : undefined,
    );

  const dupBubble = (id: string) => {
    const src = projectRef.current.bubbles.find((b) => b.id === id);
    if (!src) return;
    const copy: Bubble = { ...src, id: uid(), x: src.x + 24, y: src.y + 24, tailX: src.tailX + 24, tailY: src.tailY + 24, ...(src.tail2 ? { tail2: { x: src.tail2.x + 24, y: src.tail2.y + 24 } } : {}) };
    commit((p) => ({ ...p, bubbles: [...p.bubbles, copy] }));
    setSelBubbleId(copy.id);
  };

  const dupLayer = (id: string) => {
    const src = projectRef.current.layers.find((l) => l.id === id);
    if (!src) return;
    const copy: PageLayer = { ...src, id: uid(), name: src.name + ' 복사', x: src.x + 30, y: src.y + 30 };
    commit((p) => ({ ...p, layers: [...p.layers, copy] }));
    setSelLayerId(copy.id);
  };

  const selAny = project.bubbles.find((b) => b.id === selBubbleId) ?? null;
  const selBubble = selAny && selAny.kind !== 'sfx' ? selAny : null;
  const selSfx = selAny && selAny.kind === 'sfx' ? selAny : null;
  const bubbleTab = (id: string | null): Tab => (projectRef.current.bubbles.find((b) => b.id === id)?.kind === 'sfx' ? 'sfx' : 'bubbles');
  const selCut = project.cuts.find((c) => c.id === selCutId) ?? null;
  const tCut = selCut ?? project.cuts[project.cuts.length - 1] ?? null;
  const tEffect = tCut?.effects.find((e) => e.id === selEffectId) ?? null;
  const pendingMask = pending && tCut && pending.cutId === tCut.id ? pending.mask : null;
  const activeMask: MaskDef | null = tCut ? (tEffect ? tEffect.mask : pendingMask ?? EMPTY) : null;
  const maskTarget: 'effect' | 'pending' | 'none' = tEffect ? 'effect' : pendingMask && pendingMask.ops.length ? 'pending' : 'none';

  const deleteBubble = useCallback(
    (id: string) => {
      commit((p) => ({ ...p, bubbles: p.bubbles.filter((b) => b.id !== id) }));
      setSelBubbleId(null);
    },
    [commit],
  );

  /* ---------- 파일 저장 / 불러오기 / 내보내기 ---------- */
  const saveProject = async (asNew = false) => {
    const proj = projectRef.current;
    try {
      const r = await saveProjectFile(serializeProject(proj), fileName ?? 'webtoon.wtoon', fileHandle.current, asNew);
      if (r.kind === 'canceled') return;
      if (r.kind === 'overwritten' || r.kind === 'picked') {
        fileHandle.current = r.handle;
        setFileName(r.name);
      }
      setSavedProject(proj);
      say(r.kind === 'overwritten' ? `${r.name} 에 덮어썼어요` : r.kind === 'picked' ? `${r.name} 로 저장했어요` : '프로젝트(.wtoon)를 저장했어요');
    } catch (e) {
      say('저장하지 못했어요: ' + (e as Error).message);
    }
  };

  /**
   * 프로젝트를 통째로 바꾼다. 지금 작업이 있으면 되돌리기 기록에 남겨서 Ctrl+Z 로 돌아올 수 있다
   * (실수로 파일을 끌어놓거나 불러와도 작업이 사라지지 않는다). 반환값: 이전 작업이 있었는지.
   */
  const applyProject = (p: Project): boolean => {
    const prev = projectRef.current;
    const had = prev.cuts.length > 0 || prev.bubbles.length > 0 || prev.layers.length > 0;
    if (had) {
      commit(() => p);
    } else {
      past.current = [];
      future.current = [];
      lastKey.current = null;
      projectRef.current = p;
      setProject(p);
    }
    setSelCutId(p.cuts[0]?.id ?? null);
    setSelEffectId(null);
    setSelBubbleId(null);
    setSelLayerId(null);
    setPending(null);
    bump((n) => n + 1);
    return had;
  };

  const loadProject = async (file: File) => {
    try {
      const p = parseProject(await file.text());
      await ensureProjectMaterials(p);
      const had = applyProject(p);
      fileHandle.current = null;
      setFileName(file.name);
      setSavedProject(projectRef.current);
      say(had ? '프로젝트를 불러왔어요 (Ctrl+Z 로 이전 작업으로 돌아갈 수 있어요)' : '프로젝트를 불러왔어요');
    } catch (e) {
      say((e as Error).message);
    }
  };

  const restoreAutosave = async () => {
    if (!recover) return;
    try {
      const p = parseProject(recover.json);
      await ensureProjectMaterials(p);
      applyProject(p);
      fileHandle.current = null;
      setFileName(null);
      setRecover(null);
      say('이전 작업을 복구했어요');
    } catch {
      setRecover(null);
      void clearAutosave();
      say('복구할 수 없는 데이터라 지웠어요');
    }
  };

  const discardAutosave = () => {
    setRecover(null);
    void clearAutosave();
  };

  const doExport = async (kind: 'jpg' | 'png' | 'psd') => {
    if (!projectRef.current.cuts.length) return say('내보낼 컷이 없어요');
    setBusy(kind === 'psd' ? 'PSD 만드는 중…' : '이미지 만드는 중…');
    try {
      if (kind === 'psd') {
        downloadBlob(await exportPsd(projectRef.current), 'webtoon.psd');
      } else {
        const canvas = await renderStrip(projectRef.current);
        downloadBlob(await canvasToBlob(canvas, kind === 'jpg' ? 'image/jpeg' : 'image/png'), `webtoon.${kind}`);
      }
      say('내보내기를 마쳤어요');
    } catch (e) {
      say('내보내기 실패: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const fitZoom = () => {
    const w = centerRef.current?.clientWidth ?? 900;
    setZoom(Math.max(0.2, Math.min(1.5, (w - 56) / PAGE_WIDTH)));
  };

  const hasCuts = project.cuts.length > 0;
  const hasContent = hasCuts || project.bubbles.length > 0 || project.layers.length > 0;
  /** 마지막으로 파일에 저장한 뒤로 바뀐 게 있는가(되돌려서 같아지면 다시 false) */
  const dirty = hasContent && project !== savedProject;

  /* ---------- 단축키 ---------- */
  // 글자 키는 e.code(키의 물리적 위치)로 판별해서, 한글 입력 상태에서도 같은 키로 동작한다
  /**
   * 키보드 단축키(Delete · Ctrl+D · 방향키)가 어느 대상에 적용될지 정한다.
   * 지금 열려 있는 탭이 기준이다: 말풍선 탭이면 말풍선, 배경 탭이면 배경 레이어, 효과 탭이면 효과 레이어, 컷 탭이면 컷.
   * 그 탭에 선택된 게 없으면 화면에서 선택된 말풍선 → 배경 레이어 → 컷 순서로 찾는다.
   */
  const focusKind = (): 'bubble' | 'layer' | 'effect' | 'cut' | null => {
    if ((tab === 'bubbles' || tab === 'sfx') && selBubbleId) return 'bubble';
    if (tab === 'bg' && selLayerId) return 'layer';
    if (tab === 'effects' && selEffectId) return 'effect';
    if (tab === 'cuts' && selCutId) return 'cut';
    if (selBubbleId) return 'bubble';
    if (selLayerId) return 'layer';
    if (selCutId) return 'cut';
    return null;
  };

  const nudge = (dx: number, dy: number): boolean => {
    const kind = focusKind();
    if (kind === 'bubble') {
      const b = projectRef.current.bubbles.find((x) => x.id === selBubbleId);
      if (!b) return false;
      changeBubble(b.id, { x: b.x + dx, y: b.y + dy, tailX: b.tailX + dx, tailY: b.tailY + dy, ...(b.tail2 ? { tail2: { x: b.tail2.x + dx, y: b.tail2.y + dy } } : {}) }, true);
      return true;
    }
    if (kind === 'layer') {
      const l = projectRef.current.layers.find((x) => x.id === selLayerId);
      if (!l) return false;
      changeLayer(l.id, { x: l.x + dx, y: l.y + dy }, true);
      return true;
    }
    return false;
  };

  const duplicateSelection = () => {
    const kind = focusKind();
    if (kind === 'bubble' && selBubbleId) dupBubble(selBubbleId);
    else if (kind === 'layer' && selLayerId) dupLayer(selLayerId);
    else if (kind === 'effect' && selEffectId) dupEffect(selEffectId);
    else if (kind === 'cut' && selCutId) dupCut(selCutId);
  };

  const zoomStep = (d: number) => setZoom((z) => Math.min(2, Math.max(0.2, +(z + d).toFixed(2))));

  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    const inType = tag === 'INPUT' ? (t as HTMLInputElement).type : '';
    const textEntry = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'color'].includes(inType)) || !!t?.isContentEditable;
    const anyInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.ctrlKey || e.metaKey;
    const code = e.code;

    if (code === 'Escape' && (helpOpen || exportOpen)) {
      setHelpOpen(false);
      setExportOpen(false);
      return;
    }
    if (helpOpen || exportOpen) return;
    if (mod && code === 'KeyS') {
      e.preventDefault();
      if (hasContent) void saveProject(e.shiftKey);
      return;
    }
    if (textEntry) return;

    if (code === 'Space' && !mod && !e.altKey && hasCuts) {
      e.preventDefault();
      if (!e.repeat) {
        spaceHeld.current = true;
        setPanning(true);
      }
      return;
    }

    if (mod) {
      if (code === 'KeyZ') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (code === 'KeyY') {
        e.preventDefault();
        redo();
      } else if (code === 'KeyD') {
        e.preventDefault();
        duplicateSelection();
      } else if (code === 'KeyC') {
        if (focusKind() === 'effect' && selEffectId && !window.getSelection()?.toString()) {
          e.preventDefault();
          copyEffect(selEffectId);
        }
      } else if (code === 'KeyV') {
        // 복사해 둔 효과가 있고 효과·컷 탭을 보고 있으면 효과를 붙여넣는다(이미지 붙여넣기는 그대로 동작)
        if (fxClipRef.current && (tab === 'effects' || tab === 'cuts')) {
          e.preventDefault();
          pasteEffects();
        }
      }
      return;
    }
    if (e.altKey) return;

    if (code === 'Escape') {
      setTool('select');
      setSelLayerId(null);
    } else if (code === 'Delete' || code === 'Backspace') {
      const kind = focusKind();
      if (kind === 'bubble' && selBubbleId) {
        e.preventDefault();
        deleteBubble(selBubbleId);
      } else if (kind === 'layer' && selLayerId) {
        e.preventDefault();
        deleteLayer(selLayerId);
      } else if (kind === 'effect' && selEffectId && tool === 'select') {
        e.preventDefault();
        deleteEffect(selEffectId);
        say('효과 레이어를 지웠어요 (Ctrl+Z 로 되돌릴 수 있어요)');
      }
    } else if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown') {
      if (anyInput) return;
      const d = e.shiftKey ? 10 : 1;
      const moved = nudge(code === 'ArrowLeft' ? -d : code === 'ArrowRight' ? d : 0, code === 'ArrowUp' ? -d : code === 'ArrowDown' ? d : 0);
      if (moved) e.preventDefault();
    } else if (e.key === '?' || (e.shiftKey && code === 'Slash')) {
      e.preventDefault();
      setHelpOpen(true);
    } else if (code === 'KeyC') {
      if (hasCuts && !e.repeat) setShowOriginal(true);
    } else if (code === 'Equal' || code === 'NumpadAdd') {
      zoomStep(0.1);
    } else if (code === 'Minus' || code === 'NumpadSubtract') {
      zoomStep(-0.1);
    } else if (code === 'Digit0' || code === 'Numpad0') {
      fitZoom();
    } else if (code === 'BracketLeft' && tool === 'brush') {
      setBrushSize((v) => Math.max(6, v - 6));
    } else if (code === 'BracketRight' && tool === 'brush') {
      setBrushSize((v) => Math.min(160, v + 6));
    } else if (!e.shiftKey) {
      const map: Record<string, Tool> = { KeyV: 'select', KeyW: 'wand', KeyL: 'lasso', KeyB: 'brush', KeyM: 'rect', KeyE: 'ellipse' };
      const next = map[code];
      if (next) {
        if (next !== 'select' && !hasCuts) {
          say('먼저 컷을 추가하세요');
          return;
        }
        setTool(next);
        if (next !== 'select') setTab('effects');
      }
    }
  };
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyC') setShowOriginal(false);
      if (e.code === 'Space') {
        if (spaceHeld.current) e.preventDefault(); // 버튼에 포커스가 있어도 눌림(클릭)으로 처리되지 않게
        spaceHeld.current = false;
        setPanning(false);
      }
    };
    const blur = () => {
      setShowOriginal(false);
      spaceHeld.current = false;
      setPanning(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  /* ---------- 붙여넣기 · 끌어놓기 · 휠 확대 ---------- */
  const actionsRef = useRef({ onFiles, importMaterials, loadProject, tab, say });
  actionsRef.current = { onFiles, importMaterials, loadProject, tab, say };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'color'].includes((t as HTMLInputElement).type)) || t.isContentEditable)) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      const a = actionsRef.current;
      if (a.tab === 'materials') void a.importMaterials(files);
      else void a.onFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => Math.min(2, Math.max(0.2, +(z * Math.exp(-e.deltaY * 0.0015)).toFixed(3))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const hasFiles = (e: RDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onAppDragOver = (e: RDragEvent) => {
    if (panelDragType(e.dataTransfer?.types)) {
      const at = clientToPage(e.clientX, e.clientY);
      if (at) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      } else e.dataTransfer.dropEffect = 'none';
      const label = dragLabel() || '소재';
      setDragHint((h) => (h && h.x === e.clientX && h.y === e.clientY && h.ok === !!at ? h : { x: e.clientX, y: e.clientY, label, ok: !!at }));
      return;
    }
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropActive(true);
  };
  const onAppDragLeave = (e: RDragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(false);
  };
  const onAppDrop = (e: RDragEvent) => {
    setDropActive(false);
    const kind = panelDragType(e.dataTransfer?.types);
    if (kind) {
      e.preventDefault();
      setDragHint(null);
      endPanelDrag();
      const at = clientToPage(e.clientX, e.clientY);
      if (!at) return say('웹툰 화면 위에 놓아 주세요');
      const data = e.dataTransfer.getData(kind);
      if (kind === DRAG_MAT) {
        const m = allMaterials.find((x) => x.id === data);
        if (m) void materialToPage(m, at);
      } else if (kind === DRAG_SFX) {
        try {
          const { text, style } = JSON.parse(data) as { text: string; style: string };
          addSfx(text, style, at);
        } catch {
          /* 잘못된 데이터는 무시 */
        }
      } else if (kind === DRAG_BUBBLE) {
        addBubble(data as BubbleKind, at);
      }
      return;
    }
    if (e.defaultPrevented || !hasFiles(e)) return; // 소재 칸·빈 화면은 자기 처리를 한다
    e.preventDefault();
    const files: File[] = Array.from(e.dataTransfer.files as FileList);
    const proj = files.find((f) => f.name.toLowerCase().endsWith('.wtoon'));
    if (proj) void loadProject(proj);
    else if (tab === 'materials') void importMaterials(files);
    else if (files.some((f) => f.type.startsWith('image/'))) void onFiles(files);
    else say('이미지가 아닌 파일은 “소재” 탭에 놓아 주세요');
  };

  /* ---------- 화면 이동: Space + 드래그 / 마우스 가운데 버튼 ---------- */
  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    let drag: { x: number; y: number; left: number; top: number; id: number } | null = null;
    const scroller = () => el.querySelector('.stageScroll') as HTMLElement | null;
    const down = (e: PointerEvent) => {
      const sc = scroller();
      if (!sc || !sc.contains(e.target as Node)) return;
      if (!(e.button === 1 || (e.button === 0 && spaceHeld.current))) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop, id: e.pointerId };
      el.classList.add('panDragging');
    };
    const move = (e: PointerEvent) => {
      const sc = scroller();
      if (!drag || !sc || e.pointerId !== drag.id) return;
      sc.scrollLeft = drag.left - (e.clientX - drag.x);
      sc.scrollTop = drag.top - (e.clientY - drag.y);
    };
    const up = (e: PointerEvent) => {
      if (drag && e.pointerId === drag.id) {
        drag = null;
        el.classList.remove('panDragging');
      }
    };
    // 가운데 버튼을 누르면 브라우저가 "자동 스크롤" 모드로 들어가므로 막는다
    const mid = (e: MouseEvent) => {
      if (e.button === 1 && scroller()?.contains(e.target as Node)) e.preventDefault();
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('mousedown', mid, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('mousedown', mid, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  /* ---------- 자동저장이 안 되는 환경에서는 닫기 전에 경고 ---------- */
  const guardUnload = dirty && autosaveFailed;
  useEffect(() => {
    if (!guardUnload) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [guardUnload]);

  /* ---------- 말풍선·의성어가 쓰는 글꼴을 화면에 불러온다 ---------- */
  useEffect(() => ensureFontsForBubbles(project.bubbles), [project.bubbles]);

  /* ---------- 패널에서 끌기를 취소했을 때 안내를 지운다 ---------- */
  useEffect(() => {
    const clear = () => {
      setDragHint(null);
      endPanelDrag();
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragHint(null);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    document.addEventListener('dragleave', leave);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      document.removeEventListener('dragleave', leave);
    };
  }, []);

  /* ---------- 첫 컷을 올리면 화면 폭에 맞춘다 ---------- */
  const hadCuts = useRef(false);
  useEffect(() => {
    if (project.cuts.length && !hadCuts.current) {
      hadCuts.current = true;
      window.requestAnimationFrame(() => {
        const w = centerRef.current?.clientWidth ?? 0;
        if (w > 0) setZoom(Math.max(0.2, Math.min(1, +((w - 56) / PAGE_WIDTH).toFixed(2))));
      });
    }
    if (!project.cuts.length) hadCuts.current = false;
  }, [project.cuts.length]);

  /* ---------- 자동 저장 / 복구 ---------- */
  useEffect(() => {
    let on = true;
    void loadAutosave().then((r) => {
      if (on && r && r.cuts > 0 && !projectRef.current.cuts.length && !projectRef.current.bubbles.length) setRecover(r);
    });
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (recover) return; // 복구 여부를 고르기 전에는 이전 기록을 덮어쓰지 않는다
    if (!hasContent) {
      if (hadContent.current) {
        hadContent.current = false;
        void clearAutosave();
        setSavedAt(null);
      }
      return;
    }
    hadContent.current = true;
    const t = window.setTimeout(() => {
      void saveAutosave(serializeProject(projectRef.current), projectRef.current.cuts.length).then((ok) => {
        if (ok) {
          setSavedAt(Date.now());
          setAutosaveFailed(false);
        } else if (!autosaveWarned.current) {
          setAutosaveFailed(true);
          autosaveWarned.current = true;
          say('자동저장을 할 수 없어요(브라우저 저장 공간). 중요한 작업은 “저장(.wtoon)”으로 파일에 저장하세요');
        }
      });
    }, 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, recover]);

  const saveText = recover ? '자동저장 대기 · 복구 여부를 골라 주세요' : savedAt ? `자동저장됨 ${new Date(savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '';

  const activeHint = TOOLS.find((t) => t.id === tool)?.hint;

  return (
    <div className={`app${panning ? ' panning' : ''}${dragHint?.ok ? ' dropping' : ''}`} data-tool={tool} onDragOver={onAppDragOver} onDragLeave={onAppDragLeave} onDrop={onAppDrop}>
      <header className="topbar">
        <strong className="brand">웹툰 스튜디오</strong>
        <button className="btn primary" onClick={() => fileRef.current?.click()} title="이미지를 컷으로 추가 (끌어다 놓기·붙여넣기도 돼요)">＋ 컷 추가</button>
        <span className="sep" />
        <button className="btn icon" onClick={undo} disabled={!past.current.length} title="실행취소 (Ctrl+Z)" aria-label="실행취소">↶</button>
        <button className="btn icon" onClick={redo} disabled={!future.current.length} title="다시 실행 (Ctrl+Y)" aria-label="다시 실행">↷</button>
        <span className="sep" />
        <div className="zoomGroup" title="확대/축소 (Ctrl+휠, +/−, 0 = 화면에 맞춤)">
          <button className="btn icon" onClick={() => zoomStep(-0.1)} aria-label="축소">−</button>
          <button className="zoom" onClick={fitZoom} title="화면에 맞추기 (0)">{Math.round(zoom * 100)}%</button>
          <button className="btn icon" onClick={() => zoomStep(0.1)} aria-label="확대">＋</button>
        </div>
        <button
          className={`btn ${showOriginal ? 'primary' : ''}`}
          title="누르고 있는 동안 효과 없는 원본을 보여줘요 (키보드 C)"
          disabled={!hasCuts}
          onPointerDown={() => setShowOriginal(true)}
          onPointerUp={() => setShowOriginal(false)}
          onPointerLeave={() => setShowOriginal(false)}
          onPointerCancel={() => setShowOriginal(false)}
        >
          원본 비교
        </button>
        <span className="grow" />
        {hasContent && (
          <span className={`fileState${dirty ? ' dirty' : ''}`} data-testid="file-state" title={dirty ? '마지막으로 파일에 저장한 뒤 바뀐 내용이 있어요 (Ctrl+S)' : '파일에 저장된 상태예요'}>
            {dirty ? '● 저장 안 됨' : `✓ ${fileName ?? '저장됨'}`}
          </span>
        )}
        {saveText && <span className="saveState" data-testid="save-state">{saveText}</span>}
        <button className="btn icon" onClick={() => setHelpOpen(true)} title="단축키 · 사용 팁 (?)" aria-label="도움말">?</button>
        <button className="btn" onClick={() => loadRef.current?.click()} title="프로젝트(.wtoon) 열기">열기</button>
        <button className="btn" onClick={() => void saveProject()} disabled={!hasContent} title={canOverwrite() ? '프로젝트 파일로 저장 — 한 번 위치를 정하면 같은 파일에 덮어써요 (Ctrl+S)' : '프로젝트 파일로 저장 (Ctrl+S)'}>저장</button>
        <button className="btn primary" onClick={() => setExportOpen(true)} disabled={!hasCuts} title="네이버·인스타 등 올릴 곳에 맞춰 이미지로 저장">내보내기</button>
        <MoreMenu
          label="⋯"
          title="다른 형식 · 샘플 · 새로 시작"
          items={[
            { label: 'JPG 한 장', hint: '전체를 그림 한 장으로', onClick: () => void doExport('jpg'), disabled: !hasCuts },
            { label: 'PNG 한 장', hint: '투명·무손실', onClick: () => void doExport('png'), disabled: !hasCuts },
            { label: 'PSD (레이어 유지)', hint: '포토샵·클립스튜디오용', onClick: () => void doExport('psd'), disabled: !hasCuts },
            ...(canOverwrite() ? [{ label: '다른 이름으로 저장…', hint: '저장 위치를 새로 골라요 (Ctrl+Shift+S)', onClick: () => void saveProject(true), disabled: !hasContent }] : []),
            { label: '샘플 장면 넣기', hint: '콜라 + 흔들림 효과 예시', onClick: () => addCuts([createSampleCut(true)]), divider: true },
            { label: '새로 시작', hint: 'Ctrl+Z 로 되돌릴 수 있어요', onClick: newProject, disabled: !hasContent, danger: true, divider: true },
          ]}
        />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void onFiles(e.target.files); e.target.value = ''; }} />
        <input ref={matFileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.psd,.zip,image/*,application/zip" multiple hidden onChange={(e) => { if (e.target.files) void importMaterials(Array.from(e.target.files)); e.target.value = ''; }} />
        <input ref={sheetFileRef} type="file" accept=".png,.jpg,.jpeg,.webp,.psd,image/*" hidden data-testid="sheet-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) setSheetFile(f); e.target.value = ''; }} />
        <input ref={layerFileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onLayerFile(f); e.target.value = ''; }} />
        <input ref={loadRef} type="file" accept=".wtoon,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadProject(f); e.target.value = ''; }} />
      </header>

      <nav className="toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} className={`tool ${tool === t.id ? 'toolOn' : ''}`} title={t.hint} onClick={() => {
            if (t.id !== 'select' && !project.cuts.length) { say('먼저 컷을 추가하세요'); return; }
            setTool(t.id);
            if (t.id !== 'select') { setTab('effects'); setSelLayerId(null); setSelBubbleId(null); }
          }}>
            <span className="toolIcon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <main className="center" ref={centerRef}>
        <div className="optbar">
          {tool === 'select' ? (
            <span>{activeHint} · 말풍선은 오른쪽 “말풍선” 탭에서 추가해요</span>
          ) : (
            <>
              <div className="seg">
                <button className={maskMode === 'add' ? 'on' : ''} onClick={() => setMaskMode('add')}>영역 추가</button>
                <button className={maskMode === 'sub' ? 'on' : ''} onClick={() => setMaskMode('sub')}>영역 빼기</button>
              </div>
              {tool === 'wand' && (
                <>
                  <label className="inline">
                    허용 오차 <input type="range" min={2} max={80} value={wand.tolerance} onChange={(e) => setWand({ ...wand, tolerance: parseInt(e.target.value, 10) })} /> <b>{wand.tolerance}</b>
                  </label>
                  <label className="inline"><input type="checkbox" checked={wand.contiguous} onChange={(e) => setWand({ ...wand, contiguous: e.target.checked })} /> 이어진 곳만</label>
                  <label className="inline" title="진한 윤곽선을 넘지 않아요"><input type="checkbox" checked={wand.lineBarrier} onChange={(e) => setWand({ ...wand, lineBarrier: e.target.checked })} /> 윤곽선에서 멈춤</label>
                  <label className="inline">
                    확장 <input type="range" min={-6} max={12} value={wand.grow} onChange={(e) => setWand({ ...wand, grow: parseInt(e.target.value, 10) })} /> <b>{wand.grow}px</b>
                  </label>
                </>
              )}
              {tool === 'brush' && (
                <label className="inline">
                  브러시 크기 <input type="range" min={6} max={160} value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value, 10))} /> <b>{brushSize}</b>
                </label>
              )}
              <span className="muted">{activeHint}{tool === 'wand' ? '' : ''} · Alt 를 누르고 그리면 반대 동작</span>
            </>
          )}
        </div>
        {recover && (
          <div className="recoverBar" role="status">
            <span>
              이전 작업이 남아 있어요 · {new Date(recover.savedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 컷 {recover.cuts}개
            </span>
            <button className="btn primary" onClick={() => void restoreAutosave()}>복구</button>
            <button className="btn" onClick={discardAutosave}>버리기</button>
          </div>
        )}
        {showOriginal && hasCuts && <div className="compareBadge">원본 보기 (효과 숨김)</div>}
        {hasCuts ? (
          <Stage
            project={project}
            zoom={zoom}
            tool={tool}
            maskMode={maskMode}
            brushSize={brushSize}
            selCutId={selCutId}
            selEffectId={selEffectId}
            selBubbleId={selBubbleId}
            selLayerId={selLayerId}
            showHandles={tab === 'effects'}
            showOriginal={showOriginal}
            onEditBubble={(id) => { setSelBubbleId(id); setSelLayerId(null); setTab(bubbleTab(id)); setFocusTick((n) => n + 1); }}
            wand={wand}
            targetCutId={tCut?.id ?? null}
            activeMask={activeMask}
            onSelectCut={(id) => { setSelCutId(id); if (id !== selCutId) setSelEffectId(null); }}
            onReorderCut={reorderCut}
            onSelectBubble={(id) => { setSelBubbleId(id); if (id) { setTab(bubbleTab(id)); setSelLayerId(null); } }}
            onSelectLayer={(id) => { setSelLayerId(id); if (id) { setTab('bg'); setSelBubbleId(null); } }}
            onMaskOp={onMaskOp}
            onParams={setParams}
            onBubbleChange={changeBubble}
            onLayerChange={changeLayer}
          />
        ) : (
          <div className="empty" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}>
            <h2>웹툰 컷을 올려서 시작하세요</h2>
            <p>이미지를 끌어다 놓거나 버튼으로 추가하세요. 가로 {PAGE_WIDTH}px 기준으로 위에서 아래로 이어 붙입니다.</p>
            <div className="row">
              <button className="btn primary" onClick={() => fileRef.current?.click()}>이미지 올리기</button>
              <button className="btn" onClick={() => addCuts([createSampleCut(true)])}>샘플 장면으로 체험하기</button>
            </div>
          </div>
        )}
        {toast && <div className="toast">{toast}</div>}
        {busy && <div className="busy">{busy}</div>}
      </main>

      <aside className="panel">
        <div className="tabs">
          {TAB_ORDER.map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <div className="panelBody">
          {tab === 'effects' && (
            <EffectPanel
              cut={tCut}
              selEffectId={selEffectId}
              activeMask={activeMask}
              maskTarget={maskTarget}
              onAdd={addEffect}
              onPreset={applyPreset}
              onSelect={(id) => {
                const cut = project.cuts.find((c) => c.effects.some((e) => e.id === id));
                if (cut) setSelCutId(cut.id);
                setSelEffectId(id);
                setSelLayerId(null);
              }}
              onParam={setParam}
              onOpacity={(id, v) => updateEffect(id, (e) => ({ ...e, opacity: v }), `opacity-${id}`)}
              onToggle={(id) => updateEffect(id, (e) => ({ ...e, visible: !e.visible }))}
              onDelete={deleteEffect}
              onDuplicate={dupEffect}
              onMove={moveEffect}
              onRename={(id, name) => updateEffect(id, (e) => ({ ...e, name }), `name-${id}`)}
              onFeather={(v) => editMaskProp({ feather: v }, 'feather')}
              onInvert={(v) => editMaskProp({ invert: v }, 'invert')}
              onGrow={growSelection}
              onFullMask={() => tCut && editOps((def, c) => [...def.ops, { kind: 'rect', mode: 'add', x: 0, y: 0, w: PAGE_WIDTH, h: c.height }])}
              onUndoOp={() => editOps((def) => def.ops.slice(0, -1))}
              onClearMask={() => editOps(() => [])}
              onResetCenter={(id) => setParams(id, { useCenter: false }, `center-${id}`)}
              fxClip={fxClip ? { count: fxClip.length, names: fxClip.map((e) => e.name).join(', ').slice(0, 40) } : null}
              onCopy={copyEffect}
              onPaste={() => pasteEffects()}
              onClearClip={() => setFxClip(null)}
              materials={allMaterials}
              onOpenMaterials={() => setTab('materials')}
              tool={tool}
              onTool={(t) => {
                if (t !== 'select' && !project.cuts.length) return say('먼저 컷을 추가하세요');
                setTool(t);
                setSelLayerId(null);
                setSelBubbleId(null);
              }}
            />
          )}
          {tab === 'materials' && (
            <MaterialPanel
              materials={allMaterials}
              selId={selMatId}
              hasCut={hasCuts}
              onSelect={setSelMatId}
              onPick={() => matFileRef.current?.click()}
              onPickSheet={() => sheetFileRef.current?.click()}
              onDropFiles={(f) => void importMaterials(f)}
              onToCut={(m, fit) => void materialToCut(m, fit)}
              onToPage={(m) => void materialToPage(m)}
              onToBack={(m) => void materialToPage(m, undefined, 'back')}
              onDelete={deleteMaterial}
            />
          )}
          {tab === 'sfx' && (
            <SfxPanel
              bubble={selSfx}
              styleId={sfxStyle}
              onStyle={setSfxStyle}
              onAdd={addSfx}
              onChange={(patch, co) => selSfx && changeBubble(selSfx.id, patch, co)}
              onFit={() => selSfx && commit((p) => ({ ...p, bubbles: p.bubbles.map((b) => (b.id === selSfx.id ? fitBubble(b) : b)) }))}
              onDuplicate={() => selSfx && dupBubble(selSfx.id)}
              onDelete={() => selSfx && deleteBubble(selSfx.id)}
              onZ={(dir) => selSfx && moveBubbleZ(selSfx.id, dir)}
              focusTick={focusTick}
              hasCut={hasCuts}
            />
          )}
          {tab === 'bubbles' && (
            <BubblePanel
              bubble={selBubble}
              onAdd={addBubble}
              onChange={(patch, co) => selBubble && changeBubble(selBubble.id, patch, co)}
              onFit={() => selBubble && commit((p) => ({ ...p, bubbles: p.bubbles.map((b) => (b.id === selBubble.id ? fitBubble(b) : b)) }))}
              focusTick={focusTick}
              onDuplicate={() => selBubble && dupBubble(selBubble.id)}
              onDelete={() => selBubble && deleteBubble(selBubble.id)}
              onZ={(dir) => selBubble && moveBubbleZ(selBubble.id, dir)}
            />
          )}
          {tab === 'bg' && (
            <BgPanel
              project={project}
              selLayerId={selLayerId}
              onSelect={(id) => { setSelLayerId(id); setTool('select'); }}
              onAdd={addLayer}
              onUploadImage={() => { replaceLayerId.current = null; layerFileRef.current?.click(); }}
              onReplaceImage={(id) => { replaceLayerId.current = id; layerFileRef.current?.click(); }}
              onChange={changeLayer}
              onDelete={deleteLayer}
              onMove={(id, dir) =>
                commit((p) => {
                  const i = p.layers.findIndex((l) => l.id === id);
                  const j = i + dir;
                  if (j < 0 || j >= p.layers.length) return p;
                  const arr = [...p.layers];
                  [arr[i], arr[j]] = [arr[j], arr[i]];
                  return { ...p, layers: arr };
                })
              }
              onDuplicate={dupLayer}
              onPage={(patch, key) => commit((p) => ({ ...p, ...patch }), key)}
            />
          )}
          {tab === 'cuts' && (
            <CutPanel
              project={project}
              selCutId={selCutId}
              onSelect={(id) => { setSelCutId(id); setSelEffectId(null); setSelLayerId(null); scrollToCut(id); }}
              onReorder={reorderCut}
              onDuplicate={dupCut}
              onDelete={deleteCut}
              onGap={(v) => commit((p) => ({ ...p, gap: v }), 'gap')}
              onGapBefore={setGapBefore}
              onResetGaps={() =>
                commit((p) => ({
                  ...p,
                  cuts: p.cuts.map((c) => {
                    if (c.gapBefore === undefined) return c;
                    const { gapBefore: _g, ...rest } = c;
                    void _g;
                    return rest;
                  }),
                }))
              }
              hasFxClip={!!fxClip}
              onPasteTo={(id) => pasteEffects(id)}
              onCut={(id, patch, co) => updateCut(id, (c) => ({ ...c, ...patch }), co ? `cut-${id}-${Object.keys(patch).join(',')}` : undefined)}
              onSplit={(id, at) => void doSplitCut(id, at)}
              onSlantJoint={slantJoint}
            />
          )}
        </div>
      </aside>
      {dragHint && (
        <div className={`dragHint${dragHint.ok ? '' : ' no'}`} style={{ left: dragHint.x + 16, top: dragHint.y + 18 }}>
          {dragHint.ok ? `여기에 놓기 · ${dragHint.label}` : '웹툰 화면 위로 가져오세요'}
        </div>
      )}
      {dropActive && <div className="dropOverlay">여기에 놓으세요 · 이미지는 컷으로, .wtoon 은 불러오기, “소재” 탭에서는 소재로 가져와요</div>}
      {sheetFile && (
        <SheetDialog
          file={sheetFile}
          onClose={() => setSheetFile(null)}
          onDone={(items) => {
            setLibrary((l) => [...l, ...items]);
            void saveToLibrary(items);
            setSelMatId(items[items.length - 1]?.id ?? null);
            setTab('materials');
            say(`효과음 소재 ${items.length}개를 등록했어요 · 소재 탭에서 컷에 붙이세요`);
          }}
        />
      )}
      {exportOpen && <ExportDialog project={project} onClose={() => setExportOpen(false)} onDone={say} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
