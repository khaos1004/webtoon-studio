/**
 * v1.4: ZIP 만들기, 분할 계획, 컷/효과 복제
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { crc32, makeZip } from '../src/lib/zipwrite';
import { planSlices, safeCutPositions } from '../src/lib/slice';
import { readZip } from '../src/lib/materials';
import { cloneEffects, duplicateCut, duplicateEffect } from '../src/lib/cutops';
import { gapOf, layoutCuts, parseProject, serializeProject } from '../src/lib/project';
import { emptyProject } from '../src/lib/types';
import { createEffect } from '../src/lib/effectMeta';
import type { Cut } from '../src/lib/types';
import { check, failures } from './scene';

async function main() {
  /* ---- CRC32 ---- */
  const samples = [new Uint8Array(0), Buffer.from('a'), Buffer.from('webtoon 한글 테스트'), Buffer.alloc(100000, 7), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) & 255))];
  check('crc32 가 Node(zlib)와 같다', samples.every((b) => crc32(b) === zlib.crc32(b)));

  /* ---- ZIP ---- */
  const files = [
    { name: 'webtoon_001.jpg', data: new Uint8Array(Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7) & 255))) },
    { name: '한글 이름.png', data: new Uint8Array(Buffer.from('PNGDATA')) },
    { name: 'empty.bin', data: new Uint8Array(0) },
  ];
  const zip = makeZip(files, new Date(2026, 9, 20, 9, 30, 12));
  const back = await readZip(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, () => true);
  check('ZIP: 우리 읽기로 되돌리면 이름·내용이 같다', back.length === 3 && back[0].name === files[0].name && Buffer.compare(Buffer.from(back[0].data), Buffer.from(files[0].data)) === 0 && back[1].name === '한글 이름.png' && Buffer.from(back[1].data).toString() === 'PNGDATA' && back[2].data.length === 0, back.map((b) => b.name).join(','));
  const tmp = path.join(os.tmpdir(), `wtoon-zip-${process.pid}.zip`);
  fs.writeFileSync(tmp, zip);
  let py = '';
  try {
    py = execFileSync('python3', ['-I', '-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('|'.join(i.filename+':'+str(i.file_size) for i in z.infolist()))", tmp]).toString().trim();
  } catch (e) {
    py = 'ERR ' + (e as Error).message;
  }
  check('ZIP: 파이썬 zipfile 이 열고 CRC 검사를 통과한다(한글 이름·빈 파일 포함)', py === 'webtoon_001.jpg:3000|한글 이름.png:7|empty.bin:0', py);
  fs.unlinkSync(tmp);

  /* ---- 분할 계획 ---- */
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  check('짧으면 한 장', eq(planSlices(1000, 1280), [[0, 1000]]));
  check('여백 후보가 없으면 최대 높이마다 자른다', eq(planSlices(3000, 1280), [[0, 1280], [1280, 2560], [2560, 3000]]));
  check('컷 사이 여백에서 자른다(가능한 가장 늦은 곳)', eq(planSlices(3000, 1280, [1000, 1250, 2500]), [[0, 1250], [1250, 2500], [2500, 3000]]), JSON.stringify(planSlices(3000, 1280, [1000, 1250, 2500])));
  check('너무 이른 여백은 쓰지 않는다(조각이 너무 작아짐)', eq(planSlices(3000, 1280, [100]), [[0, 1280], [1280, 2560], [2560, 3000]]));
  check('딱 최대 높이면 한 장', eq(planSlices(1280, 1280), [[0, 1280]]));
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let bad = '';
  for (let t = 0; t < 300 && !bad; t++) {
    const total = 200 + Math.floor(rnd() * 40000);
    const maxH = 200 + Math.floor(rnd() * 3000);
    const safe = Array.from({ length: Math.floor(rnd() * 40) }, () => Math.floor(rnd() * total));
    const r = planSlices(total, maxH, safe);
    if (r[0][0] !== 0 || r[r.length - 1][1] !== Math.round(total)) bad = `끝점 ${total}/${maxH}`;
    for (let i = 0; i < r.length && !bad; i++) {
      if (r[i][1] <= r[i][0]) bad = `빈 조각 ${total}/${maxH}`;
      else if (r[i][1] - r[i][0] > Math.max(100, maxH)) bad = `너무 큼 ${total}/${maxH}`;
      else if (i > 0 && r[i][0] !== r[i - 1][1]) bad = `끊김 ${total}/${maxH}`;
    }
  }
  check('무작위 300가지: 조각이 이어지고 비지 않고 최대 높이를 넘지 않는다', !bad, bad);
  check('컷 사이 여백의 가운데 위치', eq(safeCutPositions([{ top: 0, height: 200 }, { top: 240, height: 300 }, { top: 540, height: 100 }]), [220, 540]), JSON.stringify(safeCutPositions([{ top: 0, height: 200 }, { top: 240, height: 300 }, { top: 540, height: 100 }])));

  /* ---- 복제 ---- */
  const e1 = { ...createEffect('shake'), group: 'g1' };
  const e2 = { ...createEffect('speedlines'), group: 'g1' };
  const e3 = createEffect('blur');
  e1.mask = { feather: 3, ops: [{ kind: 'rect', mode: 'add', x: 1, y: 2, w: 3, h: 4 }] };
  const cut: Cut = { id: 'c1', src: 'data:image/png;base64,AAAA', height: 500, effects: [e1, e2, e3], inset: 10 };
  const copy = duplicateCut(cut);
  check('컷 복제: 새 id, 효과 id 도 전부 새로', copy.id !== cut.id && copy.effects.length === 3 && copy.effects.every((e, i) => e.id !== cut.effects[i].id));
  check('컷 복제: 같은 묶음은 새 묶음 하나로, 원래 묶음과는 다르다', copy.effects[0].group === copy.effects[1].group && copy.effects[0].group !== 'g1' && !!copy.effects[0].group && copy.effects[2].group === undefined);
  (copy.effects[0].mask.ops[0] as { x: number }).x = 999;
  copy.effects[0].params.angle = 77;
  check('컷 복제: 영역·설정은 깊은 복사(원본이 안 바뀐다)', (cut.effects[0].mask.ops[0] as { x: number }).x === 1 && cut.effects[0].params.angle !== 77);
  check('컷 복제: 이미지·여백 속성 유지', copy.src === cut.src && copy.inset === 10 && copy.height === 500);
  const ec = duplicateEffect(e1);
  check('효과 복제: 새 id, 묶음에서 빠지고 이름에 “복사”', ec.id !== e1.id && ec.group === undefined && ec.name.endsWith('복사') && ec.type === e1.type);

  /* ---- 효과 여러 개 복제(붙여넣기용) ---- */
  const cl = cloneEffects([e1, e2, e3]);
  check('효과 일괄 복제: 새 id, 같은 묶음은 새 묶음 하나로 유지', cl.length === 3 && cl.every((e, i) => e.id !== [e1, e2, e3][i].id) && cl[0].group === cl[1].group && cl[0].group !== 'g1' && !!cl[0].group && cl[2].group === undefined);
  const cl2 = cloneEffects([e1, e2]);
  check('효과 일괄 복제: 두 번 복제하면 서로 다른 묶음', cl[0].group !== cl2[0].group);
  (cl[0].mask.ops[0] as { x: number }).x = 555;
  check('효과 일괄 복제: 영역은 깊은 복사이고 좌표는 그대로 이어받는다', (e1.mask.ops[0] as { x: number }).x === 1 && (cl2[0].mask.ops[0] as { x: number }).x === 1 && cl2[0].name === e1.name);

  /* ---- 컷마다 간격 ---- */
  const mk = (id: string, h: number, gapBefore?: number): Cut => ({ id, src: '', height: h, effects: [], ...(gapBefore === undefined ? {} : { gapBefore }) });
  const same = layoutCuts({ cuts: [mk('a', 100), mk('b', 200), mk('c', 50)], gap: 40, padTop: 0, padBottom: 0 });
  check('간격: 기본값만 쓰면 예전과 같은 배치(위치 0/140/380, 전체 430 → 최소 300 보장)', same.items.map((i) => i.top).join() === '0,140,380' && same.total === 430, `${same.items.map((i) => i.top)} / ${same.total}`);
  const custom = layoutCuts({ cuts: [mk('a', 100, 999), mk('b', 200, 300), mk('c', 50, 0)], gap: 40, padTop: 10, padBottom: 25 });
  check('간격: 첫 컷의 gapBefore 는 무시(위 여백은 padTop), 나머지는 컷마다 적용', custom.items.map((i) => i.top).join() === '10,410,610', custom.items.map((i) => i.top).join());
  check('간격: 전체 높이 = 마지막 컷 아래 + padBottom', custom.total === 610 + 50 + 25, String(custom.total));
  check('간격: gapOf — 없으면 기본, 음수는 0', gapOf(mk('x', 1), 40) === 40 && gapOf(mk('x', 1, 0), 40) === 0 && gapOf(mk('x', 1, -5), 40) === 0);
  const prj = { ...emptyProject(), cuts: [mk('a', 100), mk('b', 100, 123.5), mk('c', 100)] };
  const round = parseProject(serializeProject(prj));
  check('간격: 저장→불러오기에서 컷별 간격이 유지되고 없는 컷은 없는 채로', round.cuts[1].gapBefore === 123.5 && !('gapBefore' in round.cuts[0]) && !('gapBefore' in round.cuts[2]));
  const evil = parseProject(JSON.stringify({ format: 'wtoon', bubbles: [], cuts: [{ id: 'a', src: '', height: 10, effects: [], gapBefore: 'x' }, { id: 'b', src: '', height: 10, effects: [], gapBefore: 99999 }, { id: 'c', src: '', height: 10, effects: [], gapBefore: -50 }] }));
  check('간격: 이상한 값은 걸러낸다(문자 → 없음, 너무 큰 값 → 2000, 음수 → 0)', !('gapBefore' in evil.cuts[0]) && evil.cuts[1].gapBefore === 2000 && evil.cuts[2].gapBefore === 0);

  if (failures()) { console.log(`\n실패 ${failures()}건`); process.exit(1); }
  console.log('\n전부 통과');
}
main();
