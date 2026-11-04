/**
 * 브라우저 통합 테스트 (Playwright + 실제 Chromium)
 * 번들된 편집기 UI 를 열고 사람이 하듯이 마우스로 올가미를 그리고 효과를 적용한다.
 *   NODE_PATH=<글로벌 node_modules> node test/browser.test.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const sharp = require('sharp');

const OUT = path.join(__dirname, 'out');
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  // 파일 저장 창(File System Access)이 없는 브라우저(Firefox·Safari)처럼 동작시켜 다운로드 저장 경로를 검증한다. 저장 창 경로는 browser-v14 에서 따로 검증
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.join(OUT, 'web', 'index.html'));
  await page.waitForSelector('.empty');
  check('빈 화면이 뜬다', true);

  /* ---------- 1) 이미지 업로드 ---------- */
  await page.setInputFiles('input[type=file][accept="image/*"]', path.join(OUT, '00-original.png'));
  await page.waitForSelector('.cutCanvas');
  await page.waitForTimeout(300);
  check('이미지가 컷으로 추가된다', (await page.locator('.cut').count()) === 1);

  const snap = () =>
    page.evaluate(() => {
      const c = document.querySelector('.cutCanvas');
      return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    });
  const before = await snap();

  /* ---------- 2) 효과 추가 + 올가미로 손/콜라 선택 ---------- */
  await page.click('.effGroup button:has-text("+ 흔들림")');
  await page.waitForTimeout(100);
  check('영역 없이 효과를 추가하면 마술봉이 켜진다', (await page.locator('.toolOn').innerText()).includes('마술봉'));
  await page.click('.tool:has-text("올가미")');
  await page.waitForSelector('.cutLayer');
  const box = await page.locator('.cutLayer').boundingBox();
  const sc = box.width / 900;
  const P = (x, y) => [box.x + x * sc, box.y + y * sc];
  const poly = [[452, 130], [608, 130], [606, 330], [650, 420], [640, 485], [440, 485], [432, 420], [456, 330]];
  await page.mouse.move(...P(...poly[0]));
  await page.mouse.down();
  for (const pt of poly.slice(1)) await page.mouse.move(...P(...pt), { steps: 6 });
  await page.mouse.move(...P(...poly[0]), { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const afterLasso = await snap();
  const diffIn = (a, b, x0, y0, x1, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * 900 + x) * 4; if (Math.abs(a[i] - b[i]) > 1 || Math.abs(a[i + 1] - b[i + 1]) > 1 || Math.abs(a[i + 2] - b[i + 2]) > 1) n++; }
    return n;
  };
  check('올가미 후 선택 영역 주변 픽셀이 바뀐다(흔들림)', diffIn(before, afterLasso, 593, 240, 625, 300) > 50, `${diffIn(before, afterLasso, 593, 240, 625, 300)}px`);
  check('얼굴/배경(선택 밖)은 픽셀 그대로', diffIn(before, afterLasso, 0, 0, 340, 600) === 0 && diffIn(before, afterLasso, 700, 0, 900, 600) === 0);
  check('마스크 개수 표시', (await page.locator('.hint:has-text("조각 1개")').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, '01-lasso-shake.png') });

  /* ---------- 3) 슬라이더로 방향/거리 조절 → 실시간 반영 ---------- */
  const setRange = async (label, value) => {
    await page.locator('label.field', { hasText: label }).locator('input[type=range]').evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  };
  await setRange('방향(°)', 90);
  await setRange('이동 거리(px)', 40);
  await page.waitForTimeout(500);
  const vertical = await snap();
  check('방향을 90°(세로)로 바꾸면 위/아래에 잔상이 생긴다', diffIn(before, vertical, 470, 100, 590, 128) > 50 || diffIn(before, vertical, 470, 486, 590, 530) > 50);
  check('세로 흔들림에서도 얼굴은 그대로', diffIn(before, vertical, 0, 0, 340, 600) === 0);
  await page.screenshot({ path: path.join(SHOTS, '02-vertical-shake.png') });
  await setRange('방향(°)', 0);

  /* ---------- 4) 모션블러 레이어 추가 + 브러시로 영역 칠하기 ---------- */
  await page.click('.effGroup button:has-text("+ 모션 블러")');
  check('새 효과는 이전 레이어의 영역을 이어받는다', (await page.locator('.hint:has-text("조각 1개")').count()) === 1);
  await page.click('button:has-text("영역 지우기")');
  await page.click('.tool:has-text("브러시")');
  const box2 = await page.locator('.cutLayer').boundingBox();
  const Q = (x, y) => [box2.x + x * (box2.width / 900), box2.y + y * (box2.width / 900)];
  const b0 = await snap();
  await page.mouse.move(...Q(530, 160));
  await page.mouse.down();
  await page.mouse.move(...Q(530, 440), { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const b1 = await snap();
  check('브러시로 칠한 부분에 모션 블러가 적용된다', diffIn(b0, b1, 440, 140, 640, 480) > 500, `${diffIn(b0, b1, 440, 140, 640, 480)}px`);
  check('브러시 밖(좌측 얼굴)은 그대로', diffIn(b0, b1, 0, 0, 340, 600) === 0);
  await page.screenshot({ path: path.join(SHOTS, '03-brush-motionblur.png') });

  /* ---------- 5) 마스크 빼기 / 레이어 숨김 / 실행취소 ---------- */
  await page.click('.seg button:has-text("영역 빼기")');
  await page.mouse.move(...Q(530, 400));
  await page.mouse.down();
  await page.mouse.move(...Q(530, 440), { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  check('빼기 도구가 동작(오류 없이 마스크 연산 추가)', (await page.locator('.hint:has-text("조각 2개")').count()) === 1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  check('Ctrl+Z 로 마지막 마스크 연산이 취소된다', (await page.locator('.hint:has-text("조각 1개")').count()) === 1);
  const rows = page.locator('.layerRow');
  check('효과 레이어가 2개 표시된다', (await rows.count()) === 2);
  await rows.first().locator('.iconBtn').first().click(); // 위(모션블러) 숨김
  await page.waitForTimeout(400);
  const hiddenSnap = await snap();
  check('레이어를 숨기면 해당 효과가 사라진다', diffIn(b1, hiddenSnap, 440, 140, 640, 480) > 300);
  await rows.first().locator('.iconBtn').first().click();

  /* ---------- 6) 속도선 + 집중선 UI ---------- */
  await page.click('.effGroup button:has-text("+ 속도선")');
  await page.click('button:has-text("컷 전체")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '04-speedlines.png') });

  /* ---------- 7) 말풍선 ---------- */
  await page.click('.tabs button:has-text("말풍선")');
  await page.click('.kindBtn:has-text("외침")');
  await page.waitForTimeout(200);
  check('말풍선이 추가된다', (await page.locator('.bubbleLayer g[data-bubble]').count()) === 1);
  await page.locator('textarea.text').fill('흔들어라!!');
  await page.click('button:has-text("글자에 맞춰 크기 조정")');
  const bb = await page.locator('.bubbleLayer g[data-bubble]').first().boundingBox();
  const bx0 = bb.x + bb.width / 2;
  const by0 = bb.y + bb.height / 2;
  await page.mouse.move(bx0, by0);
  await page.mouse.down();
  await page.mouse.move(bx0 - 220, by0 + 40, { steps: 8 });
  await page.mouse.up();
  const bb2 = await page.locator('.bubbleLayer g[data-bubble]').first().boundingBox();
  check('말풍선을 드래그로 이동할 수 있다', Math.abs(bb2.x - (bb.x - 220)) < 6);
  await page.click('.kindBtn:has-text("기본 대사")');
  await page.locator('textarea.text').fill('어, 콜라가 막 흔들려!');
  await page.waitForTimeout(150);
  // 꼬리 핸들 드래그
  const tail = page.locator('.bubbleLayer circle').first();
  const tb = await tail.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + tb.width / 2 + 120, tb.y + tb.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const tb2 = await tail.boundingBox();
  check('꼬리 핸들을 끌어 방향을 바꿀 수 있다', tb2.x > tb.x + 90);
  // 색 변경: 본체와 꼬리가 같이 변하는지(채움 레이어의 모든 path 가 같은 fill)
  await page.locator('label.field.row', { hasText: '배경색' }).locator('input[type=color]').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#ffe08a');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const fills = await page.evaluate(() => {
    const g = document.querySelectorAll('.bubbleLayer g[data-bubble]')[1];
    return Array.from(g.querySelectorAll('path[fill]:not([fill="none"])')).map((p) => p.getAttribute('fill'));
  });
  check('본체와 꼬리가 같은 배경색을 쓴다', fills.length >= 2 && fills.every((f) => f === '#ffe08a'), JSON.stringify(fills));
  await page.screenshot({ path: path.join(SHOTS, '05-bubbles.png') });

  /* ---------- 8) 내보내기 JPG ---------- */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.btn.primary:has-text("JPG")')]);
  const jpg = path.join(OUT, 'export.jpg');
  await dl.saveAs(jpg);
  const meta = await sharp(jpg).metadata();
  check('JPG 내보내기: 가로 900', meta.width === 900 && meta.format === 'jpeg', `${meta.width}x${meta.height}`);

  /* ---------- 9) 저장(.wtoon) → 새로고침 → 불러오기 ---------- */
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("저장(.wtoon)")')]);
  const wt = path.join(OUT, 'test.wtoon');
  await dl2.saveAs(wt);
  const data = JSON.parse(fs.readFileSync(wt, 'utf8'));
  check('.wtoon 에 컷/효과/마스크/말풍선이 저장된다', data.cuts.length === 1 && data.cuts[0].effects.length === 3 && data.cuts[0].effects[0].mask.ops.length >= 1 && data.bubbles.length === 2, JSON.stringify({ c: data.cuts.length, e: data.cuts[0].effects.length, ops: data.cuts[0].effects.map((e) => e.mask.ops.length), b: data.bubbles.length }));
  await page.reload();
  await page.waitForSelector('.empty');
  await page.setInputFiles('input[type=file][accept=".wtoon,application/json"]', wt);
  await page.waitForSelector('.cutCanvas');
  await page.waitForTimeout(800);
  check('불러오기 후 컷/말풍선/효과가 복원된다', (await page.locator('.cut').count()) === 1 && (await page.locator('.bubbleLayer g[data-bubble]').count()) === 2);
  const restored = await snap();
  check('불러온 뒤에도 효과가 다시 렌더링된다', diffIn(before, restored, 440, 130, 660, 490) > 500);

  /* ================= v1.1: 마술봉 · 프리셋 · 핸들 · 배경 ================= */
  await page.reload();
  await page.waitForSelector('.empty');
  await page.setInputFiles('input[type=file][accept="image/*"][multiple]', path.join(OUT, '00-original.png'));
  await page.waitForSelector('.cutCanvas');
  await page.waitForTimeout(300);
  const orig2 = await snap();
  await page.click('.tool:has-text("마술봉")');
  await page.waitForSelector('.cutLayer');
  const wb = await page.locator('.cutLayer').boundingBox();
  const W2 = (x, y) => [wb.x + x * (wb.width / 900), wb.y + y * (wb.width / 900)];
  await page.mouse.click(...W2(540, 356));
  await page.waitForTimeout(400);
  check('마술봉 클릭으로 영역(임시 선택)이 만들어진다', (await page.locator('.hint:has-text("임시 선택 영역")').count()) === 1);
  const sel1 = await snap();
  check('영역을 고르기만 해서는 이미지가 바뀌지 않는다', diffIn(orig2, sel1, 0, 0, 900, 600) === 0);
  await page.click('.presetCard:has-text("흔들어 든 물체")');
  await page.waitForTimeout(700);
  check('프리셋이 여러 효과 레이어를 한 번에 만든다', (await page.locator('.layerRow').count()) === 2);
  check('묶음 표시', (await page.locator('.layerRow:has-text("묶음")').count()) === 2);
  const presetSnap = await snap();
  check('프리셋: 고른 물체 주변만 바뀐다', diffIn(orig2, presetSnap, 440, 130, 700, 490) > 400, `${diffIn(orig2, presetSnap, 440, 130, 700, 490)}px`);
  check('프리셋: 얼굴(선택 밖)은 그대로', diffIn(orig2, presetSnap, 0, 0, 340, 600) === 0);
  await page.screenshot({ path: path.join(SHOTS, '06-wand-preset.png') });

  // 화면 핸들(방향 화살표)을 끌어서 방향/거리 변경
  const readField = async (label) => parseFloat(await page.locator('label.field', { hasText: label }).locator('.fieldLabel b').innerText());
  const distBefore = await readField('흐림 길이(px)');
  const handles = page.locator('.cutHandles circle');
  check('방향 핸들이 화면에 보인다', (await handles.count()) >= 2);
  const tip = handles.last();
  const tpb = await tip.boundingBox();
  await page.mouse.move(tpb.x + tpb.width / 2, tpb.y + tpb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tpb.x + tpb.width / 2 + 5, tpb.y + tpb.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const angleAfter = await readField('방향(°)');
  const distAfter = await readField('흐림 길이(px)');
  check('핸들을 끌면 방향이 아래쪽(약 90°)으로 바뀐다', angleAfter > 60 && angleAfter < 120, `각도 ${angleAfter}`);
  check('핸들을 끌면 이동 거리도 바뀐다', Math.abs(distAfter - distBefore) > 5, `${distBefore} → ${distAfter}`);
  const dragSnap = await snap();
  check('핸들 조절 결과가 화면에 반영된다', diffIn(presetSnap, dragSnap, 400, 100, 750, 540) > 200);

  // 다른 영역 반전 + 확대
  await page.click('.tool:has-text("선택/이동")');

  /* ---------- 배경 레이어 ---------- */
  await page.click('.tabs button:has-text("배경")');
  await page.click('button:has-text("＋ 그라데이션")');
  await page.waitForTimeout(200);
  check('배경 레이어가 목록에 생긴다', (await page.locator('.layerRow:has-text("그라데이션")').count()) === 1);
  // 컷 좌우 여백을 줘서 뒤 배경이 보이게
  await page.click('.tabs button:has-text("컷")');
  await setRange('좌우 여백(px)', 120);
  await page.waitForTimeout(300);
  const strip = await page.locator('.strip').boundingBox();
  const [dlPng] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('button:has-text("더보기")'); await page.click('[role=menuitem]:has-text("PNG 한 장")'); })()]);
  const png = path.join(OUT, 'export-bg.png');
  await dlPng.saveAs(png);
  const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * raw.info.width + x) * raw.info.channels; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
  const left = px(30, 300);
  check('컷 좌우 여백에 배경 그라데이션이 보인다(내보내기)', left[1] < 235 && left[2] > 200, JSON.stringify(left));
  const mid = px(450, 20);
  check('컷 안쪽은 그대로 컷 이미지', Math.abs(mid[0] - orig2[(20 * 900 + 450) * 4]) <= 3, JSON.stringify(mid));

  // 그림(이미지) 배경 레이어 올리기 + 화면에서 끌어 이동
  await page.click('.tabs button:has-text("배경")');
  await page.setInputFiles('input[type=file][accept="image/*"]:not([multiple])', path.join(OUT, '00-original.png'));
  await page.waitForSelector('.layerRow:has-text("00-original")');
  await page.waitForTimeout(500);
  check('그림 레이어가 추가된다', (await page.locator('.layerRow').count()) === 2);
  const lbox = page.locator('.bubbleLayer rect[stroke="#ff9f1c"]').first();
  const lb0 = await lbox.boundingBox();
  await page.mouse.move(lb0.x + lb0.width / 2, lb0.y + lb0.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb0.x + lb0.width / 2 + 60, lb0.y + lb0.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const lb1 = await lbox.boundingBox();
  check('그림 레이어를 끌어서 옮길 수 있다', lb1.x > lb0.x + 40 && lb1.y > lb0.y + 25, `${lb0.x}→${lb1.x}`);
  await page.screenshot({ path: path.join(SHOTS, '07-background.png') });

  // 투명 PNG 컷: 뒤 배경이 비친다
  const tp = path.join(OUT, 'transparent.png');
  await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="600" height="400"><circle cx="300" cy="200" r="120" fill="#e02040"/></svg>'), top: 0, left: 0 }])
    .png().toFile(tp);
  await page.setInputFiles('input[type=file][accept="image/*"][multiple]', tp);
  await page.waitForTimeout(600);
  await page.click('.tabs button:has-text("컷")');
  check('투명 PNG 컷은 “투명” 바탕으로 만들어진다', (await page.locator('select.text option[value="transparent"]:checked').count()) === 1 || (await page.locator('select.text').filter({ hasText: '투명' }).count()) >= 1);

  /* ---------- .wtoon 저장: 레이어/컷 모양 포함 ---------- */
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("저장(.wtoon)")')]);
  const wt2 = path.join(OUT, 'test2.wtoon');
  await dl3.saveAs(wt2);
  const d2 = JSON.parse(fs.readFileSync(wt2, 'utf8'));
  check('.wtoon 에 배경 레이어/컷 여백/프리셋 묶음이 저장된다', d2.layers.length === 2 && d2.cuts[0].inset === 120 && d2.cuts[0].effects.length === 2 && !!d2.cuts[0].effects[0].group && d2.cuts[1].bg === 'transparent');

  check('콘솔/페이지 에러 없음(v1.1 포함)', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failed === 0 ? '\n브라우저 테스트 전부 통과' : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('테스트 중단:', e);
  process.exit(2);
});
