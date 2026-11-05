'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent, ReactElement } from 'react';
import { PAGE_WIDTH, type Bubble, type Cut, type Effect, type EffectParams, type MaskDef, type MaskMode, type MaskOp, type PageLayer, type Project } from '@/lib/types';
import { cutFrame, layoutCuts } from '@/lib/project';
import { getBase, putRGBA } from '@/lib/imageIO';
import { renderAsync } from '@/lib/renderClient';
import { getMaterial, materialsSnapshot, subscribeMaterials } from '@/lib/materials';
import { getMask } from '@/lib/mask';
import { bubbleMarkup } from '@/lib/bubble';
import { EFFECT_META } from '@/lib/effectMeta';
import { wandOp, type WandOptions } from '@/lib/select';
import { drawPageLayer, hitLayer, layerBounds, onLayerImageLoaded, preloadLayerImages } from '@/lib/pagelayers';

export type Tool = 'select' | 'wand' | 'lasso' | 'brush' | 'rect' | 'ellipse';
export const MASK_TOOLS: Tool[] = ['wand', 'lasso', 'brush', 'rect', 'ellipse'];

interface Draft {
  tool: Tool;
  pts: number[];
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  mode: MaskMode;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/* ------------------------------ 컷 ------------------------------ */

interface CutViewProps {
  cut: Cut;
  top: number;
  zoom: number;
  tool: Tool;
  maskMode: MaskMode;
  brushSize: number;
  wand: WandOptions;
  selected: boolean;
  showHandles: boolean;
  /** true 면 효과 없이 원본 그림을 보여준다(비교용) */
  showOriginal: boolean;
  /** 이 컷이 영역을 그리는 대상일 때의 마스크(효과 레이어 또는 임시 선택) */
  activeMask: MaskDef | null;
  selEffect: Effect | null;
  onOp: (op: MaskOp) => void;
  onParams: (effectId: string, patch: Partial<EffectParams>, key: string) => void;
}

function CutView({ cut, top, zoom, tool, maskMode, brushSize, wand, selected, showHandles, showOriginal, activeMask, selEffect, onOp, onParams }: CutViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<{ mask: object; img: ImageData } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const f = cutFrame(cut);

  const canDraw = MASK_TOOLS.includes(tool) && selected;

  // 효과가 적용된 컷 그리기 (Web Worker 에서 계산 → 최신 결과만 반영)
  const [rendering, setRendering] = useState(false);
  const matVer = useSyncExternalStore(subscribeMaterials, materialsSnapshot, () => 0);
  useEffect(() => {
    let alive = true;
    getBase(cut).then((base) => {
      if (!alive || !canvasRef.current) return;
      if (showOriginal || !cut.effects.some((e) => e.visible)) {
        putRGBA(canvasRef.current, base);
        setRendering(false);
        return;
      }
      setRendering(true);
      void renderAsync(cut.id, base, cut.effects).then((out) => {
        if (!out) return; // 더 최신 요청이 있어서 건너뜀
        if (canvasRef.current) putRGBA(canvasRef.current, out);
        if (alive) setRendering(false);
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cut, matVer, showOriginal]);

  // 영역 표시(붉은 막) + 그리는 중인 도형
  useEffect(() => {
    const cv = overlayRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (activeMask && selected && tool !== 'select') {
      let tint = tintRef.current;
      if (!tint || tint.mask !== activeMask) {
        const { mask } = getMask(activeMask, PAGE_WIDTH, cut.height);
        const d = new Uint8ClampedArray(PAGE_WIDTH * cut.height * 4);
        for (let i = 0; i < mask.length; i++) {
          const a = mask[i];
          if (a > 0.01) {
            d[i * 4] = 255;
            d[i * 4 + 1] = 40;
            d[i * 4 + 2] = 90;
            d[i * 4 + 3] = a * 105;
          }
        }
        tint = { mask: activeMask, img: new ImageData(d, PAGE_WIDTH, cut.height) };
        tintRef.current = tint;
      }
      ctx.putImageData(tint.img, 0, 0);
    }
    const col = draft?.mode === 'sub' ? '40,120,255' : '255,40,90';
    if (draft) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (draft.tool === 'brush') {
        ctx.strokeStyle = `rgba(${col},0.45)`;
        ctx.lineWidth = brushSize;
        ctx.beginPath();
        for (let i = 0; i < draft.pts.length; i += 2) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, draft.pts[i], draft.pts[i + 1]);
        if (draft.pts.length === 2) ctx.lineTo(draft.pts[0] + 0.01, draft.pts[1]);
        ctx.stroke();
      } else if (draft.tool !== 'wand') {
        ctx.beginPath();
        if (draft.tool === 'lasso') {
          for (let i = 0; i < draft.pts.length; i += 2) (i === 0 ? ctx.moveTo : ctx.lineTo).call(ctx, draft.pts[i], draft.pts[i + 1]);
          ctx.closePath();
        } else if (draft.tool === 'rect') {
          ctx.rect(draft.sx, draft.sy, draft.cx - draft.sx, draft.cy - draft.sy);
        } else {
          ctx.ellipse((draft.sx + draft.cx) / 2, (draft.sy + draft.cy) / 2, Math.abs(draft.cx - draft.sx) / 2, Math.abs(draft.cy - draft.sy) / 2, 0, 0, Math.PI * 2);
        }
        ctx.fillStyle = `rgba(${col},0.22)`;
        ctx.fill();
        ctx.lineWidth = 2 / zoom;
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.strokeStyle = '#111';
        ctx.lineDashOffset = 7;
        ctx.stroke();
      }
      ctx.restore();
    }
    if (hover && tool === 'brush' && canDraw && !draft) {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, brushSize / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, brushSize / 2 + 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [activeMask, selected, draft, hover, cut.height, brushSize, tool, canDraw, zoom]);

  const toCut = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * PAGE_WIDTH, y: ((clientY - r.top) / r.height) * cut.height };
  };
  const pt = (e: RPointerEvent) => toCut(e.clientX, e.clientY);

  const down = (e: RPointerEvent) => {
    if (e.button !== 0 || !canDraw) return;
    const p = pt(e);
    const mode: MaskMode = e.altKey ? (maskMode === 'add' ? 'sub' : 'add') : maskMode;
    if (tool === 'wand') {
      void getBase(cut).then((base) => onOp(wandOp(base, p.x, p.y, wand, mode)));
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const d: Draft = { tool, pts: [p.x, p.y], sx: p.x, sy: p.y, cx: p.x, cy: p.y, mode };
    draftRef.current = d;
    setDraft(d);
  };
  const move = (e: RPointerEvent) => {
    const p = pt(e);
    setHover(p);
    const d = draftRef.current;
    if (!d) return;
    const n: Draft = { ...d, cx: p.x, cy: p.y };
    if (d.tool === 'lasso' || d.tool === 'brush') {
      const lx = d.pts[d.pts.length - 2];
      const ly = d.pts[d.pts.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) >= (d.tool === 'brush' ? Math.max(1.5, brushSize / 8) : 2.5)) n.pts = [...d.pts, p.x, p.y];
    }
    draftRef.current = n;
    setDraft(n);
  };
  const up = () => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!d) return;
    if (d.tool === 'lasso' && d.pts.length >= 6) onOp({ kind: 'poly', mode: d.mode, points: d.pts.map((v) => Math.round(v * 10) / 10) });
    else if (d.tool === 'brush') onOp({ kind: 'stroke', mode: d.mode, radius: brushSize / 2, points: d.pts.map((v) => Math.round(v * 10) / 10) });
    else if (d.tool === 'rect' || d.tool === 'ellipse') {
      const x = Math.min(d.sx, d.cx);
      const y = Math.min(d.sy, d.cy);
      const w = Math.abs(d.cx - d.sx);
      const h = Math.abs(d.cy - d.sy);
      if (w > 3 && h > 3) onOp({ kind: d.tool, mode: d.mode, x, y, w, h });
    }
  };

  /* ---- 화면에서 직접 끄는 핸들(방향 화살표 / 중심) ---- */
  const meta = selEffect ? EFFECT_META[selEffect.type] : null;
  const handle = meta?.handle;
  let hv: ReactElement | null = null;
  const showHandle = !!(selEffect && handle && selected && showHandles);
  if (showHandle && selEffect && handle) {
    const { bounds } = getMask(selEffect.mask, PAGE_WIDTH, cut.height);
    const p = selEffect.params;
    const ax = bounds ? (bounds.x0 + bounds.x1) / 2 : PAGE_WIDTH / 2;
    const ay = bounds ? (bounds.y0 + bounds.y1) / 2 : cut.height / 2;
    const r = 9 / zoom;
    const sw = 2.5 / zoom;
    const mat = selEffect.type === 'material' && p.materialId ? getMaterial(p.materialId) : null;
    if (mat) {
      /* ---- 소재: 화면에서 끌어 옮기기 / 모서리로 크기 / 위 동그라미로 회전 ---- */
      void matVer;
      const W = PAGE_WIDTH;
      const H = cut.height;
      const coverK = p.matFit === 'cover' ? Math.max(W / mat.width, H / mat.height) : 1;
      const s = Math.max(0.02, p.matScale / 100) * coverK;
      const bw = mat.width * s;
      const bh = mat.height * s;
      // 렌더러(effects.ts material)와 같은 기준점: 직접 정한 중심 > 가득 채우기는 컷 중앙 > 영역 무게중심
      const mcx = p.useCenter ? p.centerX : p.matFit === 'cover' ? W / 2 : bounds ? bounds.cx : ax;
      const mcy = p.useCenter ? p.centerY : p.matFit === 'cover' ? H / 2 : bounds ? bounds.cy : ay;
      const rot = p.rotation || 0;
      const hs = 12 / zoom;
      const key = `handle-${selEffect.id}`;
      const drag = (e: RPointerEvent, kind: 'move' | 'scale' | 'rotate') => {
        e.stopPropagation();
        e.preventDefault();
        const start = toCut(e.clientX, e.clientY);
        const o = { cx: mcx, cy: mcy, scale: p.matScale, rot };
        const d0 = Math.max(1, Math.hypot(start.x - o.cx, start.y - o.cy));
        const a0 = Math.atan2(start.y - o.cy, start.x - o.cx);
        const mv = (ev: PointerEvent) => {
          const c = toCut(ev.clientX, ev.clientY);
          if (kind === 'move') {
            onParams(selEffect.id, { useCenter: true, centerX: Math.round(o.cx + c.x - start.x), centerY: Math.round(o.cy + c.y - start.y) }, key);
          } else if (kind === 'scale') {
            const k = Math.hypot(c.x - o.cx, c.y - o.cy) / d0;
            onParams(selEffect.id, { useCenter: true, centerX: Math.round(o.cx), centerY: Math.round(o.cy), matScale: clamp(Math.round(o.scale * k), 5, 800) }, key);
          } else {
            let deg = o.rot + ((Math.atan2(c.y - o.cy, c.x - o.cx) - a0) * 180) / Math.PI;
            if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
            deg = ((((Math.round(deg) + 180) % 360) + 360) % 360) - 180;
            onParams(selEffect.id, { useCenter: true, centerX: Math.round(o.cx), centerY: Math.round(o.cy), rotation: deg }, key);
          }
        };
        const end = () => {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      };
      const corners: [number, number, string][] = [
        [-bw / 2, -bh / 2, 'nwse-resize'],
        [bw / 2, -bh / 2, 'nesw-resize'],
        [bw / 2, bh / 2, 'nwse-resize'],
        [-bw / 2, bh / 2, 'nesw-resize'],
      ];
      const rotY = -bh / 2 - 30 / zoom;
      hv = (
        <g transform={`translate(${mcx} ${mcy}) rotate(${rot})`}>
          <rect x={-bw / 2} y={-bh / 2} width={bw} height={bh} fill="transparent" stroke="#fff" strokeWidth={sw + 2 / zoom} pointerEvents="none" />
          <rect
            x={-bw / 2}
            y={-bh / 2}
            width={bw}
            height={bh}
            fill="transparent"
            stroke="#2e7dff"
            strokeWidth={sw}
            strokeDasharray={`${8 / zoom} ${5 / zoom}`}
            style={{ cursor: 'move', pointerEvents: tool === 'select' ? 'all' : 'stroke' }}
            onPointerDown={(e) => drag(e, 'move')}
          />
          <line x1={0} y1={-bh / 2} x2={0} y2={rotY} stroke="#2e7dff" strokeWidth={sw} pointerEvents="none" />
          <circle cx={0} cy={rotY} r={r} fill="#fff" stroke="#2e7dff" strokeWidth={2 / zoom} style={{ cursor: 'grab', pointerEvents: 'all' }} onPointerDown={(e) => drag(e, 'rotate')}>
            <title>끌어서 회전 (Shift: 15° 단위)</title>
          </circle>
          {corners.map(([hx, hy, cur], i) => (
            <rect key={i} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} fill="#fff" stroke="#2e7dff" strokeWidth={2 / zoom} style={{ cursor: cur, pointerEvents: 'all' }} onPointerDown={(e) => drag(e, 'scale')}>
              <title>끌어서 크기 조절</title>
            </rect>
          ))}
          <circle cx={0} cy={0} r={4 / zoom} fill="#2e7dff" stroke="#fff" strokeWidth={1.5 / zoom} pointerEvents="none" />
        </g>
      );
    } else if (handle.kind === 'dir') {
      const a = (p.angle * Math.PI) / 180;
      const distKey = handle.distKey;
      const len = distKey ? Math.max(34 / zoom, p[distKey] as number) : 110 / zoom;
      const tx = ax + Math.cos(a) * len;
      const ty = ay + Math.sin(a) * len;
      const head = 13 / zoom;
      const ha = Math.atan2(ty - ay, tx - ax);
      const startDrag = (e: RPointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const mv = (ev: PointerEvent) => {
          const c = toCut(ev.clientX, ev.clientY);
          const dx = c.x - ax;
          const dy = c.y - ay;
          const patch: Partial<EffectParams> = { angle: Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360) };
          if (distKey) (patch as Record<string, number>)[distKey] = clamp(Math.round(Math.hypot(dx, dy)), handle.min ?? 1, handle.max ?? 400);
          onParams(selEffect.id, patch, `handle-${selEffect.id}`);
        };
        const end = () => {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', end);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', end);
      };
      hv = (
        <g>
          <line x1={ax} y1={ay} x2={tx} y2={ty} stroke="#fff" strokeWidth={sw + 3 / zoom} strokeLinecap="round" />
          <line x1={ax} y1={ay} x2={tx} y2={ty} stroke="#2e7dff" strokeWidth={sw} strokeLinecap="round" />
          <circle cx={ax} cy={ay} r={4 / zoom} fill="#2e7dff" stroke="#fff" strokeWidth={1.5 / zoom} />
          <path
            d={`M ${tx} ${ty} L ${tx - Math.cos(ha - 0.45) * head} ${ty - Math.sin(ha - 0.45) * head} L ${tx - Math.cos(ha + 0.45) * head} ${ty - Math.sin(ha + 0.45) * head} Z`}
            fill="#2e7dff"
            stroke="#fff"
            strokeWidth={1.5 / zoom}
            pointerEvents="none"
          />
          <circle cx={tx} cy={ty} r={r} fill="#2e7dff" fillOpacity={0.35} stroke="#fff" strokeWidth={2 / zoom} style={{ cursor: 'grab', pointerEvents: 'all' }} onPointerDown={startDrag} />
        </g>
      );
    } else {
      const cx = p.useCenter ? p.centerX : ax;
      const cy = p.useCenter ? p.centerY : ay;
      const startDrag = (e: RPointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const mv = (ev: PointerEvent) => {
          const c = toCut(ev.clientX, ev.clientY);
          onParams(selEffect.id, { useCenter: true, centerX: Math.round(c.x), centerY: Math.round(c.y) }, `handle-${selEffect.id}`);
        };
        const end = () => {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', end);
        };
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', end);
      };
      hv = (
        <g>
          <line x1={cx - 22 / zoom} y1={cy} x2={cx + 22 / zoom} y2={cy} stroke="#fff" strokeWidth={sw + 3 / zoom} />
          <line x1={cx} y1={cy - 22 / zoom} x2={cx} y2={cy + 22 / zoom} stroke="#fff" strokeWidth={sw + 3 / zoom} />
          <line x1={cx - 22 / zoom} y1={cy} x2={cx + 22 / zoom} y2={cy} stroke="#2e7dff" strokeWidth={sw} />
          <line x1={cx} y1={cy - 22 / zoom} x2={cx} y2={cy + 22 / zoom} stroke="#2e7dff" strokeWidth={sw} />
          <circle cx={cx} cy={cy} r={r} fill="#2e7dff" fillOpacity={0.3} stroke="#fff" strokeWidth={2 / zoom} style={{ cursor: 'grab', pointerEvents: 'all' }} onPointerDown={startDrag} />
        </g>
      );
    }
  }

  return (
    <div ref={boxRef} className="cut" data-cut={cut.id} style={{ top, width: PAGE_WIDTH, height: cut.height }}>
      <div className="cutClip" style={{ clipPath: `inset(0 ${f.inset}px 0 ${f.inset}px round ${f.radius}px)` }}>
        <canvas ref={canvasRef} width={PAGE_WIDTH} height={cut.height} className="cutCanvas" />
        <canvas ref={overlayRef} width={PAGE_WIDTH} height={cut.height} className="cutOverlay" />
      </div>
      {f.border > 0 && (
        <div className="cutBorder" style={{ left: f.inset, right: f.inset, border: `${f.border}px solid ${f.borderColor}`, borderRadius: f.radius }} />
      )}
      {rendering && <div className="cutBusy" style={{ fontSize: 12 / zoom, padding: `${4 / zoom}px ${8 / zoom}px`, right: f.inset + 8 / zoom, top: 8 / zoom }}>효과 계산 중…</div>}
      {selected && <div className="cutSelBox" style={{ left: f.inset, right: f.inset, borderRadius: f.radius, outlineWidth: 2 / zoom }} />}
      {canDraw && (
        <div
          className="cutLayer"
          style={{ cursor: 'crosshair' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={() => setHover(null)}
        />
      )}
      {hv && (
        <svg className="cutHandles" width={PAGE_WIDTH} height={cut.height} viewBox={`0 0 ${PAGE_WIDTH} ${cut.height}`}>
          {hv}
        </svg>
      )}
    </div>
  );
}

/* ------------------------------ 페이지 배경/장식 레이어 ------------------------------ */

const CSS_BLEND: Record<PageLayer['blend'], string> = {
  normal: 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  'soft-light': 'soft-light',
  add: 'plus-lighter',
};

function LayerCanvas({ layer, total }: { layer: PageLayer; total: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, bump] = useState(0);
  const b = layerBounds(layer, PAGE_WIDTH, total);

  useEffect(() => {
  void preloadLayerImages([layer]);

  const unsubscribe = onLayerImageLoaded(() => {
    bump((n) => n + 1);
  });

  return () => {
    unsubscribe();
  };
}, [layer.src, layer]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(-b.x, -b.y);
    drawPageLayer(ctx, layer, PAGE_WIDTH, total, false);
    ctx.restore();
  }, [layer, total, tick, b.x, b.y, b.w, b.h]);

  if (!layer.visible || b.w <= 0 || b.h <= 0) return null;
  return (
    <canvas
      ref={ref}
      width={b.w}
      height={b.h}
      style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, opacity: layer.opacity, mixBlendMode: CSS_BLEND[layer.blend] as CSSProperties['mixBlendMode'], pointerEvents: 'none' }}
    />
  );
}

/* ------------------------------ 무대 ------------------------------ */

export interface StageProps {
  project: Project;
  zoom: number;
  tool: Tool;
  maskMode: MaskMode;
  brushSize: number;
  wand: WandOptions;
  selCutId: string | null;
  selEffectId: string | null;
  selBubbleId: string | null;
  selLayerId: string | null;
  showHandles: boolean;
  showOriginal: boolean;
  /** 말풍선을 더블클릭하면 글자 편집으로 */
  onEditBubble: (id: string) => void;
  /** 영역을 그리는 대상 컷과 그 마스크 */
  targetCutId: string | null;
  activeMask: MaskDef | null;
  onSelectCut: (id: string | null) => void;
  /** 컷을 to 번째(맨 위 = 0)로 옮긴다 */
  onReorderCut: (id: string, to: number) => void;
  onSelectBubble: (id: string | null) => void;
  onSelectLayer: (id: string | null) => void;
  onMaskOp: (cutId: string, op: MaskOp) => void;
  onParams: (effectId: string, patch: Partial<EffectParams>, key: string) => void;
  onBubbleChange: (id: string, patch: Partial<Bubble>, coalesce?: boolean) => void;
  onLayerChange: (id: string, patch: Partial<PageLayer>, coalesce?: boolean) => void;
}

export default function Stage(props: StageProps) {
  const { project, zoom, tool, selBubbleId, selLayerId } = props;
  const stripRef = useRef<HTMLDivElement>(null);
  const { items, total } = layoutCuts(project);
  const selBubble = project.bubbles.find((b) => b.id === selBubbleId) ?? null;
  const selLayer = project.layers.find((l) => l.id === selLayerId) ?? null;

  const toPage = (clientX: number, clientY: number) => {
    const r = stripRef.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * PAGE_WIDTH, y: ((clientY - r.top) / r.height) * total };
  };

  /** 컷 순서 바꾸기: 컷 왼쪽 위 손잡이를 끌어 놓을 자리를 고른다 */
  const [cutDrag, setCutDrag] = useState<{ id: string; target: number } | null>(null);
  const startCutDrag = (e: RPointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    props.onSelectCut(id);
    const calc = (clientY: number) => {
      const y = toPage(0, clientY).y;
      let t = 0;
      for (const o of items) if (o.cut.id !== id && o.top + o.cut.height / 2 < y) t++;
      return t;
    };
    setCutDrag({ id, target: calc(e.clientY) });
    const move = (ev: PointerEvent) => setCutDrag({ id, target: calc(ev.clientY) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const t = calc(ev.clientY);
      setCutDrag(null);
      props.onReorderCut(id, t);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const dropLineY = (() => {
    if (!cutDrag) return null;
    const others = items.filter((o) => o.cut.id !== cutDrag.id);
    if (!others.length) return null;
    const half = project.gap / 2;
    if (cutDrag.target <= 0) return Math.max(0, others[0].top - half);
    const prev = others[Math.min(cutDrag.target, others.length) - 1];
    return prev.top + prev.cut.height + half;
  })();

  const startDrag = (e: RPointerEvent, kind: 'move' | 'tail' | 'resize', b: Bubble, corner = 0) => {
    e.stopPropagation();
    e.preventDefault();
    props.onSelectBubble(b.id);
    const start = toPage(e.clientX, e.clientY);
    const orig = { ...b };
    const onMove = (ev: PointerEvent) => {
      const p = toPage(ev.clientX, ev.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (kind === 'move') {
        props.onBubbleChange(b.id, { x: orig.x + dx, y: orig.y + dy, tailX: orig.tailX + dx, tailY: orig.tailY + dy }, true);
      } else if (kind === 'tail') {
        props.onBubbleChange(b.id, { tailX: orig.tailX + dx, tailY: orig.tailY + dy }, true);
      } else {
        let x = orig.x;
        let y = orig.y;
        let w = orig.w;
        let h = orig.h;
        if (corner === 0 || corner === 2) {
          x = Math.min(orig.x + dx, orig.x + orig.w - 60);
          w = orig.w - (x - orig.x);
        } else w = Math.max(60, orig.w + dx);
        if (corner === 0 || corner === 1) {
          y = Math.min(orig.y + dy, orig.y + orig.h - 50);
          h = orig.h - (y - orig.y);
        } else h = Math.max(50, orig.h + dy);
        props.onBubbleChange(b.id, { x, y, w, h }, true);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** 배경/장식 레이어 이동·크기·회전 */
  const startLayerDrag = (e: RPointerEvent, kind: 'move' | 'resize' | 'rotate', l: PageLayer, corner = 0) => {
    e.stopPropagation();
    e.preventDefault();
    props.onSelectLayer(l.id);
    if (l.full) return;
    const start = toPage(e.clientX, e.clientY);
    const o = { ...l };
    const rot = (o.rotation * Math.PI) / 180;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const cx0 = o.x + o.w / 2;
    const cy0 = o.y + o.h / 2;
    const onMove = (ev: PointerEvent) => {
      const p = toPage(ev.clientX, ev.clientY);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      if (kind === 'move') {
        props.onLayerChange(l.id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) }, true);
      } else if (kind === 'rotate') {
        let a = (Math.atan2(p.y - cy0, p.x - cx0) * 180) / Math.PI + 90;
        if (ev.shiftKey) a = Math.round(a / 15) * 15;
        a = ((a + 540) % 360) - 180;
        props.onLayerChange(l.id, { rotation: Math.round(a) }, true);
      } else {
        // 회전된 좌표계에서 반대쪽 모서리를 고정하고 크기를 바꾼다
        const sx = corner === 0 || corner === 2 ? -1 : 1;
        const sy = corner === 0 || corner === 1 ? -1 : 1;
        const ldx = dx * cos + dy * sin;
        const ldy = -dx * sin + dy * cos;
        const w = Math.max(20, o.w + sx * ldx);
        const h = Math.max(20, o.h + sy * ldy);
        const lcx = (sx * (w - o.w)) / 2;
        const lcy = (sy * (h - o.h)) / 2;
        const ncx = cx0 + lcx * cos - lcy * sin;
        const ncy = cy0 + lcx * sin + lcy * cos;
        props.onLayerChange(l.id, { x: Math.round(ncx - w / 2), y: Math.round(ncy - h / 2), w: Math.round(w), h: Math.round(h) }, true);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** 선택 도구일 때: 앞 레이어 → 컷 → 뒤 레이어 순으로 클릭 대상을 고른다 */
  const onStripDown = (e: RPointerEvent) => {
    if (tool !== 'select' || e.button !== 0) return;
    const p = toPage(e.clientX, e.clientY);
    const front = [...project.layers].reverse().find((l) => l.visible && l.z === 'front' && !l.full && hitLayer([l], p.x, p.y));
    if (front) return startLayerDrag(e, 'move', front);
    const hitCut = items.find(({ cut, top }) => {
      const f = cutFrame(cut);
      return p.y >= top && p.y <= top + cut.height && p.x >= f.inset && p.x <= PAGE_WIDTH - f.inset;
    });
    if (hitCut) {
      props.onSelectCut(hitCut.cut.id);
      props.onSelectBubble(null);
      props.onSelectLayer(null);
      return;
    }
    const back = hitLayer(project.layers.filter((l) => !l.full), p.x, p.y);
    if (back) return startLayerDrag(e, 'move', back);
    props.onSelectBubble(null);
    props.onSelectLayer(null);
  };

  const hs = 8 / zoom;
  const layerFront = project.layers.filter((l) => l.z === 'front');
  const layerBack = project.layers.filter((l) => l.z === 'back');

  // 레이어 선택 상자
  let layerBox: ReactElement | null = null;
  if (selLayer && tool === 'select') {
    if (selLayer.full) {
      layerBox = <rect x={0} y={0} width={PAGE_WIDTH} height={total} fill="none" stroke="#ff9f1c" strokeWidth={3 / zoom} strokeDasharray={`${8 / zoom} ${6 / zoom}`} pointerEvents="none" />;
    } else {
      const l = selLayer;
      const cx = l.x + l.w / 2;
      const cy = l.y + l.h / 2;
      const corners: [number, number][] = [
        [-l.w / 2, -l.h / 2],
        [l.w / 2, -l.h / 2],
        [-l.w / 2, l.h / 2],
        [l.w / 2, l.h / 2],
      ];
      const cur = ['nwse-resize', 'nesw-resize', 'nesw-resize', 'nwse-resize'];
      layerBox = (
        <g transform={`translate(${cx} ${cy}) rotate(${l.rotation})`} style={{ pointerEvents: 'all' }}>
          <rect x={-l.w / 2} y={-l.h / 2} width={l.w} height={l.h} fill="transparent" stroke="#ff9f1c" strokeWidth={2 / zoom} strokeDasharray={`${7 / zoom} ${5 / zoom}`} style={{ cursor: 'move' }} onPointerDown={(e) => startLayerDrag(e, 'move', l)} />
          <line x1={0} y1={-l.h / 2} x2={0} y2={-l.h / 2 - 26 / zoom} stroke="#ff9f1c" strokeWidth={2 / zoom} pointerEvents="none" />
          <circle cx={0} cy={-l.h / 2 - 26 / zoom} r={hs * 0.8} fill="#fff" stroke="#ff9f1c" strokeWidth={2 / zoom} style={{ cursor: 'grab' }} onPointerDown={(e) => startLayerDrag(e, 'rotate', l)} />
          {corners.map(([hx, hy], i) => (
            <rect key={i} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} fill="#fff" stroke="#ff9f1c" strokeWidth={2 / zoom} style={{ cursor: cur[i] }} onPointerDown={(e) => startLayerDrag(e, 'resize', l, i)} />
          ))}
        </g>
      );
    }
  }

  return (
    <div className="stageScroll" onPointerDown={(e) => { if (e.target === e.currentTarget) { props.onSelectBubble(null); props.onSelectLayer(null); } }}>
      <div style={{ width: PAGE_WIDTH * zoom, height: total * zoom, margin: '28px auto 120px', position: 'relative' }}>
        <div ref={stripRef} className="strip" style={{ width: PAGE_WIDTH, height: total, transform: `scale(${zoom})`, transformOrigin: '0 0', background: project.bg || '#fff' }} onPointerDown={onStripDown}>
          {layerBack.map((l) => (
            <LayerCanvas key={l.id} layer={l} total={total} />
          ))}
          {items.map(({ cut, top }) => {
            const isTarget = cut.id === props.targetCutId;
            const selEffect = isTarget ? cut.effects.find((e) => e.id === props.selEffectId) ?? null : null;
            return (
              <CutView
                key={cut.id}
                cut={cut}
                top={top}
                zoom={zoom}
                tool={tool}
                maskMode={props.maskMode}
                brushSize={props.brushSize}
                wand={props.wand}
                selected={isTarget && (cut.id === props.selCutId || tool !== 'select')}
                showHandles={props.showHandles}
                showOriginal={props.showOriginal}
                activeMask={isTarget ? props.activeMask : null}
                selEffect={selEffect}
                onOp={(op) => props.onMaskOp(cut.id, op)}
                onParams={props.onParams}
              />
            );
          })}
          {layerFront.map((l) => (
            <LayerCanvas key={l.id} layer={l} total={total} />
          ))}
          <svg width={PAGE_WIDTH} height={total} className="bubbleLayer" style={{ pointerEvents: 'none' }}>
            {project.bubbles.map((b) => (
              <g
                key={b.id}
                style={{ pointerEvents: tool === 'select' ? 'visiblePainted' : 'none', cursor: 'move' }}
                onPointerDown={(e) => startDrag(e, 'move', b)}
                onDoubleClick={() => props.onEditBubble(b.id)}
                dangerouslySetInnerHTML={{ __html: bubbleMarkup(b) }}
              />
            ))}
            {selBubble && tool === 'select' && (
              <g style={{ pointerEvents: 'all' }}>
                <rect x={selBubble.x} y={selBubble.y} width={selBubble.w} height={selBubble.h} fill="none" stroke="#2e7dff" strokeWidth={1.5 / zoom} strokeDasharray={`${6 / zoom} ${4 / zoom}`} pointerEvents="none" />
                {[
                  [selBubble.x, selBubble.y],
                  [selBubble.x + selBubble.w, selBubble.y],
                  [selBubble.x, selBubble.y + selBubble.h],
                  [selBubble.x + selBubble.w, selBubble.y + selBubble.h],
                ].map(([hx, hy], i) => (
                  <rect key={i} x={hx - hs / 2} y={hy - hs / 2} width={hs} height={hs} fill="#fff" stroke="#2e7dff" strokeWidth={1.5 / zoom} style={{ cursor: i === 0 || i === 3 ? 'nwse-resize' : 'nesw-resize' }} onPointerDown={(e) => startDrag(e, 'resize', selBubble, i)} />
                ))}
                {selBubble.tail && (
                  <circle cx={selBubble.tailX} cy={selBubble.tailY} r={hs * 0.9} fill="#ff4d6a" stroke="#fff" strokeWidth={2 / zoom} style={{ cursor: 'grab' }} onPointerDown={(e) => startDrag(e, 'tail', selBubble)} />
                )}
              </g>
            )}
            {layerBox}
          </svg>
          {tool === 'select' && items.length > 1 && (
            <div className="gripLayer" style={{ width: PAGE_WIDTH, height: total }}>
              {items.map(({ cut, top }, i) => (
                <div
                  key={cut.id}
                  className={`cutGrip ${cut.id === props.selCutId ? 'on' : ''} ${cutDrag?.id === cut.id ? 'drag' : ''}`}
                  style={{ top: top + 8 / zoom, left: 8 / zoom, transform: `scale(${1 / zoom})`, transformOrigin: '0 0' }}
                  data-cut-grip={i}
                  title="끌어서 컷 순서 바꾸기"
                  onPointerDown={(e) => startCutDrag(e, cut.id)}
                >
                  <span>⠿</span>
                  <b>{i}</b>
                </div>
              ))}
              {dropLineY !== null && <div className="cutDropLine" style={{ top: dropLineY - 2 / zoom, height: 4 / zoom }}>{cutDrag && <span style={{ fontSize: 12 / zoom }}>→ {cutDrag.target}번 자리</span>}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
