/**
 * .clip 읽기: 컨테이너 → SQLite → CanvasPreview 그림을 바이트 그대로 꺼내는지
 * (넘침 페이지·내부 페이지·페이지 크기 1K/4K/64K·JPEG 미리보기·미리보기 없음·가짜 파일)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { clipToImageFile, expandClipFiles, isClipName, readClipImage } from '../src/lib/clip';
import { check, failures } from './scene';

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'));
  execFileSync('python3', [path.join(__dirname, 'make-clip.py'), dir], { stdio: 'ignore' });
  const read = (n: string) => new Uint8Array(fs.readFileSync(path.join(dir, n)));
  const same = async (blob: Blob, n: string) => Buffer.compare(Buffer.from(await blob.arrayBuffer()), Buffer.from(read(n))) === 0;

  check('확장자 판별', isClipName('a.CLIP') && isClipName('컷 01.clip') && !isClipName('a.clip.png'));

  const full = readClipImage(read('full.clip'));
  check('큰 미리보기를 고름', full.width === 690 && full.height === 1600, `${full.width}x${full.height}`);
  check('PNG 바이트가 그대로(넘침 페이지 이어붙이기)', await same(full.blob, 'full.clip.expect'));
  check('PNG 형식', full.blob.type === 'image/png');
  check('캔버스 크기', full.canvasW === 690 && full.canvasH === 1600, `${full.canvasW}x${full.canvasH}`);

  const small = readClipImage(read('small.clip'));
  check('4K 페이지', small.width === 345 && (await same(small.blob, 'small.clip.expect')));
  const jpg = readClipImage(read('jpeg.clip'));
  check('64K 페이지 + JPEG', jpg.blob.type === 'image/jpeg' && (await same(jpg.blob, 'jpeg.clip.expect')));

  const f = await clipToImageFile(new File([read('full.clip')], '컷 01.clip'));
  check('파일 이름·형식', f.file.name === '컷 01.png' && f.file.type === 'image/png' && !f.note, f.file.name);
  const s = await clipToImageFile(new File([read('small.clip')], 's.clip'));
  check('미리보기가 작으면 알림', !!s.note && s.note.includes('345×800') && s.note.includes('690×1600'), s.note);

  let err = '';
  try { readClipImage(read('nopreview.clip')); } catch (e) { err = (e as Error).message; }
  check('미리보기 없음 → 안내', err.includes('PNG나 PSD'), err);
  err = '';
  try { readClipImage(read('fake.clip')); } catch (e) { err = (e as Error).message; }
  check('가짜 파일 → 안내', err.includes('.clip') , err);

  const ex = await expandClipFiles([
    new File([read('full.clip')], 'a.clip'),
    new File([new Uint8Array([1, 2, 3])], 'b.png', { type: 'image/png' }),
    new File([read('fake.clip')], 'c.clip'),
  ]);
  check('섞인 목록: 순서 유지·실패 분리', ex.files.map((x) => x.name).join(',') === 'a.png,b.png' && ex.errors.length === 1 && ex.errors[0].startsWith('c.clip'), JSON.stringify(ex.errors));

  fs.rmSync(dir, { recursive: true, force: true });
  if (failures()) process.exit(1);
  console.log('clip OK');
}
main();
