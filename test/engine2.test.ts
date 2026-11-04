/**
 * v1.1 추가 기능 검증: 마술봉, 마스크 반전, 새 효과 10종, 프리셋, 레이어 불투명도
 */
import sharp from 'sharp';
import path from 'node:path';
import { createEffect, EFFECT_ORDER } from '../src/lib/effectMeta';
import { rasterizeMask, binaryToRuns, growBinary } from '../src/lib/mask';
import { renderEffects } from '../src/lib/render';
import { magicWand, DEFAULT_WAND } from '../src/lib/select';
import { PRESETS, buildPreset } from '../src/lib/presets';
import type { RGBA } from '../src/lib/effects';
import type { MaskDef } from '../src/lib/types';
import { W, H, OUT, check, failures, makeScene, lasso, save, diffCount, withMask } from './scene';

async function main() {
  const base = makeScene();

  /* ---- 마술봉 ---- */
  const bin = magicWand(base, 530, 360, { ...DEFAULT_WAND, tolerance: 20, grow: 0 }); // 병 라벨(빨강)
  let n = 0;
  for (let i = 0; i < bin.length; i++) n += bin[i];
  check('마술봉: 클릭한 색 영역(빨간 라벨)만 선택', n > 3000 && n < 20000 && bin[360 * W + 530] === 1 && bin[200 * W + 100] === 0, `${n}px`);
  const bodyBin = magicWand(base, 500, 280, { ...DEFAULT_WAND, tolerance: 14, grow: 0 }); // 병 몸통(어두운 갈색)
  let nb = 0;
  for (let i = 0; i < bodyBin.length; i++) nb += bodyBin[i];
  check('마술봉: 인접 영역과 색이 달라 번지지 않음', bodyBin[360 * W + 530] === 0 && nb > 2000, `${nb}px`);
  const g = growBinary(bin, W, H, 3);
  let n2 = 0;
  for (let i = 0; i < g.length; i++) n2 += g[i];
  check('영역 확대', n2 > n);
  const sh = growBinary(bin, W, H, -3);
  let n3 = 0;
  for (let i = 0; i < sh.length; i++) n3 += sh[i];
  check('영역 축소', n3 < n);
  const runs = binaryToRuns(bin, W, H);
  const rm = rasterizeMask({ feather: 0, ops: [{ kind: 'region', mode: 'add', w: W, h: H, runs }] }, W, H);
  let same = true;
  for (let i = 0; i < bin.length; i++) if ((rm[i] > 0.5 ? 1 : 0) !== bin[i]) { same = false; break; }
  check('픽셀 영역(런렝스) 저장→복원이 같다', same, `runs ${runs.length / 3}`);

  /* ---- 마스크 반전: 배경만 효과 ---- */
  const inv: MaskDef = { ...lasso, invert: true };
  const bgBlur = renderEffects(base, [withMask({ ...createEffect('blur'), params: { ...createEffect('blur').params, blur: 8 } }, inv)]);
  check('반전: 선택한 손·콜라는 그대로', diffCount(base, bgBlur, 470, 150, 600, 470) === 0 || diffCount(base, bgBlur, 470, 150, 600, 470) < 400);
  check('반전: 배경은 실제로 바뀜', diffCount(base, bgBlur, 0, 0, 340, H) > 500);

  /* ---- 새 효과 전부: 선택 밖은 그대로(이동/반경 허용), 선택 주변은 변함 ---- */
  const news = ['zoomblur', 'chroma', 'glitch', 'wave', 'shade', 'outline', 'shadow', 'grain', 'poster', 'sparkle'] as const;
  const tiles: Buffer[] = [];
  for (const t of news) {
    const e = withMask(createEffect(t));
    const t0 = Date.now();
    const out = renderEffects(base, [e]);
    const ms = Date.now() - t0;
    await save(out, `n-${t}.png`);
    const far = diffCount(base, out, 0, 0, 330, H) + diffCount(base, out, 0, 0, W, 60);
    const near = diffCount(base, out, 380, 60, W, H);
    check(`${t}: 선택에서 먼 곳은 그대로`, far === 0, `변경 ${far}px · ${ms}ms`);
    check(`${t}: 선택 주변은 바뀜`, near > 150, `변경 ${near}px`);
    tiles.push(await sharp(Buffer.from(out.data.buffer), { raw: { width: W, height: H, channels: 4 } }).extract({ left: 380, top: 100, width: 320, height: 420 }).png().toBuffer());
  }
  // 한 장으로 모아서 눈으로 확인
  const cols = 5;
  const sheetImg = sharp({ create: { width: cols * 320, height: 2 * 420, channels: 3, background: '#fff' } });
  await sheetImg.composite(tiles.map((input, i) => ({ input, left: (i % cols) * 320, top: Math.floor(i / cols) * 420 }))).png().toFile(path.join(OUT, 'sheet-new.png'));

  /* ---- 모션 블러: 물체가 있던 자리 가장자리에 원본이 비치지 않는다 ---- */
  const mbe = { ...createEffect('motionblur'), params: { ...createEffect('motionblur').params, distance: 60, angle: 0, strength: 1, sharp: 0 } };
  const mbo = renderEffects(base, [withMask(mbe)]);
  await save(mbo, 'n-motionblur-long.png');
  // 병 목 가장자리(x≈512)는 원래 어두운 병 / 배경 경계. 번진 뒤엔 급격한 경계가 없어야 한다
  const px = (img: RGBA, x: number, y: number) => img.data[(y * W + x) * 4];
  const edgeStep = Math.abs(px(mbo, 511, 190) - px(mbo, 513, 190));
  const edgeStepBase = Math.abs(px(base, 511, 190) - px(base, 513, 190));
  check('모션 블러: 병 목 경계가 부드럽게 번짐', edgeStep < edgeStepBase * 0.5, `경계 단차 ${edgeStepBase.toFixed(0)} → ${edgeStep.toFixed(0)}`);

  /* ---- 잔상 색 입히기 / 잔상 흐림 ---- */
  const ai = { ...createEffect('afterimage'), params: { ...createEffect('afterimage').params, tint: 1, tintColor: '#0000ff', soft: 4 } };
  const aio = renderEffects(base, [withMask(ai)]);
  let bluish = 0;
  for (let y = 150; y < 460; y++) for (let x = 390; x < 440; x++) { const i = (y * W + x) * 4; if (aio.data[i + 2] > aio.data[i] + 40) bluish++; }
  check('잔상: 지정한 색이 입혀진다', bluish > 300, `${bluish}px`);

  /* ---- 레이어 불투명도 ---- */
  const full = renderEffects(base, [withMask(createEffect('color'), lasso)]);
  const half = renderEffects(base, [{ ...withMask({ ...createEffect('color'), params: { ...createEffect('color').params, mode: 'invert' } }), opacity: 0.5 }]);
  const idx = (350 * W + 530) * 4;
  check('레이어 불투명도 0.5 = 원본과 효과의 중간', Math.abs(half.data[idx] - 128) < 40 || Math.abs(half.data[idx] - (base.data[idx] + (255 - base.data[idx] - base.data[idx]) * 0.5)) < 3, `${half.data[idx]}`);
  void full;

  /* ---- 프리셋: 모든 프리셋이 레이어를 만들고 실제로 렌더된다 ---- */
  for (const p of PRESETS) {
    const layers = buildPreset(p, lasso);
    const t0 = Date.now();
    const out = renderEffects(base, layers);
    const ms = Date.now() - t0;
    const changed = diffCount(base, out, 0, 0, W, H);
    check(`프리셋 “${p.label}”: ${layers.length}개 레이어, 화면이 바뀜`, changed > 200, `${ms}ms · ${changed}px`);
    await save(out, `p-${p.id}.png`);
  }
  // 그룹 편집: 같은 그룹은 같은 ops 참조를 공유(편집 시 함께 바뀌도록 Editor 가 처리)
  const two = buildPreset(PRESETS.find((p) => p.id === 'shake-hold')!, lasso);
  check('프리셋 레이어는 같은 그룹', !!two[0].group && two[0].group === two[1].group);
  check('모든 효과 타입에 메타가 있다', EFFECT_ORDER.length === 21, `${EFFECT_ORDER.length}`);

  console.log(failures() === 0 ? '\n전부 통과' : `\n실패 ${failures()}건`);
  process.exit(failures() === 0 ? 0 : 1);
}
main();
