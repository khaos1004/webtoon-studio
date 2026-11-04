/**
 * 효과 엔진 검증 (Node에서 실행)
 *   npm run test:engine
 * 합성 장면(얼굴 + 콜라 든 손)을 만들고, 올가미 마스크로 손+콜라만 선택해서
 * 각 효과가 "선택 영역 주변에서만" 픽셀을 바꾸는지 수치로 확인한다.
 * 결과 이미지는 test/out/*.png 로 저장된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createEffect } from '../src/lib/effectMeta';
import { rasterizeMask, maskBounds } from '../src/lib/mask';
import { renderEffects } from '../src/lib/render';
import type { RGBA } from '../src/lib/effects';
import type { Effect, MaskDef } from '../src/lib/types';

const W = 900;
const H = 600;
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failed = 0;
function check(name: string, ok: boolean, info = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}

/* ---------- 합성 장면 ---------- */
function makeScene(): RGBA {
  const data = new Uint8ClampedArray(W * H * 4);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * W + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 205 + (y / H) * 30, 230 + (y / H) * 15, 255); // 배경 그라디언트
  // 정지된 얼굴(왼쪽)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < 380; x++) {
      const d = Math.hypot(x - 200, y - 280);
      if (d < 110) set(x, y, 255, 217, 184);
      if (Math.hypot(x - 165, y - 260) < 9 || Math.hypot(x - 235, y - 260) < 9) set(x, y, 30, 30, 30);
    }
  // 콜라병(중앙) + 손
  for (let y = 140; y < 470; y++)
    for (let x = 460; x < 600; x++) {
      const neck = y < 230;
      const half = neck ? 18 : 62;
      if (Math.abs(x - 530) < half) set(x, y, y > 310 && y < 390 ? 200 : 58, y > 310 && y < 390 ? 30 : 28, y > 310 && y < 390 ? 30 : 18);
    }
  for (let y = 360; y < 480; y++)
    for (let x = 440; x < 640; x++) {
      if (Math.hypot((x - 540) / 90, (y - 420) / 52) < 1) set(x, y, 240, 190, 150);
    }
  return { data, width: W, height: H };
}

/** 손 + 콜라를 감싸는 올가미(다각형) */
const lasso: MaskDef = {
  feather: 2,
  ops: [
    {
      kind: 'poly',
      mode: 'add',
      points: [452, 130, 608, 130, 606, 330, 650, 420, 640, 485, 440, 485, 432, 420, 456, 330],
    },
  ],
};

async function save(img: RGBA, name: string) {
  await sharp(Buffer.from(img.data.buffer), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png()
    .toFile(path.join(OUT, name));
}

function diffCount(a: RGBA, b: RGBA, x0: number, y0: number, x1: number, y1: number, tol = 1) {
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) n++;
    }
  return n;
}

function withMask(e: Effect, mask: MaskDef = lasso): Effect {
  return { ...e, mask };
}

async function main() {
  const base = makeScene();
  await save(base, '00-original.png');

  /* ----- 마스크 ----- */
  const m = rasterizeMask(lasso, W, H);
  const b = maskBounds(m, W, H)!;
  check('올가미 마스크 경계', b.x0 >= 425 && b.x1 <= 657 && b.y0 >= 124 && b.y1 <= 492, `x ${b.x0}-${b.x1}, y ${b.y0}-${b.y1}`);
  let inside = 0;
  for (let i = 0; i < m.length; i++) if (m[i] > 0.5) inside++;
  check('올가미 면적이 다각형 면적과 근사', inside > 55000 && inside < 80000, `${inside}px`);
  check('경계 밖은 0', m[300 * W + 100] === 0 && m[300 * W + 800] === 0);

  const sub = rasterizeMask({ feather: 0, ops: [...lasso.ops, { kind: 'ellipse', mode: 'sub', x: 480, y: 200, w: 100, h: 100 }] }, W, H);
  check('빼기(subtract) 동작', sub[250 * W + 530] < 0.01 && sub[160 * W + 530] > 0.99);

  const brush = rasterizeMask({ feather: 0, ops: [{ kind: 'stroke', mode: 'add', points: [100, 100, 300, 100], radius: 10 }] }, W, H);
  check('브러시 선 칠하기', brush[100 * W + 200] === 1 && brush[125 * W + 200] === 0 && brush[100 * W + 105] === 1);

  /* ----- 효과별 검증 ----- */
  const cases: [string, Effect][] = [
    ['shake', withMask(createEffect('shake'))],
    ['afterimage', withMask(createEffect('afterimage'))],
    ['motionblur', withMask(createEffect('motionblur'))],
    ['blur', withMask(createEffect('blur'))],
    ['glow', withMask(createEffect('glow'))],
    ['halftone', withMask(createEffect('halftone'))],
    ['color-gray', withMask({ ...createEffect('color'), params: { ...createEffect('color').params, mode: 'gray' } })],
    ['speedlines', withMask(createEffect('speedlines'))],
  ];
  const results: Record<string, RGBA> = {};
  for (const [name, eff] of cases) {
    const t0 = Date.now();
    const out = renderEffects(base, [eff]);
    const ms = Date.now() - t0;
    results[name] = out;
    await save(out, `01-${name}.png`);
    const faceChanged = diffCount(base, out, 0, 0, 340, H);
    const changedNear = diffCount(base, out, 380, 0, W, H);
    check(`${name}: 얼굴(선택 밖)은 그대로`, faceChanged === 0, `변경 ${faceChanged}px · ${ms}ms`);
    check(`${name}: 선택 주변은 실제로 변경됨`, changedNear > 500, `변경 ${changedNear}px`);
  }

  // 흔들림: 마스크 바깥 10~20px 지점에 잔상이 생기지만, 멀리(150px 밖)에는 아무 영향 없음
  const shake = results['shake'];
  check('shake: 병 옆에 복제본이 생김', diffCount(base, shake, 593, 240, 612, 300) > 100);
  check('shake: 먼 곳(이동거리 밖)은 변화 없음', diffCount(base, shake, 700, 0, W, H) === 0 && diffCount(base, shake, 380, 0, 396, H) === 0);

  // 잔상: 진행 반대 방향(왼쪽)으로만 꼬리
  const trail = results['afterimage'];
  check('afterimage: 뒤쪽(왼쪽)에만 잔상', diffCount(base, trail, 380, 130, 440, 480) > 300 && diffCount(base, trail, 660, 130, W, 480) === 0);

  // 모션블러: 병 몸통 가장자리가 번지고, 방향과 수직 쪽은 번지지 않는다
  const mb = results['motionblur'];
  check('motionblur: 좌우로 번짐', diffCount(base, mb, 440, 150, 470, 300, 4) > 50);
  check('motionblur: 위쪽 바깥은 변화 없음', diffCount(base, mb, 440, 0, 700, 120) === 0);

  // 색 보정(흑백): 선택 안의 병 라벨은 무채색, 밖은 원래 색
  const gray = results['color-gray'];
  const gi = (350 * W + 530) * 4;
  check('color-gray: 선택 안은 무채색', Math.abs(gray.data[gi] - gray.data[gi + 1]) < 3 && Math.abs(gray.data[gi + 1] - gray.data[gi + 2]) < 3);
  const oi = (100 * W + 800) * 4;
  check('color-gray: 선택 밖은 유지', gray.data[oi] === base.data[oi] && gray.data[oi + 2] === base.data[oi + 2]);

  // 속도선: 물체 위에는 그리지 않음
  const sl = results['speedlines'];
  check('speedlines: 물체 중심은 그대로', diffCount(base, sl, 500, 330, 560, 380) === 0);

  /* ----- 레이어 쌓기: 손/콜라 흔들림 + 속도선 + 배경 집중선 ----- */
  const stack = renderEffects(base, [
    withMask(createEffect('motionblur')),
    withMask({ ...createEffect('shake'), params: { ...createEffect('shake').params, distance: 14 } }),
    withMask({ ...createEffect('speedlines'), params: { ...createEffect('speedlines').params, angle: 0 } }),
  ]);
  await save(stack, '02-stack.png');
  const bg = withMask(createEffect('focuslines'), { feather: 0, ops: [{ kind: 'rect', mode: 'add', x: 0, y: 0, w: W, h: H }, { kind: 'ellipse', mode: 'sub', x: 380, y: 100, w: 300, h: 400 }] });
  await save(renderEffects(base, [bg]), '03-focuslines.png');

  // 숨김 레이어는 무시
  const hidden = renderEffects(base, [{ ...withMask(createEffect('shake')), visible: false }]);
  check('숨긴 레이어는 적용되지 않음', diffCount(base, hidden, 0, 0, W, H, 0) === 0);
  // 마스크가 비어 있으면 아무 일도 하지 않음
  const empty = renderEffects(base, [createEffect('shake')]);
  check('빈 마스크는 아무것도 바꾸지 않음', diffCount(base, empty, 0, 0, W, H, 0) === 0);
  // 원본 불변
  const again = makeScene();
  check('원본 픽셀은 변경되지 않음(비파괴)', diffCount(base, again, 0, 0, W, H, 0) === 0);

  console.log(failed === 0 ? '\n전부 통과' : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
