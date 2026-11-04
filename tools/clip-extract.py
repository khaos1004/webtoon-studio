#!/usr/bin/env python3
"""
클립스튜디오 .clip 파일의 래스터 레이어를 한 장씩 꺼내 앱의 "내장 소재"로 만든다.
(.clip = CSFCHUNK 컨테이너: SQLite 레이어 정보 + zlib 타일 비트맵. 비공식 구조를 읽는 것이라 모든 .clip 이 되는 것은 아니에요)

  pip install pillow numpy
  python tools/clip-extract.py 효과음_1.clip public/materials/sfx --prefix 효과음

결과: <out>/NNN.webp(원본 비율, 긴 변 최대 1400px) + <out>/t/NNN.webp(섬네일) + <out>/../manifest.json(앱이 읽는 목록, 다른 폴더의 항목은 유지하며 추가)
"""
import argparse, hashlib, json, os, re, sqlite3, struct, sys, zlib
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
NAME = 'BlockDataBeginChunk'.encode('utf-16-be')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('clip'); ap.add_argument('out')
    ap.add_argument('--prefix', default='소재')
    ap.add_argument('--max-side', type=int, default=1400)
    ap.add_argument('--skip-name', default=r'용지|logo|로고', help='이 정규식에 걸리는 레이어 이름은 건너뜀')
    ap.add_argument('--skip-big', type=float, default=0.6, help='캔버스 한 변의 이 비율보다 큰 레이어(배경 용지)는 건너뜀')
    a = ap.parse_args()

    data = open(a.clip, 'rb').read()
    if data[:8] != b'CSFCHUNK':
        sys.exit('클립스튜디오 파일이 아니에요')
    off = 24; sql = None
    while off < len(data):
        tag = data[off:off + 8]; ln = struct.unpack('>Q', data[off + 8:off + 16])[0]
        if tag == b'CHNKSQLi': sql = data[off + 16:off + 16 + ln]
        off += 16 + ln
    os.makedirs(os.path.join(a.out, 't'), exist_ok=True)
    dbp = os.path.join(a.out, '_db.tmp')
    open(dbp, 'wb').write(sql)
    db = sqlite3.connect(dbp)
    ext = {(r[0].decode() if isinstance(r[0], bytes) else r[0]): r[1] for r in db.execute('select ExternalID,Offset from ExternalChunk')}
    canvas_w = db.execute('select CanvasWidth from Canvas').fetchone()[0]

    def tiles_of(extid):
        o = ext[extid]
        ln = struct.unpack('>Q', data[o + 8:o + 16])[0]
        seg = data[o + 16:o + 16 + ln]
        out = {}
        for m in re.finditer(re.escape(NAME), seg):
            q = m.end()
            idx, _x, _w, _h, has = struct.unpack('>5I', seg[q:q + 20])
            if not has: continue
            zl = struct.unpack('<I', seg[q + 24:q + 28])[0]
            out[idx] = zlib.decompress(seg[q + 28:q + 28 + zl])
        return out

    def layer_image(mm_id):
        mm = db.execute('select BaseMipmapInfo from Mipmap where MainId=?', (mm_id,)).fetchone()
        mi = db.execute('select Offscreen from MipmapInfo where MainId=?', (mm[0],)).fetchone()
        attr, bd = db.execute('select Attribute,BlockData from Offscreen where MainId=?', (mi[0],)).fetchone()
        i = attr.find('Parameter'.encode('utf-16-be')) + 18
        W, H = struct.unpack('>2I', attr[i:i + 8])
        cols = (W + 255) // 256
        tiles = tiles_of(bd.decode())
        if not tiles: return None
        xs = [k % cols for k in tiles]; ys = [k // cols for k in tiles]
        x0, x1, y0, y1 = min(xs), max(xs) + 1, min(ys), max(ys) + 1
        cv = np.zeros(((y1 - y0) * 256, (x1 - x0) * 256, 4), np.uint8)
        for k, raw in tiles.items():
            b = np.frombuffer(raw, np.uint8)
            if len(b) == 65536 * 5:
                al = b[:65536].reshape(256, 256); c = b[65536:].reshape(256, 256, 4)
                px = np.dstack([c[:, :, 2], c[:, :, 1], c[:, :, 0], al])
            elif len(b) == 65536 * 4:
                c = b.reshape(256, 256, 4); px = np.dstack([c[:, :, 2], c[:, :, 1], c[:, :, 0], c[:, :, 3]])
            elif len(b) == 65536:
                g = b.reshape(256, 256); px = np.dstack([g, g, g, np.full_like(g, 255)])
            else:
                raise ValueError('알 수 없는 타일 크기 %d' % len(b))
            tx = k % cols - x0; ty = k // cols - y0
            cv[ty * 256:(ty + 1) * 256, tx * 256:(tx + 1) * 256] = px
        return Image.fromarray(cv, 'RGBA')

    skip = re.compile(a.skip_name, re.I)
    items, seen, skipped = [], set(), {'이름': 0, '큰배경': 0, '빈레이어': 0, '중복': 0, '읽기실패': 0}
    base = os.path.basename(a.out.rstrip('/'))
    for lid, name, mm in db.execute('select MainId,LayerName,LayerRenderMipmap from Layer where LayerFolder=0 order by MainId'):
        if skip.search(name or ''): skipped['이름'] += 1; continue
        try: im = layer_image(mm)
        except Exception: skipped['읽기실패'] += 1; continue
        if im is None: skipped['빈레이어'] += 1; continue
        bb = im.getchannel('A').getbbox()
        if not bb: skipped['빈레이어'] += 1; continue
        im = im.crop(bb)
        if max(im.size) > canvas_w * a.skip_big: skipped['큰배경'] += 1; continue
        h = hashlib.md5(im.tobytes()).hexdigest()
        if h in seen: skipped['중복'] += 1; continue
        seen.add(h)
        n = len(items) + 1
        k = min(1.0, a.max_side / max(im.size))
        if k < 1: im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        fn = '%03d.webp' % n
        im.save(os.path.join(a.out, fn), 'WEBP', quality=90, method=4)
        th = im.copy(); th.thumbnail((160, 160), Image.LANCZOS)
        th.save(os.path.join(a.out, 't', fn), 'WEBP', quality=80)
        clean = re.sub(r'\s*복사(\s*\d+)?$', '', name or '').strip()
        if not clean or re.fullmatch(r'[0-9a-f-]{20,}', clean) or re.fullmatch(r'레이어 ?\d*', clean): clean = ''
        items.append({'id': 'builtin-%s-%03d' % (base, n), 'name': ('%s %s' % (a.prefix, clean)).strip() if clean else '%s %03d' % (a.prefix, n),
                      'file': '%s/%s' % (base, fn), 'thumb': '%s/t/%s' % (base, fn), 'w': im.width, 'h': im.height})
    os.remove(dbp)
    man = os.path.join(os.path.dirname(a.out.rstrip('/')) or '.', 'manifest.json')
    old = json.load(open(man, encoding='utf-8'))['items'] if os.path.exists(man) else []
    old = [x for x in old if not x['id'].startswith('builtin-%s-' % base)]  # 같은 폴더를 다시 만들면 교체, 다른 폴더는 유지
    json.dump({'items': old + items}, open(man, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('소재 %d개 저장 · 건너뜀 %s · 목록 %s' % (len(items), skipped, man))


if __name__ == '__main__':
    main()
