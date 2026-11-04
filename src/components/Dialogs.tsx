'use client';

import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PAGE_WIDTH, type Material, type Project } from '@/lib/types';
import { analyzeSheet, cutPieces, findPieces, openSheet, type SheetSource } from '@/lib/sheet';
import { downloadBlob, exportSliced, MAX_CANVAS_SIDE, planExport } from '@/lib/project';

/* ------------------------------ 더보기 메뉴 ------------------------------ */

export interface MenuItem {
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** true 면 이 항목 위에 구분선을 그린다 */
  divider?: boolean;
}

/**
 * 상단 바처럼 가로로 스크롤되는 영역 안에서도 잘리지 않도록 fixed 위치로 펼쳐지는 메뉴.
 * 바깥을 누르거나 Esc 를 누르면 닫힌다.
 */
export function MoreMenu({ label, items, title }: { label: string; items: MenuItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} className={`btn ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen((o) => !o)}>
        {label} ▾
      </button>
      {open && pos && (
        <div ref={popRef} className="menuPop" role="menu" style={{ top: pos.top, right: pos.right }}>
          {items.map((it) => (
            <div key={it.label}>
              {it.divider && <div className="menuSep" />}
              <button
                role="menuitem"
                className={`menuItem ${it.danger ? 'danger' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                <span>{it.label}</span>
                {it.hint && <small>{it.hint}</small>}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------ 분할 저장 ------------------------------ */

const num = (s: string, fallback: number) => {
  const n = Number(s);
  return Number.isFinite(n) && s.trim() !== '' ? n : fallback;
};

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

export function ExportDialog({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: (msg: string) => void }) {
  const [format, setFormat] = useState<'jpg' | 'png'>('jpg');
  const [widthStr, setWidthStr] = useState(String(PAGE_WIDTH));
  const [slice, setSlice] = useState(true);
  const [maxHStr, setMaxHStr] = useState('1280');
  const [quality, setQuality] = useState(92);
  const [progress, setProgress] = useState<{ done: number; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const width = Math.round(Math.min(4000, Math.max(100, num(widthStr, PAGE_WIDTH))));
  const maxH = slice ? Math.round(Math.max(200, num(maxHStr, 1280))) : 0;
  const plan = useMemo(() => planExport(project, { width, maxHeight: maxH }), [project, width, maxH]);
  const outTotal = Math.round(plan.total * plan.scale);
  const tooTall = !slice && plan.total > MAX_CANVAS_SIDE;
  const running = progress !== null;

  const run = async () => {
    setError(null);
    setProgress({ done: 0, count: plan.ranges.length });
    try {
      const res = await exportSliced(project, { format, width, maxHeight: maxH, quality: quality / 100 }, (done, count) => setProgress({ done, count }));
      downloadBlob(res.blob, res.filename);
      const biggest = Math.max(...res.sizes);
      onDone(`${res.count}장을 저장했어요 · 가장 큰 파일 ${mb(biggest)}MB`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  };

  return (
    <div className="modalBack" onPointerDown={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="분할 저장">
        <h3>분할 저장 (올리기용)</h3>
        <p className="hint">긴 웹툰을 컷과 컷 사이에서 나눠 저장해요. 여러 장이면 ZIP 하나로 묶여요. 올릴 곳마다 권장 가로·세로·용량이 달라서 숫자를 직접 맞출 수 있어요.</p>

        <div className="field">
          <span className="fieldLabel">형식</span>
          <div className="seg">
            <button className={format === 'jpg' ? 'on' : ''} onClick={() => setFormat('jpg')}>JPG</button>
            <button className={format === 'png' ? 'on' : ''} onClick={() => setFormat('png')}>PNG</button>
          </div>
        </div>

        <div className="field">
          <span className="fieldLabel">가로(px)</span>
          <div className="chipRow">
            <input className="text numInput" type="number" min={100} max={4000} value={widthStr} onChange={(e) => setWidthStr(e.target.value)} aria-label="가로" />
            {[PAGE_WIDTH, 800, 720, 690].map((w) => (
              <button key={w} className={`chip ${width === w ? 'on' : ''}`} onClick={() => setWidthStr(String(w))}>{w === PAGE_WIDTH ? `${w} (원본)` : w}</button>
            ))}
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={slice} onChange={(e) => setSlice(e.target.checked)} /> 세로로 나누기
        </label>
        {slice && (
          <div className="field">
            <span className="fieldLabel">조각 하나의 최대 세로(px)</span>
            <div className="chipRow">
              <input className="text numInput" type="number" min={200} max={20000} value={maxHStr} onChange={(e) => setMaxHStr(e.target.value)} aria-label="최대 세로" />
              {[1280, 1500, 2000, 5000].map((h) => (
                <button key={h} className={`chip ${maxH === h ? 'on' : ''}`} onClick={() => setMaxHStr(String(h))}>{h}</button>
              ))}
            </div>
          </div>
        )}

        {format === 'jpg' && (
          <label className="field">
            <span className="fieldLabel">JPG 품질<b>{quality}%</b></span>
            <input type="range" min={50} max={100} step={1} value={quality} onChange={(e) => setQuality(parseInt(e.target.value, 10))} />
          </label>
        )}

        <p className="hint exportInfo" data-testid="export-info">
          전체 {plan.total.toLocaleString()}px → 출력 {plan.outWidth}×{outTotal.toLocaleString()}px · <b>{plan.ranges.length}장</b>
          {plan.ranges.length > 1 && ` (각 ${Math.min(...plan.ranges.map(([a, b]) => Math.round((b - a) * plan.scale)))}~${Math.max(...plan.ranges.map(([a, b]) => Math.round((b - a) * plan.scale)))}px)`}
        </p>
        {tooTall && <p className="hint warn">세로가 {MAX_CANVAS_SIDE.toLocaleString()}px 를 넘어서 한 장으로는 만들 수 없어요. “세로로 나누기”를 켜 주세요.</p>}
        {error && <p className="hint warn">{error}</p>}

        <div className="modalActions">
          <button className="btn" onClick={onClose} disabled={running}>닫기</button>
          <button className="btn primary" onClick={() => void run()} disabled={running || tooTall || project.cuts.length === 0}>
            {running ? `만드는 중… ${progress!.done}/${progress!.count}` : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 단축키 안내 ------------------------------ */

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: '도구',
    items: [
      ['V', '선택/이동'],
      ['W', '마술봉'],
      ['L', '올가미'],
      ['B', '브러시 ( [ ] 로 크기 )'],
      ['M / E', '사각 / 타원'],
      ['Alt + 드래그', '영역 추가 ↔ 빼기 반대로'],
      ['Esc', '선택 도구로 돌아가기'],
    ],
  },
  {
    group: '편집',
    items: [
      ['Ctrl + Z', '실행취소'],
      ['Ctrl + Shift + Z / Ctrl + Y', '다시 실행'],
      ['Ctrl + D', '선택한 말풍선·배경·효과·컷 복제'],
      ['Delete', '선택한 말풍선·배경·효과 지우기'],
      ['방향키 (Shift = 10px)', '선택한 말풍선·배경 레이어 이동'],
      ['Ctrl + C / Ctrl + V', '효과 레이어 복사 → 다른 컷에 붙여넣기 (영역도 같은 위치로)'],
      ['Ctrl + S', '프로젝트(.wtoon) 저장 · Chrome·Edge 에서는 한 번 위치를 정하면 같은 파일에 덮어써요'],
      ['Ctrl + Shift + S', '다른 이름으로 저장 (저장 위치를 새로 고르기)'],
    ],
  },
  {
    group: '보기',
    items: [
      ['C 누르고 있기', '효과 없는 원본과 비교'],
      ['Ctrl + 마우스 휠', '확대/축소'],
      ['+ / −', '확대 / 축소'],
      ['0', '화면에 맞춤'],
      ['Space + 드래그 / 마우스 가운데 버튼', '화면 이동 (어느 도구에서든)'],
      ['?', '이 안내 열기/닫기'],
    ],
  },
  {
    group: '가져오기',
    items: [
      ['Ctrl + V', '복사한 이미지를 컷으로 붙여넣기'],
      ['컷 추가', '선택한 컷 바로 뒤에 들어가요 (선택이 없으면 맨 끝)'],
      ['끌어다 놓기', '아무 곳에나 이미지를 놓으면 컷으로, .wtoon 은 불러오기, 소재 탭에서는 소재로'],
      ['말풍선 더블클릭', '글자 바로 고치기'],
    ],
  },
];

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modalBack" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="단축키 안내">
        <h3>단축키 · 사용 팁</h3>
        <p className="hint">한글 입력 상태에서도 같은 키로 동작해요.</p>
        <div className="helpGrid">
          {SHORTCUTS.map((g) => (
            <div key={g.group}>
              <div className="effGroupTitle">{g.group}</div>
              {g.items.map(([k, d]) => (
                <div key={k} className="helpRow">
                  <kbd>{k}</kbd>
                  <span>{d}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modalActions">
          <button className="btn primary" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ 효과음 시트 자르기 ------------------------------ */

export function SheetDialog({ file, onClose, onDone }: { file: File; onClose: () => void; onDone: (items: Material[]) => void }) {
  const [source, setSource] = useState<SheetSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tol, setTol] = useState(40);
  const [grow, setGrow] = useState(24);
  const [minArea, setMinArea] = useState(40);
  const [prefix, setPrefix] = useState('효과음');
  const [off, setOff] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    openSheet(file)
      .then((s) => !dead && setSource(s))
      .catch((e) => !dead && setError(`그림을 열 수 없어요: ${(e as Error).message}${/psd/i.test(file.name) ? ' (PNG로 내보낸 파일을 올려 보세요)' : ''}`));
    return () => { dead = true; };
  }, [file]);

  const dTol = useDeferredValue(tol);
  const dGrow = useDeferredValue(grow);
  const dMin = useDeferredValue(minArea);
  const analysis = useMemo(() => (source ? analyzeSheet(source, dTol) : null), [source, dTol]);
  const found = useMemo(() => (analysis ? findPieces(analysis.mask, analysis.w, analysis.h, { grow: Math.round((dGrow * analysis.scale) / 2), minArea: dMin }) : null), [analysis, dGrow, dMin]);

  useEffect(() => setOff(new Set()), [found]);
  useEffect(() => {
    const host = previewRef.current;
    if (!host || !analysis) return;
    analysis.preview.style.cssText = 'width:100%;display:block';
    host.replaceChildren(analysis.preview);
  }, [analysis]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);

  const picks = found ? found.pieces.filter((p) => !off.has(p.label)) : [];
  const toggle = (label: number) => setOff((s) => { const n = new Set(s); if (n.has(label)) n.delete(label); else n.add(label); return n; });

  const run = async () => {
    if (!analysis || !found || !picks.length) return;
    setBusy({ done: 0, total: picks.length });
    // 화면이 갱신되도록 20개씩 끊어서 자른다
    const items: Material[] = [];
    try {
      for (let i = 0; i < picks.length; i += 20) {
        await new Promise((r) => setTimeout(r, 0));
        items.push(...cutPieces(analysis, found, picks.slice(i, i + 20), prefix.trim() || '효과음'));
        setBusy({ done: Math.min(picks.length, i + 20), total: picks.length });
      }
      onDone(items);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="modalBack" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="효과음 시트 자르기" data-testid="sheet-dialog">
        <h3>효과음 시트 자르기</h3>
        <p className="hint">한 장에 모여 있는 효과음·말풍선·이펙트를 자동으로 하나씩 잘라 소재로 등록해요. 파란 상자가 소재 한 개예요. 상자를 누르면 빼거나 다시 넣을 수 있어요.</p>
        {error && <p className="errText">{error}</p>}
        {!source && !error && <p className="hint">그림을 읽는 중…</p>}
        {analysis && found && (
          <>
            <div className="sheetPrev" style={{ background: analysis.alphaMode ? undefined : '#777' }}>
              <div className="sheetInner">
              <div ref={previewRef} />
              {found.pieces.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`sheetBox ${off.has(p.label) ? 'off' : ''}`}
                  title={`${p.n}번${off.has(p.label) ? ' (빠짐)' : ''}`}
                  style={{ left: `${(p.x / analysis.w) * 100}%`, top: `${(p.y / analysis.h) * 100}%`, width: `${(p.w / analysis.w) * 100}%`, height: `${(p.h / analysis.h) * 100}%` }}
                  onClick={() => toggle(p.label)}
                />
              ))}
              </div>
            </div>
            <p className="hint" data-testid="sheet-count">
              {found.pieces.length}개를 찾았고 {picks.length}개를 등록해요 · 원본 {analysis.source.width}×{analysis.source.height}px · {analysis.alphaMode ? '투명 배경으로 인식' : '바탕색을 지워서 인식'}
            </p>
            <label className="field">
              <span>
                묶는 거리 <b>{grow}px</b> <small>(이 거리 안의 획·테두리는 한 개로 묶여요. 서로 붙어 있는 소재가 하나로 뭉치면 줄이고, 한 글자가 쪼개지면 늘리세요)</small>
              </span>
              <input type="range" min={0} max={160} value={grow} onChange={(e) => setGrow(+e.target.value)} />
            </label>
            <label className="field">
              <span>
                먼지 무시 <b>{minArea}</b> <small>(이보다 작은 조각은 버려요)</small>
              </span>
              <input type="range" min={1} max={600} value={minArea} onChange={(e) => setMinArea(+e.target.value)} />
            </label>
            {!analysis.alphaMode && (
              <label className="field">
                <span>
                  바탕색 허용치 <b>{tol}</b> <small>(바탕과 비슷한 색을 얼마나 지울지)</small>
                </span>
                <input type="range" min={8} max={120} value={tol} onChange={(e) => setTol(+e.target.value)} />
              </label>
            )}
            <label className="field">
              <span>이름 앞부분</span>
              <input type="text" value={prefix} maxLength={20} onChange={(e) => setPrefix(e.target.value)} />
            </label>
          </>
        )}
        {busy && <p className="hint">{busy.done} / {busy.total}개 자르는 중…</p>}
        <div className="modalActions">
          <button className="btn" onClick={onClose} disabled={!!busy}>닫기</button>
          <button className="btn primary" data-testid="sheet-run" onClick={() => void run()} disabled={!picks.length || !!busy}>
            {picks.length}개 소재로 등록
          </button>
        </div>
      </div>
    </div>
  );
}
