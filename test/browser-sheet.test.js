/** 효과음 시트 자르기: 투명/불투명 시트를 올려 조각 수·내용·등록·컷에 붙이기까지 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const sharp = require('sharp');
const OUT = path.join(__dirname, 'out');
const DIR = path.join(OUT, 'sheet');
fs.mkdirSync(DIR, { recursive: true });
const URL = process.env.WTOON_URL || 'file://' + path.join(OUT, 'web', 'index.html');
let failed = 0;
const check = (n, ok, i = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); if (!ok) failed++; };

const SIZE = 3200, COLS = 5, ROWS = 4, CELL = 600;
/** 조각 하나 = 서로 3~5px 떨어진 획 3개(+ 하나는 작은 점 먼지). 칸 사이는 100px 이상 */
function svg(bg) {
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${bg ? `<rect width="100%" height="100%" fill="${bg}"/>` : ''}`;
  const cols = ['#e0284f', '#2a5bd7', '#1a1a1a', '#e8a317', '#16a34a'];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const x = 100 + c * CELL, y = 100 + r * CELL, col = cols[(r + c) % 5];
    s += `<rect x="${x}" y="${y}" width="140" height="300" fill="${col}"/>`;
    s += `<rect x="${x + 146}" y="${y + 40}" width="140" height="260" fill="${col}"/>`;
    s += `<circle cx="${x + 370}" cy="${y + 150}" r="80" fill="${col}"/>`;
  }
  s += `<circle cx="${SIZE - 30}" cy="${SIZE - 30}" r="3" fill="#000"/>`; // 먼지
  return s + '</svg>';
}
(async () => {
  const alphaPng = path.join(DIR, 'sheet-alpha.png'), opaquePng = path.join(DIR, 'sheet-gray.png');
  await sharp(Buffer.from(svg(null))).png().toFile(alphaPng);
  await sharp(Buffer.from(svg('#b0b0b0'))).png().toFile(opaquePng);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForSelector('.empty');
  if (await page.locator('.recoverBar').count()) await page.click('.recoverBar button:has-text("버리기")');
  await page.click('button:has-text("샘플 장면(콜라+흔들림)")');
  await page.waitForSelector('.cutCanvas');
  await page.click('.tabs button:has-text("소재")');
  const count = async () => parseInt(((await page.locator('[data-testid=sheet-count]').innerText()).match(/(\d+)개를 찾았고 (\d+)/) || [])[1] || '-1', 10);
  const regd = async () => parseInt(((await page.locator('[data-testid=sheet-count]').innerText()).match(/찾았고 (\d+)개를 등록/) || [])[1] || '-1', 10);
  const setRange = (label, v) => page.locator('.modal label.field', { hasText: label }).locator('input[type=range]').evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); }, v);

  // ---- 투명 시트 ----
  await page.setInputFiles('[data-testid=sheet-input]', alphaPng);
  await page.waitForSelector('[data-testid=sheet-count]', { timeout: 30000 });
  await page.waitForTimeout(800);
  check('투명 시트: 20개 조각(획 3개씩 묶임, 먼지 제외)', (await count()) === 20, `${await count()}개`);
  check('투명 배경으로 인식', (await page.locator('[data-testid=sheet-count]').innerText()).includes('투명 배경'));
  await setRange('묶는 거리', 0);
  await page.waitForTimeout(900);
  check('묶는 거리 0 → 획마다 따로(60개 이상)', (await count()) >= 60, `${await count()}개`);
  await setRange('묶는 거리', 24);
  await page.waitForTimeout(900);
  check('다시 24px → 20개', (await count()) === 20);
  await page.locator('.sheetBox').nth(0).click();
  await page.locator('.sheetBox').nth(1).click();
  check('상자를 눌러 2개를 빼면 18개 등록', (await regd()) === 18, `${await regd()}`);
  await page.screenshot({ path: path.join(OUT, 'shots', '17-sheet-dialog.png') });
  await page.click('[data-testid=sheet-run]');
  await page.waitForSelector('[data-testid=sheet-dialog]', { state: 'detached', timeout: 60000 });
  await page.waitForTimeout(600);
  const thumbs = await page.locator('.matItem, .matCard, .matGrid > *').count();
  const names = await page.evaluate(() => Array.from(document.querySelectorAll('.matGrid *, .matItem *')).map((e) => e.textContent).filter((t) => /효과음 \d{3}/.test(t || '')).slice(0, 3));
  check('소재 탭에 효과음 001… 이름으로 등록된다', names.length > 0, `${names[0] || ''} (${thumbs})`);
  check('안내 토스트', (await page.locator('.toast').innerText()).includes('18개를 등록'), await page.locator('.toast').innerText());

  // 등록된 조각 한 장의 실제 크기·투명도 확인 (IndexedDB 에 저장된 dataURL)
  const info = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('wtoon-materials'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result); });
    const m = all.filter((x) => /^효과음 \d{3}$/.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))[0];
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = m.src; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let a = 0, t = 0;
    for (let i = 3; i < d.length; i += 4) { t++; if (d[i] > 200) a++; }
    return { n: all.length, name: m.name, w: img.width, h: img.height, fill: a / t, corner: d[3] };
  });
  check('저장된 소재 수 18', info.n === 18, `${info.n}`);
  check('원본 해상도로 잘렸다(조각 약 460×320)', info.w > 440 && info.w < 500 && info.h > 300 && info.h < 345, `${info.w}×${info.h}`);
  check('배경은 투명(모서리 알파 0)이고 그림은 남아 있다', info.corner === 0 && info.fill > 0.3, `fill ${info.fill.toFixed(2)}`);

  // 컷에 붙이기
  await page.locator('.matItem').first().click();
  await page.click('button:has-text("컷에 한 장 붙이기")');
  await page.waitForTimeout(1000);
  await page.click('.tabs button:has-text("효과")');
  check('소재를 컷에 붙이면 효과 레이어가 생긴다', (await page.locator('.layerRow:has-text("효과음")').count()) >= 1);

  // ---- 불투명(회색 바탕) 시트 ----
  await page.click('.tabs button:has-text("소재")');
  await page.setInputFiles('[data-testid=sheet-input]', opaquePng);
  await page.waitForSelector('[data-testid=sheet-count]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  check('회색 바탕 시트: 바탕색을 지워서 인식 + 20개', (await page.locator('[data-testid=sheet-count]').innerText()).includes('바탕색을 지워서') && (await count()) === 20, `${await count()}개`);
  await page.click('[data-testid=sheet-run]');
  await page.waitForSelector('[data-testid=sheet-dialog]', { state: 'detached', timeout: 60000 });
  const info2 = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('wtoon-materials'); r.onsuccess = () => res(r.result); });
    const all = await new Promise((res) => { const q = db.transaction('items').objectStore('items').getAll(); q.onsuccess = () => res(q.result); });
    const m = all.filter((x) => /^효과음 001$/.test(x.name)).pop();
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = m.src; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let bgOpaque = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 176) < 6 && Math.abs(d[i + 1] - 176) < 6 && d[i + 3] > 40) bgOpaque++;
    return { n: all.length, bgOpaque, corner: d[3] };
  });
  check('불투명 시트의 회색 바탕이 투명하게 빠진다', info2.n === 38 && info2.bgOpaque === 0 && info2.corner === 0, JSON.stringify(info2));
  check('콘솔/페이지 에러 없음', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  console.log(failed ? `\n실패 ${failed}건` : '\n효과음 시트 테스트 전부 통과');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
