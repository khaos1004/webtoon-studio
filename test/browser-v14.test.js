/**
 * v1.4 편의 기능 검증 (실제 Chromium)
 *  1) 컷마다 위 간격  2) 선택한 컷 뒤에 끼워 넣기  3) 효과 복사/붙여넣기(버튼·키보드)
 *  4) 저장: 같은 파일에 덮어쓰기 · 다른 이름으로 · 취소 · 실패 시 다운로드 · 미저장 표시
 *  5) Space/가운데 버튼으로 화면 이동   6) 자동저장이 안 될 때 닫기 경고
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const sharp = require('sharp');

const OUT = path.join(__dirname, 'out');
const DIR = path.join(OUT, 'v14');
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const URL = process.env.WTOON_URL || 'file://' + path.join(OUT, 'web', 'index.html');

let failed = 0;
const check = (n, ok, i = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`);
  if (!ok) failed++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const COLORS = { R: [220, 40, 40], G: [40, 190, 70], B: [50, 90, 230], Y: [240, 210, 40] };
const MULTI = 'input[type=file][multiple][accept="image/*"]';

/** 모든 컷 위에서 아래 순서로 왼쪽 위 색을 글자로 읽는다 */
const order = (page) =>
  page.evaluate(() => {
    const cuts = Array.from(document.querySelectorAll('.cut')).map((el) => ({ top: parseFloat(el.style.top), c: el.querySelector('.cutCanvas') }));
    cuts.sort((a, b) => a.top - b.top);
    return cuts
      .map(({ c }) => {
        const [r, g, b] = c.getContext('2d').getImageData(10, 10, 1, 1).data;
        if (r > 190 && g > 190 && b > 240) return 'S';
        if (r > 200 && g > 180 && b < 90) return 'Y';
        if (r > 200 && g < 80) return 'R';
        if (g > 150 && r < 80) return 'G';
        if (b > 180 && r < 90) return 'B';
        return '?';
      })
      .join('');
  });
const tops = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('.cut'))
      .map((el) => Math.round(parseFloat(el.style.top)))
      .sort((a, b) => a - b),
  );
const setRange = (loc, v) =>
  loc.evaluate((el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
const waitCuts = (page, n) => page.waitForFunction((n) => document.querySelectorAll('.cutCanvas').length === n, n, { timeout: 15000 });
const tab = (page, name) => page.click(`.tabs button:has-text("${name}")`);
const fileState = async (page) => (await page.locator('[data-testid=file-state]').innerText()).trim();

(async () => {
  const files = {};
  for (const [k, c] of Object.entries(COLORS)) {
    files[k] = path.join(DIR, `${k}.png`);
    await sharp({ create: { width: 900, height: 260, channels: 3, background: { r: c[0], g: c[1], b: c[2] } } }).png().toFile(files[k]);
  }
  const scene = path.join(OUT, '00-original.png');
  if (!fs.existsSync(scene)) throw new Error('test/out/00-original.png 가 없어요. 먼저 tsx test/engine.test.ts 를 실행하세요');

  const browser = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };

  /* =========================================================
   * A. 컷마다 간격 · 끼워 넣기 · 효과 복사   (저장 창이 없는 브라우저처럼)
   * ========================================================= */
  const ctxA = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  await ctxA.addInitScript(() => { delete window.showSaveFilePicker; });
  const a = await ctxA.newPage();
  watch(a);
  await a.goto(URL);
  await a.waitForSelector('.empty');
  await a.setInputFiles(MULTI, [files.R, files.G, files.B]);
  await waitCuts(a, 3);
  await a.waitForTimeout(500);
  await tab(a, '컷');

  /* ---- 1) 컷마다 간격 ---- */
  check('처음 배치: 기본 간격 40px (0 / 300 / 600)', eq(await tops(a), [0, 300, 600]), String(await tops(a)));
  await a.locator('.cutRow').nth(0).click();
  check('첫 컷에는 “이 컷 위 간격”이 없다(위 여백은 따로)', (await a.locator('label.field:has-text("이 컷 위 간격")').count()) === 0);
  await a.locator('.cutRow').nth(1).click();
  const gapLabel = a.locator('label.field:has-text("이 컷 위 간격")');
  check('둘째 컷: “이 컷 위 간격 · 기본값 사용 중” 슬라이더', (await gapLabel.count()) === 1 && (await gapLabel.innerText()).includes('기본값 사용 중'));
  await setRange(gapLabel.locator('input[type=range]'), 200);
  await a.waitForTimeout(300);
  check('둘째 컷 위 간격 200px → 위치 0 / 460 / 760 (셋째 컷도 함께 밀린다)', eq(await tops(a), [0, 460, 760]), String(await tops(a)));
  check('“기본값 사용 중” 표시가 사라지고 되돌리기 버튼이 생긴다', !(await gapLabel.innerText()).includes('기본값 사용 중') && (await a.locator('button.linkBtn:has-text("기본 간격(40px)으로 되돌리기")').count()) === 1);
  await a.click('button:has-text("더보기")');
  await a.click('[role=menuitem]:has-text("분할 저장")');
  await a.waitForSelector('.modal[aria-label="분할 저장"]');
  const info = (await a.locator('[data-testid=export-info]').innerText()).replace(/\s+/g, ' ');
  check('내보내기 계획의 전체 높이가 새 간격을 반영한다 (760+260 = 1,020px)', info.includes('1,020'), info);
  await a.click('.modal .btn:has-text("닫기")');
  await a.screenshot({ path: path.join(SHOTS, '14-cut-gap.png') });

  await a.click('button.linkBtn:has-text("기본 간격(40px)으로 되돌리기")');
  await a.waitForTimeout(300);
  check('되돌리기 → 기본 간격으로 복귀', eq(await tops(a), [0, 300, 600]), String(await tops(a)));
  await setRange(gapLabel.locator('input[type=range]'), 200);
  await a.waitForTimeout(900);
  await a.locator('.cutRow').nth(1).click(); // 포커스를 슬라이더 밖으로
  await a.keyboard.press('Control+z');
  await a.waitForTimeout(300);
  check('Ctrl+Z 로 간격 변경이 취소된다', eq(await tops(a), [0, 300, 600]), String(await tops(a)));
  await a.keyboard.press('Control+Shift+z');
  await a.waitForTimeout(300);
  check('다시 실행하면 200px', eq(await tops(a), [0, 460, 760]));

  const [dl1] = await Promise.all([a.waitForEvent('download'), a.click('button:has-text("저장(.wtoon)")')]);
  const wtA = path.join(DIR, 'gap.wtoon');
  await dl1.saveAs(wtA);
  const jA = JSON.parse(fs.readFileSync(wtA, 'utf8'));
  check('.wtoon 에 둘째 컷의 gapBefore=200 만 저장된다', jA.cuts[1].gapBefore === 200 && !('gapBefore' in jA.cuts[0]) && !('gapBefore' in jA.cuts[2]));
  const a2 = await ctxA.newPage();
  watch(a2);
  await a2.goto(URL);
  await a2.waitForSelector('.empty');
  if (await a2.locator('.recoverBar').count()) await a2.click('.recoverBar button:has-text("버리기")');
  await a2.setInputFiles('input[type=file][accept*=".wtoon"]', wtA);
  await waitCuts(a2, 3);
  await a2.waitForTimeout(600);
  check('저장 파일을 불러오면 컷별 간격이 복원된다', eq(await tops(a2), [0, 460, 760]), String(await tops(a2)));
  check('불러온 직후 파일 상태는 “저장됨(gap.wtoon)”', (await fileState(a2)).includes('gap.wtoon') && !(await fileState(a2)).includes('저장 안 됨'), await fileState(a2));
  await a2.close();

  /* ---- 2) 선택한 컷 뒤에 끼워 넣기 ---- */
  const b = await ctxA.newPage();
  watch(b);
  await b.goto(URL);
  await b.waitForSelector('.empty');
  if (await b.locator('.recoverBar').count()) await b.click('.recoverBar button:has-text("버리기")');
  await b.setInputFiles(MULTI, [files.R, files.G, files.B]);
  await waitCuts(b, 3);
  await b.waitForTimeout(500);
  check('처음 순서 RGB', (await order(b)) === 'RGB', await order(b));
  await tab(b, '컷');
  await b.locator('.cutRow').nth(0).click();
  await b.setInputFiles(MULTI, [files.Y]);
  await waitCuts(b, 4);
  await b.waitForTimeout(500);
  check('첫 컷(R)을 선택하고 올리면 그 바로 뒤에 들어간다 → R Y G B', (await order(b)) === 'RYGB', await order(b));
  check('안내 토스트: “컷 0번 뒤에 1장을 넣었어요”', (await b.locator('.toast').innerText()).includes('컷 0번 뒤에 1장을 넣었어요'), await b.locator('.toast').innerText());
  await b.setInputFiles(MULTI, [scene, files.R]);
  await waitCuts(b, 6);
  await b.waitForTimeout(600);
  check('새로 넣은 컷이 선택돼 있어서 이어서 올리면 그 뒤로(순서 유지) → R Y S R G B', (await order(b)) === 'RYSRGB', await order(b));
  await b.locator('.cutRow').nth(5).click();
  await b.setInputFiles(MULTI, [files.Y]);
  await waitCuts(b, 7);
  await b.waitForTimeout(500);
  check('마지막 컷을 선택하고 올리면 맨 끝에 붙는다', (await order(b)) === 'RYSRGBY', await order(b));
  await b.keyboard.press('Control+z');
  await b.waitForTimeout(400);
  check('Ctrl+Z 한 번으로 끼워 넣기 전으로 돌아간다', (await order(b)) === 'RYSRGB', await order(b));
  await b.close();

  /* ---- 3) 효과 복사 / 붙여넣기 ---- */
  const c = await ctxA.newPage();
  watch(c);
  await c.goto(URL);
  await c.waitForSelector('.empty');
  if (await c.locator('.recoverBar').count()) await c.click('.recoverBar button:has-text("버리기")');
  await c.click('button:has-text("샘플 장면(콜라+흔들림)")');
  await waitCuts(c, 1);
  await c.setInputFiles(MULTI, [scene, scene]);
  await waitCuts(c, 3);
  await c.waitForTimeout(900);
  check('샘플 뒤에 이미지 2장이 들어간다', (await c.locator('.cutCanvas').count()) === 3);
  const snapCut = (i) =>
    c.evaluate((i) => {
      const cv = document.querySelectorAll('.cutCanvas')[i];
      return Array.from(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data);
    }, i);
  const diffCount = (x, y) => { let n = 0; for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) > 2 || Math.abs(x[i + 1] - y[i + 1]) > 2 || Math.abs(x[i + 2] - y[i + 2]) > 2) n++; return n; };

  await tab(c, '컷');
  await c.locator('.cutRow').nth(0).locator('.thumb').click();
  await tab(c, '효과');
  const rows = c.locator('.layerRow');
  const n0 = await rows.count();
  check('샘플 컷에 효과 레이어가 있다', n0 >= 1, `${n0}개`);
  check('복사 전에는 클립보드 표시가 없다', (await c.locator('[data-testid=fx-clip]').count()) === 0);
  await rows.first().locator('button[aria-label="효과 복사"]').click();
  await c.waitForTimeout(200);
  const clipText = await c.locator('[data-testid=fx-clip]').innerText();
  const clipCount = parseInt((clipText.match(/복사한 효과 (\d+)개/) || [])[1] || '0', 10);
  check('복사하면 “복사한 효과 N개” 표시가 뜬다(묶음이면 묶음 전체)', clipCount >= 1 && clipCount <= n0, clipText.replace(/\s+/g, ' '));

  await tab(c, '컷');
  check('컷 목록의 모든 행에 “붙여넣기” 버튼이 생긴다', (await c.locator('.cutRow .pasteBtn').count()) === 3);
  const before1 = await snapCut(1);
  await c.locator('.cutRow').nth(1).locator('.pasteBtn').click();
  await c.waitForTimeout(1200);
  await tab(c, '효과');
  check('둘째 컷(이미지)에 효과가 붙는다 — 개수 일치', (await c.locator('.layerRow').count()) === clipCount, `${await c.locator('.layerRow').count()} / ${clipCount}`);
  const after1 = await snapCut(1);
  const d1 = diffCount(before1, after1);
  check('붙여넣은 효과가 실제로 픽셀에 적용된다', d1 > 100, `${d1}px`);
  await c.screenshot({ path: path.join(SHOTS, '15-effect-paste.png') });
  check('원본(복사한 컷)의 효과 개수는 그대로', await (async () => { await tab(c, '컷'); await c.locator('.cutRow').nth(0).locator('.thumb').click(); await tab(c, '효과'); const k = await c.locator('.layerRow').count(); return k === n0; })());

  // 키보드: 효과 행 선택 → Ctrl+C → 셋째 컷 선택 → Ctrl+V
  await c.locator('.layerRow').first().click();
  await c.keyboard.press('Control+c');
  await c.waitForTimeout(200);
  check('Ctrl+C 로도 복사된다(토스트)', (await c.locator('.toast').innerText()).includes('복사했어요'), await c.locator('.toast').innerText());
  await tab(c, '컷');
  await c.locator('.cutRow').nth(2).locator('.thumb').click();
  await tab(c, '효과');
  const rows2before = await c.locator('.layerRow').count();
  await c.keyboard.press('Control+v');
  await c.waitForTimeout(1000);
  check('Ctrl+V 로 선택한 컷에 붙여넣는다', (await c.locator('.layerRow').count()) === rows2before + clipCount, `${rows2before} → ${await c.locator('.layerRow').count()}`);
  // 붙여넣어도 원본 클립보드는 남아 있어 여러 컷에 반복 가능, 같은 컷에 또 붙이면 겹쳐 쌓인다
  await c.keyboard.press('Control+v');
  await c.waitForTimeout(700);
  check('같은 컷에 한 번 더 붙이면 겹쳐 쌓인다(클립보드 유지)', (await c.locator('.layerRow').count()) === rows2before + 2 * clipCount);
  await c.keyboard.press('Control+z');
  await c.waitForTimeout(400);
  check('Ctrl+Z 로 마지막 붙여넣기만 취소된다', (await c.locator('.layerRow').count()) === rows2before + clipCount);
  await c.click('[data-testid=fx-clip] button:has-text("지우기")');
  check('“지우기”를 누르면 클립보드 표시가 사라진다', (await c.locator('[data-testid=fx-clip]').count()) === 0);
  await tab(c, '컷');
  check('클립보드가 비면 컷 행의 붙여넣기 버튼도 사라진다', (await c.locator('.cutRow .pasteBtn').count()) === 0);
  await c.close();
  await ctxA.close();

  /* =========================================================
   * B. 저장 창이 있는 브라우저: 덮어쓰기
   * ========================================================= */
  const ctxB = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  await ctxB.addInitScript(() => {
    window.__picks = 0;
    window.__writes = [];
    window.__next = null;
    window.__lastOpts = null;
    window.showSaveFilePicker = async (opts) => {
      window.__picks++;
      window.__lastOpts = opts;
      if (window.__next) {
        const e = new Error(window.__next);
        e.name = window.__next;
        window.__next = null;
        throw e;
      }
      const h = {
        name: (opts && opts.suggestedName) || 'webtoon.wtoon',
        async createWritable() {
          const chunks = [];
          return {
            async write(d) { chunks.push(d); },
            async close() { window.__writes.push({ name: h.name, text: await new Blob(chunks).text() }); },
          };
        },
      };
      return h;
    };
  });
  const d = await ctxB.newPage();
  watch(d);
  await d.goto(URL);
  await d.waitForSelector('.empty');
  if (await d.locator('.recoverBar').count()) await d.click('.recoverBar button:has-text("버리기")');
  await d.setInputFiles(MULTI, [files.R]);
  await waitCuts(d, 1);
  await d.waitForTimeout(500);
  const picks = () => d.evaluate(() => window.__picks);
  const writes = () => d.evaluate(() => window.__writes);
  check('내용이 있고 저장 전: “● 파일에 저장 안 됨”', (await fileState(d)).includes('저장 안 됨'), await fileState(d));

  await d.click('button:has-text("저장(.wtoon)")');
  await d.waitForTimeout(500);
  let w = await writes();
  check('첫 저장: 저장 창을 한 번 열고 webtoon.wtoon 으로 쓴다', (await picks()) === 1 && w.length === 1 && w[0].name === 'webtoon.wtoon' && JSON.parse(w[0].text).cuts.length === 1, `picks=${await picks()} writes=${w.length}`);
  check('제안 파일 이름과 형식(.wtoon)이 저장 창에 전달된다', await d.evaluate(() => window.__lastOpts.suggestedName === 'webtoon.wtoon' && JSON.stringify(window.__lastOpts.types).includes('.wtoon')));
  check('저장 뒤 상태: “✓ webtoon.wtoon”', (await fileState(d)).startsWith('✓') && (await fileState(d)).includes('webtoon.wtoon'), await fileState(d));
  check('저장 안내 토스트', (await d.locator('.toast').innerText()).includes('webtoon.wtoon 로 저장했어요'), await d.locator('.toast').innerText());

  await tab(d, '말풍선');
  await d.locator('.kindBtn').first().click();
  await d.waitForTimeout(300);
  check('변경하면 다시 “● 파일에 저장 안 됨”', (await fileState(d)).includes('저장 안 됨'), await fileState(d));
  await d.locator('.cutRow, .tool:has-text("선택")').first().click().catch(() => {});
  await d.keyboard.press('Control+s');
  await d.waitForTimeout(500);
  w = await writes();
  check('두 번째 저장(Ctrl+S): 저장 창 없이 같은 파일에 덮어쓴다', (await picks()) === 1 && w.length === 2 && w[1].name === 'webtoon.wtoon' && JSON.parse(w[1].text).bubbles.length === 1, `picks=${await picks()} writes=${w.length}`);
  check('덮어쓴 뒤 다시 “✓” 상태', (await fileState(d)).startsWith('✓'), await fileState(d));
  check('덮어쓰기 안내 토스트', (await d.locator('.toast').innerText()).includes('에 덮어썼어요'), await d.locator('.toast').innerText());

  await d.locator('.kindBtn').nth(1).click();
  await d.waitForTimeout(300);
  const dirtyMid = (await fileState(d)).includes('저장 안 됨');
  await d.click('button:has-text("↶ 실행취소")');
  await d.waitForTimeout(300);
  check('말풍선을 더 추가해 변경 → 실행취소로 저장 시점과 같아지면 다시 “✓”', dirtyMid && (await fileState(d)).startsWith('✓'), `${dirtyMid} / ${await fileState(d)}`);
  await d.click('button:has-text("↶ 실행취소")');
  await d.waitForTimeout(300);
  const dirtyBack = (await fileState(d)).includes('저장 안 됨');
  await d.click('button:has-text("↷ 다시")');
  await d.waitForTimeout(300);
  check('저장 이전으로 더 되돌리면 “저장 안 됨”, 다시 실행하면 “✓”', dirtyBack && (await fileState(d)).startsWith('✓'), `${dirtyBack} / ${await fileState(d)}`);

  await d.click('button:has-text("더보기")');
  await d.click('[role=menuitem]:has-text("다른 이름으로 저장")');
  await d.waitForTimeout(500);
  w = await writes();
  check('“다른 이름으로 저장…” 은 저장 창을 다시 연다', (await picks()) === 2 && w.length === 3, `picks=${await picks()} writes=${w.length}`);
  await d.keyboard.press('Control+Shift+s');
  await d.waitForTimeout(500);
  check('Ctrl+Shift+S 도 다른 이름으로 저장', (await picks()) === 3 && (await writes()).length === 4, `picks=${await picks()}`);

  // 취소
  await d.evaluate(() => { window.__next = 'AbortError'; });
  await tab(d, '말풍선');
  await d.locator('.kindBtn').nth(2).click();
  await d.waitForTimeout(300);
  const wBefore = (await writes()).length;
  await d.click('button:has-text("더보기")');
  await d.click('[role=menuitem]:has-text("다른 이름으로 저장")');
  await d.waitForTimeout(500);
  check('저장 창에서 취소하면 아무것도 쓰지 않고 “저장 안 됨”이 유지된다', (await writes()).length === wBefore && (await fileState(d)).includes('저장 안 됨'), await fileState(d));

  // 저장 창이 막힌 화면(보안 제한) → 다운로드로 대신
  await d.evaluate(() => { window.__next = 'SecurityError'; });
  await d.click('button:has-text("더보기")');
  const [dl2] = await Promise.all([d.waitForEvent('download'), d.click('[role=menuitem]:has-text("다른 이름으로 저장")')]);
  check('저장 창이 보안 오류를 내면 다운로드로 대신 저장한다', dl2.suggestedFilename().endsWith('.wtoon') && (await fileState(d)).startsWith('✓'), `${dl2.suggestedFilename()} / ${await fileState(d)}`);

  // 파일을 불러온 뒤 저장 → 그 파일 이름을 제안
  const loadPath = path.join(DIR, 'my-work.wtoon');
  fs.writeFileSync(loadPath, (await writes())[0].text);
  await d.setInputFiles('input[type=file][accept*=".wtoon"]', loadPath);
  await d.waitForTimeout(700);
  check('불러오면 파일 이름이 표시되고 “✓” 상태', (await fileState(d)).includes('my-work.wtoon') && (await fileState(d)).startsWith('✓'), await fileState(d));
  const p0 = await picks();
  await tab(d, '말풍선');
  await d.locator('.kindBtn').nth(3).click();
  await d.waitForTimeout(300);
  await d.keyboard.press('Control+s');
  await d.waitForTimeout(500);
  check('불러온 파일을 처음 저장할 때는 그 이름(my-work.wtoon)을 제안한다', (await picks()) === p0 + 1 && (await d.evaluate(() => window.__lastOpts.suggestedName)) === 'my-work.wtoon', await d.evaluate(() => window.__lastOpts.suggestedName));
  await d.screenshot({ path: path.join(SHOTS, '16-save-state.png') });

  /* =========================================================
   * C. 화면 이동 (Space / 가운데 버튼)
   * ========================================================= */
  const e = await ctxB.newPage();
  watch(e);
  await e.goto(URL);
  await e.waitForSelector('.empty');
  if (await e.locator('.recoverBar').count()) await e.click('.recoverBar button:has-text("버리기")');
  await e.setInputFiles(MULTI, [files.R, files.G, files.B, files.Y, files.R, files.G, files.B, files.Y]);
  await waitCuts(e, 8);
  await e.waitForTimeout(800);
  await tab(e, '효과');
  await e.click('.effGroup button:has-text("+ 흔들림")');
  await e.waitForTimeout(200);
  await e.click('.tool:has-text("올가미")');
  const sc = () => e.evaluate(() => { const s = document.querySelector('.stageScroll'); return { top: s.scrollTop, max: s.scrollHeight - s.clientHeight }; });
  await e.evaluate(() => { document.querySelector('.stageScroll').scrollTop = 0; });
  await e.waitForTimeout(200);
  const s0 = await sc();
  check('스크롤할 만큼 길다', s0.max > 600, `최대 ${Math.round(s0.max)}`);
  const stage = await e.locator('.stageScroll').boundingBox();
  const cx = stage.x + stage.width / 2;
  const cy = stage.y + stage.height * 0.6;

  await e.keyboard.down('Space');
  await e.waitForTimeout(100);
  check('Space 를 누르는 동안 화면이 이동 모드(손바닥)', (await e.locator('.app.panning').count()) === 1);
  await e.mouse.move(cx, cy);
  await e.mouse.down();
  await e.mouse.move(cx, cy - 150, { steps: 6 });
  await e.mouse.move(cx, cy - 300, { steps: 6 });
  await e.mouse.up();
  await e.keyboard.up('Space');
  await e.waitForTimeout(150);
  const s1 = await sc();
  check('Space + 아래→위 드래그 300px → 화면이 300px 아래로 스크롤된다', Math.abs(s1.top - 300) <= 6, `scrollTop ${Math.round(s1.top)}`);
  check('이동 중에는 올가미 영역이 생기지 않는다', (await e.locator('.hint:has-text("조각 1개")').count()) === 0);
  check('Space 를 떼면 이동 모드가 끝난다', (await e.locator('.app.panning').count()) === 0);

  await e.mouse.move(cx, cy);
  await e.mouse.down({ button: 'middle' });
  await e.mouse.move(cx, cy - 120, { steps: 6 });
  await e.mouse.up({ button: 'middle' });
  await e.waitForTimeout(150);
  const s2 = await sc();
  check('마우스 가운데 버튼 드래그로도 이동한다(+120px)', Math.abs(s2.top - s1.top - 120) <= 6, `${Math.round(s1.top)} → ${Math.round(s2.top)}`);
  check('가운데 버튼 이동에서도 올가미 영역이 생기지 않는다', (await e.locator('.hint:has-text("조각 1개")').count()) === 0);

  // 이동이 끝난 뒤에는 올가미가 정상 동작
  await tab(e, '컷');
  await e.locator('.cutRow').nth(1).locator('.thumb').click();
  await tab(e, '효과');
  await e.waitForTimeout(600);
  const cb = await e.locator('.cutCanvas').nth(1).boundingBox();
  const lx = cb.x + cb.width / 2 - 100, ly = cb.y + 60;
  await e.mouse.move(lx, ly);
  await e.mouse.down();
  for (const [dx, dy] of [[160, 0], [160, 90], [0, 90], [0, 0]]) await e.mouse.move(lx + dx, ly + dy, { steps: 5 });
  await e.mouse.up();
  await e.waitForTimeout(500);
  check('이동을 마치면 올가미가 다시 정상 동작한다', (await e.locator('.hint:has-text("조각 1개")').count()) === 1);

  // 글자 입력 중 Space 는 이동이 아니라 글자
  await tab(e, '말풍선');
  await e.locator('.kindBtn').first().click();
  await e.waitForTimeout(300);
  const ta = e.locator('textarea.text');
  await ta.click();
  const len0 = (await ta.inputValue()).length;
  await e.keyboard.press('Space');
  await e.waitForTimeout(100);
  check('말풍선 글자칸에서 Space 는 그대로 띄어쓰기이고 이동 모드가 되지 않는다', (await ta.inputValue()).length === len0 + 1 && (await e.locator('.app.panning').count()) === 0);
  await e.close();
  await ctxB.close();

  /* =========================================================
   * D. 자동저장이 안 되는 환경: 닫기 경고
   * ========================================================= */
  const unloadProbe = (p) => p.evaluate(() => { const ev = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
  const ctxOK = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  await ctxOK.addInitScript(() => { delete window.showSaveFilePicker; });
  const ok = await ctxOK.newPage();
  watch(ok);
  await ok.goto(URL);
  await ok.waitForSelector('.empty');
  await ok.setInputFiles(MULTI, [files.R]);
  await waitCuts(ok, 1);
  await ok.waitForTimeout(2600);
  check('자동저장이 되는 환경: 저장 안 된 변경이 있어도 닫기 경고를 띄우지 않는다(복구 가능)', (await fileState(ok)).includes('저장 안 됨') && !(await unloadProbe(ok)));
  await ctxOK.close();

  const ctxBad = await browser.newContext({ viewport: { width: 1300, height: 800 } });
  await ctxBad.addInitScript(() => {
    delete window.showSaveFilePicker;
    const fake = () => { throw new Error('storage blocked'); };
    try { Object.defineProperty(window, 'indexedDB', { value: { open: fake }, configurable: true }); } catch (e) { /* ignore */ }
  });
  const bad = await ctxBad.newPage();
  watch(bad);
  await bad.goto(URL);
  await bad.waitForSelector('.empty');
  await bad.setInputFiles(MULTI, [files.R]);
  await waitCuts(bad, 1);
  await bad.waitForTimeout(2800);
  check('자동저장이 막힌 환경: 저장 안 된 변경이 있으면 닫기 경고를 띄운다', (await unloadProbe(bad)) === true && (await bad.locator('.toast').innerText().catch(() => '')).includes('자동저장'));
  await bad.click('button:has-text("저장(.wtoon)")').catch(() => {});
  await bad.waitForTimeout(800);
  check('파일로 저장하면 경고가 사라진다', (await unloadProbe(bad)) === false);
  await ctxBad.close();

  const real = errors.filter((x) => !/storage blocked/.test(x));
  check('콘솔/페이지 에러 없음', real.length === 0, real.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failed === 0 ? '\nv1.4 편의 기능 테스트 전부 통과' : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('테스트 중단:', e);
  process.exit(2);
});
