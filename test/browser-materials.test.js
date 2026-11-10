/** 소재 가져오기(ZIP/PNG) → 컷에 톤 붙이기 → 페이지 배경에 놓기 → 저장/새로고침 유지 */
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { chromium } = require('playwright');
const sharp = require('sharp');
const OUT = path.join(__dirname, 'out');
const SHOTS = path.join(OUT, 'shots');
let failed = 0;
const check = (n, ok, i = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${i ? '  — ' + i : ''}`); if (!ok) failed++; };

function zipBytes(files) {
  const parts = [], central = []; let off = 0;
  for (const f of files) {
    const comp = f.deflate ? zlib.deflateRawSync(f.data) : f.data; const name = Buffer.from(f.name); const crc = zlib.crc32(f.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central); const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

(async () => {
  // 소재 이미지: 흰 바탕 검은 점 톤(64px) / 투명 배경 빨간 별 스탬프
  const dots = []; for (let y = 8; y < 64; y += 16) for (let x = 8; x < 64; x += 16) dots.push(`<circle cx="${x}" cy="${y}" r="4.5" fill="#000"/>`);
  const tone = await sharp(Buffer.from(`<svg width="64" height="64"><rect width="64" height="64" fill="#fff"/>${dots.join('')}</svg>`)).png().toBuffer();
  const stamp = await sharp(Buffer.from('<svg width="200" height="200"><polygon points="100,10 123,75 190,75 135,115 155,180 100,140 45,180 65,115 10,75 77,75" fill="#e02040"/></svg>')).png().toBuffer();
  const zip = zipBytes([
    { name: 'CSP-export/tone_dot.png', data: tone, deflate: false },
    { name: 'CSP-export/star.png', data: stamp, deflate: true },
    { name: 'CSP-export/brush.sut', data: Buffer.from('not-an-image'), deflate: true },
    { name: '__MACOSX/._star.png', data: Buffer.from('x'), deflate: false },
  ]);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  // 파일 저장 창(File System Access)이 없는 브라우저(Firefox·Safari)처럼 동작시켜 다운로드 저장 경로를 검증한다. 저장 창 경로는 browser-v14 에서 따로 검증
  await ctx.addInitScript(() => { delete window.showSaveFilePicker; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(process.env.WTOON_URL || 'file://' + path.join(OUT, 'web', 'index.html'));
  await page.waitForSelector('.empty');
  await page.setInputFiles('input[type=file][accept="image/*,.clip"]', path.join(OUT, '00-original.png'));
  await page.waitForSelector('.cutCanvas');
  await page.waitForTimeout(300);
  const snap = () => page.evaluate(() => { const c = document.querySelector('.cutCanvas'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data); });
  const before = await snap();

  await page.click('.tabs button:has-text("소재")');
  check('소재 탭이 열리고 안내 문구가 있다', (await page.locator('summary:has-text("클립스튜디오 소재")').count()) === 1);
  await page.setInputFiles('input[type=file][accept*=".zip"]', { name: 'csp-assets.zip', mimeType: 'application/zip', buffer: zip });
  await page.waitForSelector('.matItem');
  await page.waitForTimeout(400);
  check('ZIP 안의 이미지 2개가 소재로 들어온다(.sut·__MACOSX 제외)', (await page.locator('.matItem').count()) === 2, `${await page.locator('.matItem').count()}개`);
  await page.setInputFiles('input[type=file][accept*=".zip"]', { name: 'x.psd', mimeType: 'application/octet-stream', buffer: Buffer.from('8BPS') });
  await page.waitForTimeout(400);
  check('지원하지 않는 형식(.psd)은 이유를 알려준다', (await page.locator('body').innerText()).includes('가져올 수 있는 소재가 없어요'));

  // 톤 선택 → 반복해서 채우기
  await page.click('.matItem:has-text("tone_dot")');
  await page.click('button:has-text("반복해서 채우기(톤)")');
  await page.waitForTimeout(900);
  const after = await snap();
  let diff = 0; for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) > 2) diff++;
  check('톤이 컷에 반복해서 채워진다', diff > 20000, `${diff}px`);
  if (process.env.WTOON_URL) check('Web Worker 경로로 렌더링한다', await page.evaluate(() => !!globalThis.__workerCreated));
  await page.click('.tabs button:has-text("효과")');
  check('효과 레이어 목록에 소재 레이어가 생긴다', (await page.locator('.layerRow:has-text("tone_dot")').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, '08-material-tone.png') });

  // 별 스탬프 → 컷 한 장 붙이기, 페이지 배경에도
  await page.click('.tabs button:has-text("소재")');
  await page.click('.matItem:has-text("star")');
  await page.click('button:has-text("컷에 한 장 붙이기")');
  await page.waitForTimeout(900);
  const stampImg = await snap();
  let reds = 0; for (let i = 0; i < stampImg.length; i += 4) if (stampImg[i] > 200 && stampImg[i + 1] < 60 && stampImg[i + 2] < 90 && !(before[i] > 150 && before[i + 1] < 60)) reds++;
  check('투명 스탬프가 컷에 붙는다(빨간 별 픽셀)', reds > 3000, `${reds}px`);
  await page.click('.tabs button:has-text("소재")');
  if ((await page.locator('.matItem.on:has-text("star")').count()) === 0) await page.click('.matItem:has-text("star")');
  await page.click('button:has-text("컷 밖 배경에 놓기")');
  await page.waitForTimeout(400);
  await page.click('.tabs button:has-text("배경")');
  check('컷 밖 배경 레이어에도 놓을 수 있다', (await page.locator('.layerRow:has-text("star")').count()) >= 1);

  // 저장: 사용한 소재가 .wtoon 에 들어간다
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("저장(.wtoon)")')]);
  const wt = path.join(OUT, 'test-mat.wtoon'); await dl.saveAs(wt);
  const d = JSON.parse(fs.readFileSync(wt, 'utf8'));
  check('.wtoon 에 사용한 소재 2개가 들어간다', Array.isArray(d.materials) && d.materials.length === 2, `${(d.materials || []).length}개`);
  const effMat = d.cuts[0].effects.filter((e) => e.type === 'material');
  check('.wtoon 의 소재 효과가 소재 id 를 가리킨다', effMat.length === 2 && effMat.every((e) => d.materials.some((m) => m.id === e.params.materialId)));

  // 새 페이지(새로고침)에서 소재 라이브러리 유지 + 저장 파일 불러오면 효과 복원
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => errors.push('pageerror2: ' + e.message));
  await page2.goto(process.env.WTOON_URL || 'file://' + path.join(OUT, 'web', 'index.html'));
  await page2.waitForSelector('.empty');
  await page2.click('.tabs button:has-text("소재")');
  await page2.waitForTimeout(600);
  const persisted = await page2.locator('.matItem').count();
  check('새로 열어도 소재 라이브러리가 유지된다(IndexedDB)', persisted === 2, `${persisted}개`);
  await page2.setInputFiles('input[type=file][accept*=".wtoon"]', wt).catch(async () => {
    await page2.locator('input[type=file]').nth(2).setInputFiles(wt);
  });
  await page2.waitForSelector('.cutCanvas', { timeout: 8000 });
  await page2.waitForTimeout(1500);
  const restored = await page2.evaluate(() => { const c = document.querySelector('.cutCanvas'); return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data); });
  let rd = 0; for (let i = 0; i < restored.length; i += 4) if (Math.abs(restored[i] - stampImg[i]) > 6) rd++;
  check('저장 파일을 불러오면 소재 효과까지 같은 모습으로 복원된다', rd < 1500, `차이 ${rd}px`);
  check('콘솔/페이지 에러 없음', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(failed === 0 ? '\n소재 브라우저 테스트 전부 통과' : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('테스트 중단:', e); process.exit(2); });
