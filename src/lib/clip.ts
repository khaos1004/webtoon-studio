/**
 * 클립스튜디오 .clip 파일 읽기 (의존성 없음)
 *
 * .clip = CSFCHUNK 컨테이너 안에 SQLite DB(CHNKSQLi)와 레이어 타일(CHNKExta)이 들어 있다.
 * 레이어를 직접 합성하면 혼합 모드·텍스트·톤 레이어 등을 다 재현해야 하므로,
 * 클립스튜디오가 저장할 때 함께 넣어 두는 "합쳐진 미리보기"(CanvasPreview 테이블)를 꺼낸다.
 * 비공식 구조를 읽는 것이라 모든 .clip 이 열린다고 보장할 수는 없다.
 */

export const isClipName = (name: string) => /\.clip$/i.test(name);

export interface ClipImage {
  /** 합쳐진 그림(PNG 또는 JPEG) */
  blob: Blob;
  width: number;
  height: number;
  /** 원본 캔버스 크기(알 수 있을 때) */
  canvasW?: number;
  canvasH?: number;
}

const enc = new TextEncoder();
const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const be64 = (b: Uint8Array, o: number) => be32(b, o) * 2 ** 32 + be32(b, o + 4);

function startsWith(b: Uint8Array, o: number, s: string) {
  const t = enc.encode(s);
  if (o + t.length > b.length) return false;
  for (let i = 0; i < t.length; i++) if (b[o + i] !== t[i]) return false;
  return true;
}

/** 컨테이너에서 SQLite DB 바이트를 꺼낸다 */
export function clipSqlite(buf: ArrayBuffer | Uint8Array): Uint8Array {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (!startsWith(b, 0, 'CSFCHUNK')) throw new Error('클립스튜디오(.clip) 파일이 아니에요');
  let off = 24;
  while (off + 16 <= b.length) {
    const len = be64(b, off + 8);
    if (startsWith(b, off, 'CHNKSQLi')) return b.subarray(off + 16, Math.min(b.length, off + 16 + len));
    if (!startsWith(b, off, 'CHNK') || !Number.isFinite(len) || len < 0) break;
    off += 16 + len;
  }
  // 덩어리 구조가 예상과 다르면 SQLite 머리말을 직접 찾는다
  const sig = enc.encode('SQLite format 3\0');
  outer: for (let i = 0; i + sig.length <= b.length; i++) {
    for (let j = 0; j < sig.length; j++) if (b[i + j] !== sig[j]) continue outer;
    return b.subarray(i);
  }
  throw new Error('.clip 안에서 그림 정보를 찾지 못했어요');
}

/* ------------------------------ 최소 SQLite 리더 (읽기 전용) ------------------------------ */

type Value = null | number | Uint8Array | string;

class SqliteReader {
  readonly pageSize: number;
  readonly usable: number;
  constructor(readonly b: Uint8Array) {
    if (!startsWith(b, 0, 'SQLite format 3')) throw new Error('.clip 안의 그림 정보가 손상됐어요');
    const ps = be16(b, 16);
    this.pageSize = ps === 1 ? 65536 : ps;
    this.usable = this.pageSize - b[20];
  }

  page(n: number) {
    const o = (n - 1) * this.pageSize;
    if (n < 1 || o >= this.b.length) throw new Error('.clip 안의 그림 정보가 잘렸어요');
    return o;
  }

  varint(o: number): [number, number] {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const c = this.b[o + i];
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return [v, i + 1];
    }
    return [v * 256 + this.b[o + 8], 9];
  }

  /** 표 b-tree 를 돌며 (rowid, 레코드 바이트) 를 넘긴다 */
  *rows(root: number): Generator<[number, Uint8Array]> {
    const stack = [root];
    const seen = new Set<number>();
    while (stack.length) {
      const pg = stack.pop()!;
      if (seen.has(pg)) continue;
      seen.add(pg);
      const base = this.page(pg);
      const h = pg === 1 ? base + 100 : base;
      const type = this.b[h];
      const n = be16(this.b, h + 3);
      if (type === 0x05) {
        // 내부 페이지: 오른쪽 끝부터 넣어야 rowid 순서대로 나온다
        stack.push(be32(this.b, h + 8));
        for (let i = n - 1; i >= 0; i--) stack.push(be32(this.b, base + be16(this.b, h + 12 + i * 2)));
      } else if (type === 0x0d) {
        for (let i = 0; i < n; i++) {
          let c = base + be16(this.b, h + 8 + i * 2);
          const [plen, a] = this.varint(c);
          c += a;
          const [rowid, r] = this.varint(c);
          c += r;
          yield [rowid, this.payload(c, plen)];
        }
      } else throw new Error('.clip 안의 그림 정보를 읽지 못했어요');
    }
  }

  payload(o: number, P: number): Uint8Array {
    const U = this.usable;
    const X = U - 35;
    if (P <= X) return this.b.subarray(o, o + P);
    const M = Math.floor(((U - 12) * 32) / 255) - 23;
    const K = M + ((P - M) % (U - 4));
    const local = K <= X ? K : M;
    const out = new Uint8Array(P);
    out.set(this.b.subarray(o, o + local));
    let got = local;
    let next = be32(this.b, o + local);
    let guard = 0;
    while (got < P && next && guard++ < 1e7) {
      const po = this.page(next);
      const take = Math.min(U - 4, P - got);
      out.set(this.b.subarray(po + 4, po + 4 + take), got);
      got += take;
      next = be32(this.b, po);
    }
    if (got < P) throw new Error('.clip 안의 그림 정보가 잘렸어요');
    return out;
  }

  record(rec: Uint8Array): Value[] {
    const [hlen, a] = varintOf(rec, 0);
    let p = a;
    const types: number[] = [];
    while (p < hlen) {
      const [t, s] = varintOf(rec, p);
      types.push(t);
      p += s;
    }
    let d = hlen;
    const vals: Value[] = [];
    for (const t of types) {
      if (t === 0) vals.push(null);
      else if (t >= 1 && t <= 6) {
        const size = [0, 1, 2, 3, 4, 6, 8][t];
        let u = 0;
        for (let i = 0; i < size; i++) u = u * 256 + rec[d + i];
        if (rec[d] & 0x80) u -= 2 ** (size * 8); // 음수
        vals.push(u);
        d += size;
      } else if (t === 7) {
        vals.push(new DataView(rec.buffer, rec.byteOffset + d, 8).getFloat64(0));
        d += 8;
      } else if (t === 8 || t === 9) vals.push(t - 8);
      else if (t >= 12 && t % 2 === 0) {
        const n = (t - 12) / 2;
        vals.push(rec.subarray(d, d + n));
        d += n;
      } else if (t >= 13) {
        const n = (t - 13) / 2;
        vals.push(new TextDecoder().decode(rec.subarray(d, d + n)));
        d += n;
      } else vals.push(null);
    }
    return vals;
  }

  /** 표 하나를 {열이름: 값} 목록으로 읽는다. INTEGER PRIMARY KEY 열은 rowid 로 채운다 */
  table(name: string): Record<string, Value>[] {
    let root = 0;
    let sql = '';
    for (const [, rec] of this.rows(1)) {
      const v = this.record(rec);
      if (v[0] === 'table' && typeof v[1] === 'string' && v[1].toLowerCase() === name.toLowerCase()) {
        root = v[3] as number;
        sql = String(v[4] ?? '');
        break;
      }
    }
    if (!root) return [];
    const cols = columnsOf(sql);
    const out: Record<string, Value>[] = [];
    for (const [rowid, rec] of this.rows(root)) {
      const v = this.record(rec);
      const row: Record<string, Value> = {};
      cols.forEach((c, i) => (row[c.name] = c.pk && v[i] == null ? rowid : (v[i] ?? null)));
      out.push(row);
    }
    return out;
  }
}

function varintOf(b: Uint8Array, o: number): [number, number] {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    const c = b[o + i];
    v = v * 128 + (c & 0x7f);
    if (!(c & 0x80)) return [v, i + 1];
  }
  return [v * 256 + b[o + 8], 9];
}

function columnsOf(sql: string): { name: string; pk: boolean }[] {
  const s = sql.indexOf('(');
  const e = sql.lastIndexOf(')');
  if (s < 0 || e < s) return [];
  const body = sql.slice(s + 1, e);
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter((p) => p && !/^(primary|unique|check|foreign|constraint)\b/i.test(p))
    .map((p) => {
      const m = p.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\S+))\s*(.*)$/s)!;
      const name = m[1] ?? m[2] ?? m[3] ?? m[4];
      return { name, pk: /^integer\s+primary\s+key/i.test(m[5]) };
    });
}

/* ------------------------------ 합쳐진 그림 꺼내기 ------------------------------ */

const num = (v: Value | undefined) => (typeof v === 'number' ? v : undefined);

function imageMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (startsWith(b, 0, 'RIFF') && startsWith(b, 8, 'WEBP')) return 'image/webp';
  if (startsWith(b, 0, 'BM')) return 'image/bmp';
  return null;
}

/** .clip 에서 합쳐진 그림(캔버스 미리보기)을 꺼낸다 */
export function readClipImage(buf: ArrayBuffer | Uint8Array): ClipImage {
  const db = new SqliteReader(clipSqlite(buf));
  const canvas = db.table('Canvas')[0];
  const canvasW = num(canvas?.CanvasWidth);
  const canvasH = num(canvas?.CanvasHeight);
  let best: ClipImage | null = null;
  for (const r of db.table('CanvasPreview')) {
    const data = r.ImageData;
    if (!(data instanceof Uint8Array) || !data.length) continue;
    const mime = imageMime(data);
    if (!mime) continue;
    const width = num(r.ImageWidth) ?? 0;
    const height = num(r.ImageHeight) ?? 0;
    if (!best || width * height > best.width * best.height) {
      best = { blob: new Blob([data.slice() as BlobPart], { type: mime }), width, height, canvasW, canvasH };
    }
  }
  if (!best) throw new Error('이 .clip 에는 합쳐진 그림이 들어 있지 않아요. 클립스튜디오에서 PNG나 PSD로 저장해서 올려 주세요');
  return best;
}

/** .clip 파일을 일반 이미지 파일로 바꾼다. 미리보기가 원본보다 작으면 note 에 알려 준다 */
export async function clipToImageFile(file: File): Promise<{ file: File; note?: string }> {
  const img = readClipImage(await file.arrayBuffer());
  const ext = img.blob.type === 'image/jpeg' ? 'jpg' : img.blob.type.split('/')[1];
  const out = new File([img.blob], file.name.replace(/\.clip$/i, '') + '.' + ext, { type: img.blob.type });
  let note: string | undefined;
  if (img.canvasW && img.width && img.width < img.canvasW * 0.98) {
    note = `${file.name}: 클립스튜디오가 저장해 둔 미리보기가 원본보다 작아요(${img.width}×${img.height}, 원본 ${img.canvasW}×${img.canvasH ?? '?'}). 원본 화질이 필요하면 PNG나 PSD로 저장해서 올려 주세요`;
  }
  return { file: out, note };
}

/** 파일 목록에서 .clip 을 이미지로 바꾼다. 실패한 것은 errors 에 */
export async function expandClipFiles(files: File[]): Promise<{ files: File[]; notes: string[]; errors: string[] }> {
  const out: File[] = [];
  const notes: string[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (!isClipName(f.name)) {
      out.push(f);
      continue;
    }
    try {
      const r = await clipToImageFile(f);
      out.push(r.file);
      if (r.note) notes.push(r.note);
    } catch (e) {
      errors.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return { files: out, notes, errors };
}
