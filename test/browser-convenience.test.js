/**
 * 편의 기능 브라우저 테스트 (실제 Chromium)
 *  단축키(한글 입력 상태 포함) · 확대/축소 · 원본 비교 · 복제/삭제/방향키 이동 · 붙여넣기 · 끌어놓기
 *  · 불러오기 되돌리기 · 자동저장/복구 · 말풍선 더블클릭 편집 · 분할 저장 · 새로 시작
 *
 *   NODE_PATH=<글로벌 node_modules> node test/browser-convenience.test.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
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
const URL = process.env.WTOON_URL || 'file://' + path.join(OUT, 'web', 'index.html');

async function makePng(file, rgb, w = 900, h = 800) {
  await sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toFile(file);
  return file;
}

(async () => {
  const COLORS = { R: [220, 40, 40], G: [40, 190, 70], B: [50, 90, 230], Y: [240, 210, 40] };
  const pngs = {};
  for (const [k, c] of Object.entries(COLORS)) pngs[k] = await makePng(path.join(OUT, `conv-${k}.png`), c);
  const smallPng = await makePng(path.join(OUT, 'conv-small.png'), [120, 60, 200], 900, 300);
  const smallB64 = fs.readFileSync(smallPng).toString('base64');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  // 파일 저장 창(File System Access)이 없는 브라우저(Firefox·Safari)처럼 동작시켜 다운로드 저장 경로를 검증한다. 저장 창 경로는 browser-v14 에서 따로 검증
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const page = await ctx.newPage();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };
  watch(page);
  await page.goto(URL);
  await page.waitForSelector('.empty');
  const cutCount = (p = page) => p.locator('.cut').count();
  const zoomPct = async (p = page) => parseInt((await p.locator('.zoom').innerText()).replace('%', ''), 10);
  const activeTool = async () => (await page.locator('.toolOn').innerText()).replace(/\s+/g, ' ').trim();
  const snap = () =>
    page.evaluate(() => {
      const c = document.querySelector('.cutCanvas');
      return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
    });
  const diffPx = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 2 || Math.abs(a[i + 1] - b[i + 1]) > 2 || Math.abs(a[i + 2] - b[i + 2]) > 2) n++; return n; };
  /** 한글 자판 상태를 흉내: key 는 한글, code 는 물리 키 */
  const koreanKey = (code, key) => page.evaluate(({ code, key }) => { document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true })); document.body.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true })); }, { code, key });

  /* ========== 1) 시작 + 샘플 ========== */
  await page.click('button:has-text("샘플 장면")');
  await page.waitForSelector('.cutCanvas');
  await page.waitForTimeout(900);
  check('첫 컷을 올리면 화면 폭에 맞춰 보인다', (await zoomPct()) >= 60, `${await zoomPct()}%`);

  /* ========== 2) 단축키 ========== */
  await page.keyboard.press('KeyL');
  check('L → 올가미', (await activeTool()).includes('올가미'), await activeTool());
  await page.keyboard.press('KeyW');
  check('W → 마술봉', (await activeTool()).includes('마술봉'));
  await page.keyboard.press('KeyM');
  check('M → 사각', (await activeTool()).includes('사각'));
  await page.keyboard.press('KeyE');
  check('E → 타원', (await activeTool()).includes('타원'));
  await page.keyboard.press('KeyB');
  check('B → 브러시', (await activeTool()).includes('브러시'));
  const br0 = parseInt(await page.locator('.optbar input[type=range]').first().inputValue(), 10);
  await page.keyboard.press('BracketRight');
  const br1 = parseInt(await page.locator('.optbar input[type=range]').first().inputValue(), 10);
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('BracketLeft');
  const br2 = parseInt(await page.locator('.optbar input[type=range]').first().inputValue(), 10);
  check('] 는 브러시 크게, [ 는 작게', br1 === br0 + 6 && br2 === br0 - 6, `${br0} → ${br1} → ${br2}`);
  await page.keyboard.press('Escape');
  check('Esc → 선택/이동', (await activeTool()).includes('선택'));
  await koreanKey('KeyL', 'ㅣ');
  check('한글 입력 상태(키 ㅣ, 물리 키 L)에서도 올가미', (await activeTool()).includes('올가미'), await activeTool());
  await koreanKey('KeyV', 'ㅍ');
  check('한글 입력 상태(ㅍ)에서도 선택/이동', (await activeTool()).includes('선택'));

  await page.keyboard.press('Shift+Slash');
  await page.waitForSelector('.modal[aria-label="단축키 안내"]');
  check('? 로 단축키 안내가 열린다', (await page.locator('.helpRow').count()) >= 15, `${await page.locator('.helpRow').count()}행`);
  await page.keyboard.press('KeyL'); // 안내가 열려 있을 땐 도구가 바뀌면 안 된다
  check('안내가 열려 있는 동안엔 단축키가 막힌다', (await activeTool()).includes('선택'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal[aria-label="단축키 안내"]', { state: 'detached' });
  check('Esc 로 안내가 닫힌다', true);

  const z0 = await zoomPct();
  await page.keyboard.press('Minus');
  await page.keyboard.press('Minus');
  const zDown = await zoomPct();
  await page.keyboard.press('Equal');
  const zUp = await zoomPct();
  check('− − + 로 확대/축소', zDown === z0 - 20 && zUp === z0 - 10, `${z0} → ${zDown} → ${zUp}`);
  await page.keyboard.press('Digit0');
  await page.waitForTimeout(100);
  check('0 → 화면에 맞춤', (await zoomPct()) >= 60);
  const zBefore = await zoomPct();
  const cb = await page.locator('.center').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 400);
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  const zWheel = await zoomPct();
  check('Ctrl + 휠로 확대/축소', zWheel < zBefore, `${zBefore} → ${zWheel}`);
  await page.keyboard.press('Digit0');

  /* ========== 3) 원본 비교 ========== */
  await page.waitForTimeout(400);
  const withFx = await snap();
  await page.keyboard.down('KeyC');
  await page.waitForTimeout(500);
  const orig = await snap();
  const badge = await page.locator('.compareBadge').count();
  await page.keyboard.up('KeyC');
  await page.waitForTimeout(500);
  const back = await snap();
  check('C 를 누르고 있으면 효과 없는 원본이 보인다', diffPx(withFx, orig) > 3000 && badge === 1, `${diffPx(withFx, orig)}px · 배지 ${badge}`);
  check('C 를 떼면 효과가 다시 보인다', diffPx(withFx, back) === 0 && (await page.locator('.compareBadge').count()) === 0);
  const btn = await page.locator('button:has-text("원본 비교")').boundingBox();
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(500);
  const orig2 = await snap();
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('“원본 비교” 버튼도 누르는 동안만 원본', diffPx(withFx, orig2) > 3000 && diffPx(withFx, await snap()) === 0);

  /* ========== 4) 복제 / 삭제 / 방향키 이동 ========== */
  const effRows = () => page.locator('.layerRow:has(.layerType:text-is("흔들림"))');
  check('샘플 컷에는 효과 레이어가 있다', (await effRows().count()) >= 1);
  const before = await effRows().count();
  await effRows().first().click();
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(250);
  check('효과를 선택하고 Ctrl+D → 효과 레이어가 복제된다', (await effRows().count()) === before + 1 && (await page.locator('.layerRow:has-text("복사")').count()) >= 1);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  check('Delete → 선택한 효과 레이어 삭제', (await effRows().count()) === before);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  check('Ctrl+Z → 삭제한 효과가 돌아온다', (await effRows().count()) === before + 1);
  await page.keyboard.press('Control+z'); // 복제도 취소
  await page.waitForTimeout(250);

  await page.click('.tabs button:has-text("말풍선")');
  await page.click('.kindBtn:has-text("기본 대사")');
  await page.waitForTimeout(250);
  const bub = () => page.locator('.bubbleLayer g[data-bubble]');
  const bx = async () => (await bub().last().boundingBox());
  const p0 = await bx();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.waitForTimeout(250);
  const p1 = await bx();
  const zNow = (await zoomPct()) / 100;
  check('방향키로 말풍선 이동(→×3 = 3px, Shift+↓ = 10px)', Math.abs(p1.x - p0.x - 3 * zNow) < 1.2 && Math.abs(p1.y - p0.y - 10 * zNow) < 1.2, `dx=${(p1.x - p0.x).toFixed(1)} dy=${(p1.y - p0.y).toFixed(1)} (확대 ${zNow})`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const p2 = await bx();
  check('방향키 이동은 한 번에 되돌려진다(연속 입력 묶음)', Math.abs(p2.x - p0.x) < 1.2 && Math.abs(p2.y - p0.y) < 1.2, `dx=${(p2.x - p0.x).toFixed(1)} dy=${(p2.y - p0.y).toFixed(1)}`);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(200);
  check('말풍선을 선택하고 Ctrl+D → 복제', (await bub().count()) === 2);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(200);
  check('Delete → 선택한(복제된) 말풍선만 삭제', (await bub().count()) === 1);

  // 더블클릭하면 글자 편집 칸으로
  await page.click('.tabs button:has-text("효과")');
  const bb = await bub().first().boundingBox();
  await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(300);
  const dbl = await page.evaluate(() => ({ tab: document.querySelector('.tabs button.on')?.textContent, tag: document.activeElement?.tagName, sel: document.activeElement?.selectionEnd - document.activeElement?.selectionStart, len: document.activeElement?.value?.length }));
  check('말풍선 더블클릭 → 말풍선 탭 + 글자칸 포커스 + 전체 선택', dbl.tab === '말풍선' && dbl.tag === 'TEXTAREA' && dbl.sel === dbl.len && dbl.len > 0, JSON.stringify(dbl));
  await page.keyboard.press('KeyL'); // 글자칸에 쓰는 중에는 단축키가 아니라 글자로 들어간다
  const typed = await page.evaluate(() => document.activeElement.value);
  check('글자칸에서는 L 이 도구 변경이 아니라 글자 입력', typed === 'l' && (await activeTool()).includes('선택'), typed);
  await page.keyboard.press('Control+z'); // 글자칸 안에서의 되돌리기는 브라우저 몫 — 앱 전체 undo 가 실행되면 안 된다
  check('글자칸 안의 Ctrl+Z 는 앱 되돌리기를 건드리지 않는다', (await bub().count()) === 1);
  await page.locator('body').click({ position: { x: 5, y: 450 } });

  // 컷 복제
  await page.click('.tabs button:has-text("컷")');
  await page.locator('.cutRow').first().click();
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(300);
  const rows = await page.locator('.cutRow .layerName').allInnerTexts();
  check('컷 선택 + Ctrl+D → 효과까지 복제된 컷이 아래에 생긴다', (await cutCount()) === 2 && rows.length === 2 && rows[0] === rows[1] && !rows[0].endsWith(' 0'), rows.join(' | '));
  await page.locator('.cutRow').nth(1).locator('button[title^="컷 삭제"]').click();
  await page.waitForTimeout(250);
  check('컷 삭제 버튼', (await cutCount()) === 1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  check('Ctrl+Z 로 삭제한 컷이 돌아온다', (await cutCount()) === 2);
  await page.locator('.cutRow').nth(1).locator('button[title^="컷 삭제"]').click();
  await page.waitForTimeout(200);

  /* ========== 5) 붙여넣기 ========== */
  const pasteImage = (target) =>
    page.evaluate(({ b64, target }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
      const el = target ? document.querySelector(target) : window;
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, { b64: smallB64, target });
  const n0 = await cutCount();
  await pasteImage(null);
  await page.waitForFunction((n) => document.querySelectorAll('.cut').length === n, n0 + 1, { timeout: 8000 }).catch(() => {});
  check('Ctrl+V 로 복사한 이미지가 컷으로 붙는다', (await cutCount()) === n0 + 1, `${n0} → ${await cutCount()}`);
  await page.click('.tabs button:has-text("말풍선")');
  await page.locator('textarea.text').first().focus().catch(() => {});
  if ((await page.locator('textarea.text').count()) > 0) {
    await pasteImage('textarea.text');
    await page.waitForTimeout(500);
    check('글자칸에 붙여넣을 때는 컷이 늘지 않는다', (await cutCount()) === n0 + 1);
  }
  await page.locator('body').click({ position: { x: 5, y: 450 } });

  /* ========== 6) Ctrl+S 저장 → 끌어놓기 불러오기 + 되돌리기 ========== */
  const [dlS] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const wt = path.join(OUT, 'conv.wtoon');
  await dlS.saveAs(wt);
  check('Ctrl+S → .wtoon 파일이 저장된다', dlS.suggestedFilename().endsWith('.wtoon') && JSON.parse(fs.readFileSync(wt, 'utf8')).cuts.length === n0 + 1, dlS.suggestedFilename());
  const wtText = fs.readFileSync(wt, 'utf8');

  const dropFiles = (kind) =>
    page.evaluate(async ({ b64, wtText, kind }) => {
      const dt = new DataTransfer();
      if (kind === 'image') dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
      else dt.items.add(new File([wtText], 'saved.wtoon', { type: 'application/json' }));
      const app = document.querySelector('.app');
      app.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 120));
      const overlay = !!document.querySelector('.dropOverlay');
      app.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return overlay;
    }, { b64: smallB64, wtText, kind });
  await page.click('.tabs button:has-text("효과")');
  const nDrop0 = await cutCount();
  const overlaySeen = await dropFiles('image');
  await page.waitForFunction((n) => document.querySelectorAll('.cut').length === n, nDrop0 + 1, { timeout: 8000 }).catch(() => {});
  check('이미지를 끌어다 놓는 동안 안내 표시, 놓으면 컷이 추가된다', overlaySeen && (await cutCount()) === nDrop0 + 1 && (await page.locator('.dropOverlay').count()) === 0, `${nDrop0} → ${await cutCount()}`);

  // 저장해 둔 .wtoon (컷 n0+1 개) 을 끌어놓기 → 지금 작업(컷 n0+2 개)이 교체되지만 Ctrl+Z 로 돌아올 수 있다
  const nBeforeLoad = await cutCount();
  await dropFiles('wtoon');
  await page.waitForFunction((n) => document.querySelectorAll('.cut').length === n, n0 + 1, { timeout: 8000 }).catch(() => {});
  check('.wtoon 을 끌어다 놓으면 프로젝트가 불러와진다', (await cutCount()) === n0 + 1, `${nBeforeLoad} → ${await cutCount()}`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  check('불러온 직후 Ctrl+Z → 이전 작업으로 돌아온다(작업이 사라지지 않는다)', (await cutCount()) === nBeforeLoad, `${await cutCount()}개`);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  check('Ctrl+Shift+Z → 불러온 상태로 다시', (await cutCount()) === n0 + 1);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  /* ========== 7) 자동 저장 / 복구 ========== */
  await page.waitForFunction(() => /자동저장됨/.test(document.querySelector('[data-testid=save-state]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  check('작업하면 “자동저장됨 시각”이 표시된다', /자동저장됨/.test(await page.locator('[data-testid=save-state]').innerText().catch(() => '')));
  const keepCuts = await cutCount();
  await page.waitForTimeout(2200); // 마지막 변경 뒤 저장이 끝나도록
  const page2 = await ctx.newPage();
  watch(page2);
  await page2.goto(URL);
  await page2.waitForSelector('.empty');
  await page2.waitForSelector('.recoverBar', { timeout: 6000 }).catch(() => {});
  const barText = (await page2.locator('.recoverBar').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('다시 열면 “이전 작업이 남아 있어요” 복구 안내가 뜬다', barText.includes('이전 작업') && barText.includes(`컷 ${keepCuts}개`), barText);
  await page2.screenshot({ path: path.join(SHOTS, '11-recover.png') });
  await page2.click('.recoverBar button:has-text("복구")');
  await page2.waitForFunction((n) => document.querySelectorAll('.cut').length === n, keepCuts, { timeout: 8000 }).catch(() => {});
  check('복구를 누르면 컷·효과·말풍선이 돌아온다', (await cutCount(page2)) === keepCuts && (await page2.locator('.bubbleLayer g[data-bubble]').count()) === 1 && (await page2.locator('.recoverBar').count()) === 0);
  await page2.waitForTimeout(2200);
  const page3 = await ctx.newPage();
  watch(page3);
  await page3.goto(URL);
  await page3.waitForSelector('.empty');
  await page3.waitForSelector('.recoverBar', { timeout: 6000 }).catch(() => {});
  check('복구한 뒤에도 자동저장이 이어진다(다시 열면 또 안내)', (await page3.locator('.recoverBar').count()) === 1);
  await page3.click('.recoverBar button:has-text("버리기")');
  await page3.waitForTimeout(500);
  const page4 = await ctx.newPage();
  watch(page4);
  await page4.goto(URL);
  await page4.waitForSelector('.empty');
  await page4.waitForTimeout(1200);
  check('버리기를 누르면 다음에는 안내가 뜨지 않는다', (await page4.locator('.recoverBar').count()) === 0);
  await page2.close(); await page3.close(); await page4.close();

  /* ========== 8) 새로 시작 / 되돌리기 ========== */
  await page.click('button:has-text("더보기")');
  await page.click('[role=menuitem]:has-text("새로 시작")');
  await page.waitForSelector('.empty');
  check('더보기 → 새로 시작 → 빈 화면', (await cutCount()) === 0);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  check('Ctrl+Z 로 새로 시작을 취소하면 작업이 돌아온다', (await cutCount()) === keepCuts);
  await page.click('button:has-text("더보기")');
  const menuText = (await page.locator('[role=menu]').innerText()).replace(/\s+/g, ' ');
  check('더보기 메뉴: PNG · PSD · 분할 저장 · 새로 시작', ['PNG', 'PSD', '분할 저장', '새로 시작'].every((t) => menuText.includes(t)), menuText);
  await page.screenshot({ path: path.join(SHOTS, '12-more-menu.png') });
  await page.keyboard.press('Escape');
  check('Esc 로 메뉴가 닫힌다', (await page.locator('[role=menu]').count()) === 0);
  await page.click('button:has-text("더보기")');
  await page.mouse.click(300, 450);
  check('바깥을 누르면 메뉴가 닫힌다', (await page.locator('[role=menu]').count()) === 0);
  await page.close();

  /* ========== 9) 분할 저장 (새 페이지: 컷 4개 + 말풍선) ========== */
  const px = await ctx.newPage();
  watch(px);
  await px.goto(URL);
  await px.waitForSelector('.empty');
  // 이전 페이지의 자동저장이 남아 있으니 복구는 버린다
  await px.waitForSelector('.recoverBar', { timeout: 4000 }).catch(() => {});
  if (await px.locator('.recoverBar').count()) await px.click('.recoverBar button:has-text("버리기")');
  await px.setInputFiles('input[type=file][accept="image/*,.clip"]', [pngs.R, pngs.G, pngs.B, pngs.Y]);
  await px.waitForFunction(() => document.querySelectorAll('.cutCanvas').length === 4, null, { timeout: 15000 });
  await px.waitForTimeout(600);
  await px.click('.tabs button:has-text("말풍선")');
  await px.click('.kindBtn:has-text("외침")'); // 선택된 컷(마지막) 위쪽에 생긴다
  await px.waitForTimeout(200);
  // 외침 말풍선의 가시 모양은 시드(무작위)로 정해진다. 실행마다 같은 모양으로 비교하도록 시드를 고정한다
  await px.locator('label.field:has-text("모양 변화(시드)") input[type=range]').evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '7');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await px.waitForTimeout(150);
  // 컷 R/G 사이(자르는 위치 820 근처)로 올린다: 시작 y=3*840+40=2560 → 위로 1800px(Shift+↑ 10px씩) = 760
  for (let i = 0; i < 180; i++) await px.keyboard.press('Shift+ArrowUp');
  await px.waitForTimeout(300);

  // 화면에 그려진 말풍선의 실제 영역(페이지 px). 뾰족한 외침 말풍선은 박스 밖으로 가시가 튀어나오므로 그리는 영역 그대로 잰다
  const bubBox = await px.evaluate(() => { const b = document.querySelector(".bubbleLayer g[data-bubble]").getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await px.click('button:has-text("더보기")');
  await px.click('[role=menuitem]:has-text("분할 저장")');
  await px.waitForSelector('.modal[aria-label="분할 저장"]');
  const info = async () => (await px.locator('[data-testid=export-info]').innerText()).replace(/\s+/g, ' ');
  const i1 = await info();
  check('분할 저장 창: 전체 3,320px → 4장 계획이 보인다', i1.includes('3,320') && i1.includes('4장'), i1);
  await px.screenshot({ path: path.join(SHOTS, '13-export-dialog.png') });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wtoon-slices-'));
  const unzip = (zipPath, dir) => {
    fs.mkdirSync(dir, { recursive: true });
    return execFileSync('python3', ['-I', '-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; z.extractall(sys.argv[2]); print('\\n'.join(sorted(z.namelist())))", zipPath, dir]).toString().trim().split('\n');
  };

  // (a) PNG 원본 폭, 분할
  await px.click('.modal .seg button:has-text("PNG")');
  const [dlA] = await Promise.all([px.waitForEvent('download'), px.click('.modal .btn.primary')]);
  const zipA = path.join(tmpDir, 'a.zip');
  await dlA.saveAs(zipA);
  const namesA = unzip(zipA, path.join(tmpDir, 'a'));
  const metaA = await Promise.all(namesA.map((n) => sharp(path.join(tmpDir, 'a', n)).metadata()));
  check('분할 저장 PNG: ZIP 안에 4장, 이름 순서 webtoon_001..004', dlA.suggestedFilename() === 'webtoon-slices.zip' && namesA.join(',') === 'webtoon_001.png,webtoon_002.png,webtoon_003.png,webtoon_004.png', namesA.join(','));
  check('조각 크기: 가로 900, 높이 820/840/840/820 (컷 사이 여백에서 자름)', metaA.every((m) => m.width === 900) && metaA.map((m) => m.height).join(',') === '820,840,840,820', metaA.map((m) => `${m.width}x${m.height}`).join(' '));
  await px.waitForSelector('.modal', { state: 'detached', timeout: 5000 }).catch(() => {});

  // (b) 같은 내용을 분할 없이 한 장으로 → 조각을 이어 붙인 것과 같아야 한다
  await px.click('button:has-text("더보기")');
  await px.click('[role=menuitem]:has-text("분할 저장")');
  await px.waitForSelector('.modal[aria-label="분할 저장"]');
  await px.click('.modal .seg button:has-text("PNG")');
  await px.locator('.modal label.check input').uncheck();
  const [dlB] = await Promise.all([px.waitForEvent('download'), px.click('.modal .btn.primary')]);
  const fullPng = path.join(tmpDir, 'full.png');
  await dlB.saveAs(fullPng);
  const full = await sharp(fullPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const parts = await Promise.all(namesA.map((n) => sharp(path.join(tmpDir, 'a', n)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  const stitched = Buffer.concat(parts.map((p) => p.data));
  // 큰 SVG 와 작은 SVG 는 곡선 가장자리의 안티앨리어싱이 아주 조금 다를 수 있다(보이지 않는 수준).
  // 그래서 "완전히 같다"가 아니라 ① 컷·배경 픽셀은 100% 같고 ② 차이는 말풍선 곡선 가장자리 몇 픽셀에 한정되며 ③ 조각 경계에 이음새(줄 단위 어긋남)가 없는지를 본다.
  const bounds = []; { let y = 0; for (const m of parts) { y += m.info.height; bounds.push(y); } bounds.pop(); }
  let bad = 0, maxd = 0, nearSeam = 0, outsideBubble = 0, bigDiff = 0, bigOnSeam = 0;
  if (stitched.length === full.data.length) {
    for (let i = 0; i < stitched.length; i += 4) {
      const d = Math.max(Math.abs(stitched[i] - full.data[i]), Math.abs(stitched[i + 1] - full.data[i + 1]), Math.abs(stitched[i + 2] - full.data[i + 2]));
      if (d > 12) {
        bad++;
        const idx = i / 4, x = idx % 900, y = Math.floor(idx / 900);
        const onSeam = bounds.some((b0) => Math.abs(y - b0) <= 1);
        if (onSeam) nearSeam++;
        if (d > 60) { bigDiff++; if (onSeam) bigOnSeam++; }
        if (x < bubBox.x - 12 || x > bubBox.x + bubBox.w + 12 || y < bubBox.y - 12 || y > bubBox.y + bubBox.h + 12) outsideBubble++;
        if (process.env.DEBUG_DIFF) console.log('diff', x, y, d);
      }
      if (d > maxd) maxd = d;
    }
  } else bad = -1;
  check('한 장 저장(분할 없음) = 단일 파일, 3320px', dlB.suggestedFilename() === 'webtoon.png' && full.info.width === 900 && full.info.height === 3320, `${dlB.suggestedFilename()} ${full.info.width}x${full.info.height}`);
  // 말풍선 모양(시드)을 고정했으므로 결과가 매번 같다(다른 픽셀 4개, 최대 차이 32). 여유를 두고 12개 이하·큰 차이 0개로 확인한다.
  // 이음새가 어긋나면 말풍선 전체가 밀려 수백 픽셀이 달라지고 말풍선 밖에도 차이가 생기므로 이 기준으로 충분히 잡힌다.
  check('조각을 이어 붙이면 한 장 저장과 같다(차이는 말풍선 안 가장자리 몇 픽셀뿐, 이음새·말풍선 밖 차이 없음)', bad >= 0 && bad <= 12 && bigDiff === 0 && bigOnSeam === 0 && outsideBubble === 0, bad < 0 ? '크기 불일치' : `다른 픽셀 ${bad}개 · 큰 차이(>60) ${bigDiff}개(이음새 위 ${bigOnSeam}) · 최대 ${maxd} · 이음새 근처 ${nearSeam} · 말풍선 영역 ${Math.round(bubBox.x)},${Math.round(bubBox.y)} ${Math.round(bubBox.w)}×${Math.round(bubBox.h)} 밖 ${outsideBubble}개`);
  check('조각 경계에 이음새가 없다(진짜 이음새라면 경계 ±1줄에서 수백 픽셀이 어긋난다. 여기서는 가장자리 몇 픽셀뿐)', nearSeam <= 40, `${nearSeam}개`);

  // 말풍선이 정말 그려졌는지: 가운데 열의 흰 픽셀 수가, 말풍선이 없는 가장자리 열(컷 사이 여백 3×40=120px)보다 훨씬 많아야 한다
  const whiteRows = (x) => { let n = 0; for (let y = 0; y < 3320; y++) { const i = (y * 900 + x) * 4; if (full.data[i] > 235 && full.data[i + 1] > 235 && full.data[i + 2] > 235) n++; } return n; };
  check('말풍선이 결과 이미지에 들어 있다', whiteRows(450) > whiteRows(30) + 40, `가운데 ${whiteRows(450)} / 가장자리 ${whiteRows(30)}`);

  // (c) JPG, 가로 720, 최대 세로 1280 → 전부 720 폭, 1280 이하
  await px.click('button:has-text("더보기")');
  await px.click('[role=menuitem]:has-text("분할 저장")');
  await px.waitForSelector('.modal[aria-label="분할 저장"]');
  await px.fill('input[aria-label="가로"]', '720');
  const i3 = await info();
  const [dlC] = await Promise.all([px.waitForEvent('download'), px.click('.modal .btn.primary')]);
  const zipC = path.join(tmpDir, 'c.zip');
  await dlC.saveAs(zipC);
  const namesC = unzip(zipC, path.join(tmpDir, 'c'));
  const metaC = await Promise.all(namesC.map((n) => sharp(path.join(tmpDir, 'c', n)).metadata()));
  check('가로 720 JPG: 모든 조각이 720 폭·1280 이하', namesC.length >= 3 && namesC.every((n) => n.endsWith('.jpg')) && metaC.every((m) => m.width === 720 && m.height <= 1280 && m.format === 'jpeg'), `${i3} | ${metaC.map((m) => `${m.width}x${m.height}`).join(' ')}`);
  const sumH = metaC.reduce((s, m) => s + m.height, 0);
  check('조각 높이의 합 = 3320 × 0.8 (빠지거나 겹치는 구간 없음)', Math.abs(sumH - Math.round(3320 * 0.8)) <= metaC.length, `${sumH}`);

  // (d) 닫기 / 바깥 클릭
  await px.click('button:has-text("더보기")');
  await px.click('[role=menuitem]:has-text("분할 저장")');
  await px.waitForSelector('.modal[aria-label="분할 저장"]');
  await px.keyboard.press('Escape');
  check('분할 저장 창은 Esc 로 닫힌다', (await px.locator('.modal').count()) === 0);

  check('콘솔/페이지 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failed === 0 ? '\n편의 기능 테스트 전부 통과' : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('테스트 중단:', e);
  process.exit(2);
});
