/**
 * 의존성 없는 ZIP 만들기 (무압축 "저장" 방식).
 * JPG/PNG 는 이미 압축된 형식이라 다시 압축해도 크기가 거의 줄지 않으므로 이 방식으로 충분하다.
 * 파일 이름은 UTF-8 로 기록한다(한글 이름 가능).
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipInput {
  name: string;
  data: Uint8Array;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function makeZip(files: ZipInput[], when: Date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const names = files.map((f) => enc.encode(f.name));
  let size = 22;
  files.forEach((f, i) => {
    size += 30 + names[i].length + f.data.length + 46 + names[i].length;
  });
  if (files.length > 0xffff || size > 0xffffffff) throw new Error('ZIP 이 너무 커요');
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let p = 0;
  const offsets: number[] = [];
  const crcs = files.map((f) => crc32(f.data));
  files.forEach((f, i) => {
    offsets.push(p);
    dv.setUint32(p, 0x04034b50, true);
    dv.setUint16(p + 4, 20, true); // 필요한 버전
    dv.setUint16(p + 6, 0x0800, true); // UTF-8 이름
    dv.setUint16(p + 8, 0, true); // 저장(무압축)
    dv.setUint16(p + 10, time, true);
    dv.setUint16(p + 12, date, true);
    dv.setUint32(p + 14, crcs[i], true);
    dv.setUint32(p + 18, f.data.length, true);
    dv.setUint32(p + 22, f.data.length, true);
    dv.setUint16(p + 26, names[i].length, true);
    dv.setUint16(p + 28, 0, true);
    out.set(names[i], p + 30);
    out.set(f.data, p + 30 + names[i].length);
    p += 30 + names[i].length + f.data.length;
  });
  const cdStart = p;
  files.forEach((f, i) => {
    dv.setUint32(p, 0x02014b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, time, true);
    dv.setUint16(p + 14, date, true);
    dv.setUint32(p + 16, crcs[i], true);
    dv.setUint32(p + 20, f.data.length, true);
    dv.setUint32(p + 24, f.data.length, true);
    dv.setUint16(p + 28, names[i].length, true);
    dv.setUint32(p + 42, offsets[i], true);
    out.set(names[i], p + 46);
    p += 46 + names[i].length;
  });
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 8, files.length, true);
  dv.setUint16(p + 10, files.length, true);
  dv.setUint32(p + 12, p - cdStart, true);
  dv.setUint32(p + 16, cdStart, true);
  return out;
}
