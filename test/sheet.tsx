import { createSampleCut, SAMPLE_LASSO } from '@/lib/sample';
import { getBase, putRGBA } from '@/lib/imageIO';
import { renderEffects } from '@/lib/render';
import { PRESETS, buildPreset } from '@/lib/presets';
import { EFFECT_ORDER, createEffect } from '@/lib/effectMeta';

(window as any).__sheet = async (kind: 'presets' | 'effects') => {
  const cut = createSampleCut(false);
  const base = await getBase(cut);
  const items: { label: string; effects: any[] }[] = [{ label: '원본', effects: [] }];
  if (kind === 'presets') for (const p of PRESETS) items.push({ label: p.label, effects: buildPreset(p, SAMPLE_LASSO) });
  else for (const t of EFFECT_ORDER) { const e = createEffect(t); e.mask = { ...SAMPLE_LASSO }; items.push({ label: e.name, effects: [e] }); }
  const cols = 4;
  const tw = 450;
  const th = Math.round((cut.height * tw) / 900);
  const rows = Math.ceil(items.length / cols);
  const out = document.getElementById('out') as HTMLCanvasElement;
  out.width = cols * tw;
  out.height = rows * (th + 26);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, out.width, out.height);
  const tmp = document.createElement('canvas');
  const times: string[] = [];
  items.forEach((it, i) => {
    const t0 = performance.now();
    const r = it.effects.length ? renderEffects(base, it.effects) : base;
    times.push(`${it.label}:${Math.round(performance.now() - t0)}ms`);
    putRGBA(tmp, r);
    const x = (i % cols) * tw, y = Math.floor(i / cols) * (th + 26);
    ctx.drawImage(tmp, x, y + 26, tw, th);
    ctx.fillStyle = '#fff'; ctx.font = '16px sans-serif'; ctx.fillText(it.label, x + 8, y + 18);
  });
  return times;
};
