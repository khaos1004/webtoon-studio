/**
 * 소재(material) / 휘두르기 궤적(swoosh) / ZIP 읽기 검증
 */
import zlib from 'node:zlib';
import { createEffect } from '../src/lib/effectMeta';
import { renderEffects } from '../src/lib/render';
import { registerMaterial, readZip, analyzePixels, isImageName, readPsdComposite } from '../src/lib/materials';
import type { RGBA } from '../src/lib/effects';
import { W, H, check, failures, makeScene, lasso, save, diffCount, withMask } from './scene';

function makeTone(size: number, dot: number): RGBA {
  // 흰 바탕에 검은 점이 격자로 찍힌 톤 소재(불투명)
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const cx = (x % (size / 2)) - size / 4;
      const cy = (y % (size / 2)) - size / 4;
      const on = cx * cx + cy * cy < dot * dot;
      const v = on ? 0 : 255;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { data, width: size, height: size };
}
function makeStamp(size: number): RGBA {
  // 투명 배경에 빨간 원
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2, y - size / 2);
      const i = (y * size + x) * 4;
      if (d < size * 0.4) {
        data[i] = 230; data[i + 1] = 20; data[i + 2] = 40; data[i + 3] = 255;
      }
    }
  return { data, width: size, height: size };
}

function zipBytes(files: { name: string; data: Buffer; deflate: boolean }[]): ArrayBuffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const comp = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name, 'utf8');
    const crc = zlib.crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  const all = Buffer.concat([...parts, cd, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
}

async function main() {
  const base = makeScene();

  /* ---- 소재: 한 장(스탬프) ---- */
  registerMaterial('stamp', makeStamp(128));
  const st = withMask({ ...createEffect('material'), params: { ...createEffect('material').params, materialId: 'stamp', matFit: 'stamp', matScale: 100 } });
  const o1 = renderEffects(base, [st]);
  await save(o1, 'm-stamp.png');
  check('소재 스탬프: 선택 영역 안에 붙는다', diffCount(base, o1, 420, 100, 700, 520) > 800, `${diffCount(base, o1, 420, 100, 700, 520)}px`);
  check('소재 스탬프: 선택에서 먼 곳은 그대로', diffCount(base, o1, 0, 0, 330, H) === 0);

  /* ---- 소재: 톤(반복) · 잉크 해석 ---- */
  registerMaterial('tone', makeTone(64, 7));
  const tp = { ...createEffect('material').params, materialId: 'tone', matFit: 'tile' as const, matMode: 'ink' as const, matScale: 100, color: '#000000', matBlend: 'normal' as const };
  const t1 = renderEffects(base, [withMask({ ...createEffect('material'), params: tp })]);
  await save(t1, 'm-tone.png');
  check('소재 톤(ink): 흰 부분은 투명, 점만 잉크로 찍힘', diffCount(base, t1, 420, 100, 700, 520) > 500 && diffCount(base, t1, 420, 100, 700, 520) < 60000);
  check('소재 톤: 선택 밖 그대로', diffCount(base, t1, 0, 0, 330, H) === 0);
  // 반복 주기(배경만 있는 y 150~220 구간에서 비교): 소재 64px 안에 점이 32px 간격 → 100% 에서 32px, 200% 에서 64px 주기
  const pix = (r: RGBA, x: number, y: number) => r.data[(y * W + x) * 4];
  const periodic = (r: RGBA, x0: number, x1: number, shift: number) => {
    let ok = 0, n = 0;
    for (let y = 150; y < 220; y++) for (let x = x0; x < x1; x++) { n++; if (Math.abs(pix(r, x, y) - pix(r, x + shift, y)) < 3) ok++; }
    return ok / n;
  };
  const t2 = renderEffects(base, [withMask({ ...createEffect('material'), params: { ...tp, matScale: 200 } })]);
  check('소재 톤: 크기 100% 에서 32px 주기로 반복', periodic(t1, 458, 478, 32) > 0.98, periodic(t1, 458, 478, 32).toFixed(3));
  check('소재 톤: 크기 100% 에서 16px 이동하면 무늬가 달라진다(주기성 검증이 의미 있음)', periodic(t1, 458, 478, 16) < 0.9, periodic(t1, 458, 478, 16).toFixed(3));
  check('소재 톤: 크기 200% 에서 64px 주기', periodic(t2, 486, 508, 64) > 0.98, periodic(t2, 486, 508, 64).toFixed(3));
  check('소재 톤: 크기 200% 에서는 16px 이동하면 무늬가 달라진다', periodic(t2, 486, 508, 16) < 0.9, periodic(t2, 486, 508, 16).toFixed(3));

  /* ---- 합성 방식 ---- */
  registerMaterial('flat', { data: new Uint8ClampedArray(Array.from({ length: 16 * 16 }).flatMap(() => [128, 128, 128, 255])), width: 16, height: 16 });
  const mul = renderEffects(base, [withMask({ ...createEffect('material'), params: { ...createEffect('material').params, materialId: 'flat', matFit: 'cover', matBlend: 'multiply' as const } })]);
  const scr = renderEffects(base, [withMask({ ...createEffect('material'), params: { ...createEffect('material').params, materialId: 'flat', matFit: 'cover', matBlend: 'screen' as const } })]);
  const idx = (270 * W + 540) * 4;
  check('합성: 곱하기는 어두워지고 스크린은 밝아진다', mul.data[idx] < base.data[idx] && scr.data[idx] > base.data[idx], `${base.data[idx]} → ${mul.data[idx]} / ${scr.data[idx]}`);

  /* ---- 소재가 없으면 아무것도 안 바뀜(오류 없음) ---- */
  const none = renderEffects(base, [withMask({ ...createEffect('material'), params: { ...createEffect('material').params, materialId: 'missing' } })]);
  check('없는 소재 id: 원본 그대로', diffCount(base, none, 0, 0, W, H) === 0);

  /* ---- swoosh ---- */
  const sw = renderEffects(base, [withMask(createEffect('swoosh'))]);
  await save(sw, 'n-swoosh.png');
  check('휘두르기 궤적: 선택 주변에 곡선이 그려진다', diffCount(base, sw, 330, 40, W, H) > 1500, `${diffCount(base, sw, 330, 40, W, H)}px`);
  check('휘두르기 궤적: 먼 곳은 그대로', diffCount(base, sw, 0, 0, 200, H) === 0);

  /* ---- ZIP ---- */
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const zip = zipBytes([
    { name: 'tones/a.png', data: Buffer.concat([png, Buffer.alloc(2000, 7)]), deflate: true },
    { name: 'b.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), deflate: false },
    { name: '__MACOSX/._a.png', data: Buffer.from('x'), deflate: false },
    { name: 'readme.txt', data: Buffer.from('hi'), deflate: true },
    { name: 'folder/', data: Buffer.alloc(0), deflate: false },
  ]);
  const ents = await readZip(zip);
  check('ZIP: 이미지(PNG/SVG)만 꺼낸다(폴더·__MACOSX·txt 제외)', ents.length === 2 && ents[0].name === 'tones/a.png' && ents[1].name === 'b.svg', ents.map((e) => e.name).join(','));
  check('ZIP: 압축(deflate)·무압축 내용이 원본과 같다', ents[0].data.length === 2008 && ents[0].data[0] === 0x89 && Buffer.from(ents[1].data).toString().includes('<svg'));
  let bad = false;
  try { await readZip(new ArrayBuffer(40)); } catch { bad = true; }
  check('ZIP 아닌 파일은 오류 메시지', bad);
  check('확장자 판별', isImageName('x.PNG') && isImageName('a/b.webp') && isImageName('a.psd') && !isImageName('a.sut') && !isImageName('a.clip'));


  /* ---- PSD 합성 이미지 ---- */
  const buildPsd = (w: number, h: number, planes: number[][], opts: { rle: boolean; depth?: 8 | 16; mode?: number }) => {
    const depth = opts.depth ?? 8;
    const mode = opts.mode ?? 3;
    const hd = Buffer.alloc(26);
    hd.write('8BPS', 0, 'ascii'); hd.writeUInt16BE(1, 4); hd.writeUInt16BE(planes.length, 12); hd.writeUInt32BE(h, 14); hd.writeUInt32BE(w, 18); hd.writeUInt16BE(depth, 22); hd.writeUInt16BE(mode, 24);
    const empty = Buffer.alloc(4);
    const body: Buffer[] = [];
    if (!opts.rle) {
      body.push(Buffer.from([0, 0]));
      for (const pl of planes) body.push(depth === 16 ? Buffer.from(pl.flatMap((v) => [v, 0])) : Buffer.from(pl));
    } else {
      body.push(Buffer.from([0, 1]));
      const counts = Buffer.alloc(planes.length * h * 2);
      const data: Buffer[] = [];
      planes.forEach((pl, c) => {
        for (let y = 0; y < h; y++) {
          const row = pl.slice(y * w, (y + 1) * w);
          const enc: number[] = [];
          let i = 0;
          while (i < row.length) {
            let run = 1;
            while (i + run < row.length && row[i + run] === row[i] && run < 128) run++;
            if (run > 1) { enc.push(257 - run & 255, row[i]); i += run; }
            else { let j = i; while (j < row.length && j - i < 128 && (j + 1 >= row.length || row[j] !== row[j + 1])) j++; if (j === i) j++; enc.push(j - i - 1, ...row.slice(i, j)); i = j; }
          }
          counts.writeUInt16BE(enc.length, (c * h + y) * 2);
          data.push(Buffer.from(enc));
        }
      });
      body.push(counts, ...data);
    }
    const buf = Buffer.concat([hd, empty, empty, empty, ...body]);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer;
  };
  const pw = 6, ph = 3;
  const R = Array.from({ length: pw * ph }, (_, i) => (i * 13) % 256);
  const G = Array.from({ length: pw * ph }, (_, i) => (i % pw < 3 ? 255 : 10));
  const B = Array.from({ length: pw * ph }, () => 77);
  const A = Array.from({ length: pw * ph }, (_, i) => (i < pw ? 0 : 255));
  for (const rle of [false, true]) {
    const img = readPsdComposite(buildPsd(pw, ph, [R, G, B, A], { rle }));
    const ok = img.width === pw && img.height === ph && R.every((v, i) => img.data[i * 4] === v && img.data[i * 4 + 1] === G[i] && img.data[i * 4 + 2] === 77 && img.data[i * 4 + 3] === A[i]);
    check(`PSD(${rle ? 'RLE' : '비압축'}) RGBA 합성 이미지를 정확히 읽는다`, ok);
  }
  const gray = readPsdComposite(buildPsd(pw, ph, [R], { rle: true, mode: 1 }));
  check('PSD 그레이스케일(RLE)', gray.data[4 * 5] === R[5] && gray.data[4 * 5 + 1] === R[5] && gray.data[4 * 5 + 3] === 255);
  const d16 = readPsdComposite(buildPsd(pw, ph, [R, G, B], { rle: false, depth: 16 }));
  check('PSD 16비트(비압축)', d16.data[4 * 4] === R[4] && d16.data[4 * 4 + 3] === 255);
  let errs = 0;
  for (const f of [() => readPsdComposite(new ArrayBuffer(50)), () => readPsdComposite(buildPsd(pw, ph, [R, G, B, A], { rle: false, mode: 4 }))]) { try { f(); } catch { errs++; } }
  check('PSD가 아니거나 CMYK면 오류 메시지', errs === 2);

  /* ---- 소재 성격 추정 ---- */
  const hint = (r: RGBA) => analyzePixels(r.data);
  check('성격 추정: 투명 스탬프=alpha / 흰 바탕 톤=ink', hint(makeStamp(64)) === 'alpha' && hint(makeTone(64, 7)) === 'ink');

  if (failures()) { console.log(`\n실패 ${failures()}건`); process.exit(1); }
  console.log('\n전부 통과');
}
main();
