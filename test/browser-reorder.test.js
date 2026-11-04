/** 컷 순서 바꾸기: 번호 입력 / 목록 드래그 / 화면 손잡이 드래그 / 실행취소 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const sharp = require('sharp');
const OUT = path.join(__dirname, 'out');
const SHOTS = path.join(OUT, 'shots');
let failed = 0;
const check = (n, ok, i = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); if (!ok) failed++; };

(async () => {
  const colors = { R: [220, 40, 40], G: [40, 190, 70], B: [50, 90, 230], Y: [240, 210, 40] };
  const files = [];
  for (const [k, c] of Object.entries(colors)) {
    const f = path.join(OUT, `reorder-${k}.png`);
    await sharp({ create: { width: 900, height: 260, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } }).png().toFile(f);
    files.push(f);
  }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  // 파일 저장 창(File System Access)이 없는 브라우저(Firefox·Safari)처럼 동작시켜 다운로드 저장 경로를 검증한다. 저장 창 경로는 browser-v14 에서 따로 검증
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + path.join(OUT, 'web', 'index.html'));
  await page.waitForSelector('.empty');
  // 파일은 선택한 순서대로 추가된다 → R G B Y
  await page.setInputFiles('input[type=file][accept="image/*"]', files);
  await page.waitForFunction(() => document.querySelectorAll('.cutCanvas').length === 4);
  await page.waitForTimeout(600);
  await page.click('.tabs button:has-text("컷")');

  // 화면에 보이는 컷 순서(위→아래)를 색 글자로 읽는다
  const order = () => page.evaluate(() => {
    const cuts = Array.from(document.querySelectorAll('.cut')).map((el) => ({ top: parseFloat(el.style.top), c: el.querySelector('.cutCanvas') }));
    cuts.sort((a, b) => a.top - b.top);
    return cuts.map(({ c }) => { const d = c.getContext('2d').getImageData(10, 10, 1, 1).data; return d[0] > 200 && d[1] < 80 ? 'R' : d[1] > 150 && d[0] < 80 ? 'G' : d[2] > 180 && d[0] < 90 ? 'B' : 'Y'; }).join('');
  });
  check('처음 순서는 올린 순서(RGBY)', (await order()) === 'RGBY', await order());
  const rows = page.locator('.cutRow');
  check('컷 목록에 번호 0~3 이 보인다', (await rows.count()) === 4 && (await page.locator('.idxInput').evaluateAll((els) => els.map((e) => e.value).join(''))) === '0123');
  check('안내 문구에 “맨 위가 0번”', (await page.locator('.hint:has-text("맨 위가 0번")').count()) === 1);

  /* 1) 번호 입력 */
  await page.locator('.idxInput').nth(2).fill('0'); // B → 맨 위
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('3번째 컷(B)에 0 입력 → 맨 위로', (await order()) === 'BRGY', await order());
  check('번호 칸도 새 순서로 갱신', (await page.locator('.idxInput').evaluateAll((els) => els.map((e) => e.value).join(''))) === '0123');

  await page.locator('.idxInput').nth(0).fill('2'); // B(0) → 2번 자리
  await page.locator('.idxInput').nth(0).blur();
  await page.waitForTimeout(400);
  check('맨 위 컷에 2 입력(포커스 이동) → 2번 자리', (await order()) === 'RGBY', await order());

  await page.locator('.idxInput').nth(1).fill('99'); // G → 범위 밖 → 맨 아래
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('범위를 넘는 번호(99)는 맨 아래로', (await order()) === 'RBYG', await order());
  await page.locator('.idxInput').nth(3).fill('-5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('음수(-5)는 맨 위로', (await order()) === 'GRBY', await order());
  await page.locator('.idxInput').nth(1).fill('');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('빈 칸이면 아무것도 안 바뀐다', (await order()) === 'GRBY' && (await page.locator('.idxInput').nth(1).inputValue()) === '1');

  /* 2) 실행취소 */
  await page.locator('body').click({ position: { x: 5, y: 500 } });
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  check('Ctrl+Z 로 직전 이동이 취소된다', (await order()) === 'RBYG', await order());
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  check('Ctrl+Shift+Z 로 다시 실행', (await order()) === 'GRBY', await order());

  /* 3) 목록에서 끌어 놓기: 첫 행(G)을 맨 아래로 */
  await rows.nth(0).dragTo(rows.nth(3), { targetPosition: { x: 80, y: 28 } });
  await page.waitForTimeout(500);
  check('목록에서 맨 위 컷을 맨 아래 행의 아래쪽에 놓으면 맨 끝으로', (await order()) === 'RBYG', await order());
  // 마지막 행(G)을 두 번째 행의 위쪽에 → 1번 자리
  await rows.nth(3).dragTo(rows.nth(1), { targetPosition: { x: 80, y: 3 } });
  await page.waitForTimeout(500);
  check('마지막 컷을 두 번째 행의 위쪽에 놓으면 1번 자리', (await order()) === 'RGBY', await order());
  // 제자리에 놓으면 변화 없음
  await rows.nth(1).dragTo(rows.nth(1), { targetPosition: { x: 80, y: 20 } });
  await page.waitForTimeout(300);
  check('제자리에 놓으면 그대로', (await order()) === 'RGBY');

  /* 4) 화살표 버튼 */
  await rows.nth(0).locator('button[title="한 칸 아래로"]').click();
  await page.waitForTimeout(300);
  check('↓ 버튼은 한 칸 아래로', (await order()) === 'GRBY', await order());
  check('맨 위 행의 ↑ 는 비활성', await rows.nth(0).locator('button[title="한 칸 위로"]').isDisabled());

  /* 5) 화면에서 손잡이 끌기 */
  await page.click('.tool:has-text("선택")');
  await page.waitForSelector('.cutGrip');
  check('화면의 컷마다 번호가 적힌 손잡이가 있다', (await page.locator('.cutGrip').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s|⠿/g, '')).join(''))) === '0123');
  const g3 = await page.locator('[data-cut-grip="3"]').boundingBox();
  const cut0 = await page.locator('.cut').first().boundingBox();
  const cutsBox = await page.locator('.cutCanvas').first().boundingBox();
  await page.mouse.move(g3.x + g3.width / 2, g3.y + g3.height / 2);
  await page.mouse.down();
  await page.mouse.move(g3.x + 30, g3.y - 150, { steps: 8 });
  const midLine = await page.locator('.cutDropLine').count();
  await page.screenshot({ path: path.join(SHOTS, '09-reorder-drag.png') });
  await page.mouse.move(g3.x + 30, cutsBox.y + 8, { steps: 10 });
  check('끄는 동안 놓을 자리 표시선이 보인다', midLine === 1 && (await page.locator('.cutDropLine').count()) === 1);
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('손잡이를 맨 위로 끌어 놓으면 맨 위로 이동', (await order()) === 'YGRB', await order());
  await page.screenshot({ path: path.join(SHOTS, '10-reorder-done.png') });
  check('이동 뒤에도 표시선이 남지 않는다', (await page.locator('.cutDropLine').count()) === 0);

  // 가운데로 끌기: 맨 위(Y)를 2번 자리로 → 컷 2 와 3 사이
  const gy = await page.locator('[data-cut-grip="0"]').boundingBox();
  const c2 = await page.locator('.cutCanvas').nth(0).boundingBox(); // 첫 DOM 컷은 현재 Y 가 아님 → 위치로 계산
  const stripTop = await page.evaluate(() => { const r = document.querySelector('.strip').getBoundingClientRect(); return { y: r.top, h: r.height }; });
  const scale = stripTop.h / (4 * 260 + 3 * 40);
  const targetY = stripTop.y + (260 * 2.5 + 40 * 2) * scale; // 3번째 컷 중심 근처
  await page.mouse.move(gy.x + gy.width / 2, gy.y + gy.height / 2);
  await page.mouse.down();
  await page.mouse.move(gy.x + 20, targetY + 60 * scale, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('손잡이를 가운데로 끌면 그 자리(2번)로 이동', (await order()) === 'GRYB', await order());

  /* 6) 저장 파일에도 새 순서가 반영 */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("저장(.wtoon)")')]);
  const wt = path.join(OUT, 'test-reorder.wtoon'); await dl.saveAs(wt);
  const d = JSON.parse(fs.readFileSync(wt, 'utf8'));
  const cols = await Promise.all(d.cuts.map(async (c) => { const b = Buffer.from(c.src.split(',')[1], 'base64'); const { data } = await sharp(b).raw().toBuffer({ resolveWithObject: true }); return data[0] > 200 && data[1] < 80 ? 'R' : data[1] > 150 && data[0] < 80 ? 'G' : data[2] > 180 && data[0] < 90 ? 'B' : 'Y'; }));
  check('.wtoon 의 컷 순서가 화면과 같다', cols.join('') === 'GRYB', cols.join(''));
  check('콘솔/페이지 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failed === 0 ? '\n컷 순서 테스트 전부 통과' : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(2); });
