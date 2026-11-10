# 테스트용 가짜 .clip 파일을 만든다 (CSFCHUNK 컨테이너 + SQLite CanvasPreview). 사용: python3 test/make-clip.py <폴더>
import sqlite3, struct, os, sys, io
import numpy as np
from PIL import Image
out = sys.argv[1]
os.chdir(out)
def make(path, pw, ph, cw, ch, pagesize=1024, fmt='PNG', with_preview=True, extra_tables=60):
    if os.path.exists('db.tmp'): os.remove('db.tmp')
    db = sqlite3.connect('db.tmp'); db.execute(f'pragma page_size={pagesize}')
    for i in range(extra_tables):  # sqlite_master 를 여러 페이지로
        db.execute(f'create table Filler{i:03d} (MainId INTEGER PRIMARY KEY, Name TEXT, Data BLOB)')
    db.execute('create table Canvas (MainId INTEGER PRIMARY KEY, CanvasUnit INTEGER, CanvasWidth DOUBLE, CanvasHeight DOUBLE, CanvasResolution DOUBLE)')
    db.execute('insert into Canvas values (NULL,0,?,?,350.0)', (cw, ch))
    db.execute('create table CanvasPreview (MainId INTEGER PRIMARY KEY, CanvasId INTEGER, ImageType INTEGER, ImageWidth INTEGER, ImageHeight INTEGER, ImageData BLOB)')
    for i in range(300): db.execute('insert into Filler000 values (NULL,?,?)', ('x'*50, os.urandom(40)))
    if with_preview:
        y, x = np.mgrid[0:ph, 0:pw]
        a = np.dstack([(x*255//max(1,pw-1)), (y*255//max(1,ph-1)), np.full_like(x,90), np.where((x//20+y//20)%2==0,255,128)]).astype(np.uint8)
        b = io.BytesIO(); im = Image.fromarray(a,'RGBA')
        if fmt=='JPEG': im = im.convert('RGB')
        im.save(b, fmt); data = b.getvalue()
        # 작은 미리보기 하나 + 큰 것 하나 (큰 것을 골라야 함)
        s = io.BytesIO(); im.resize((max(1,pw//4),max(1,ph//4))).save(s, fmt)
        db.execute('insert into CanvasPreview values (NULL,1,1,?,?,?)', (pw//4, ph//4, s.getvalue()))
        db.execute('insert into CanvasPreview values (NULL,1,1,?,?,?)', (pw, ph, data))
        open(path + '.expect', 'wb').write(data)
    db.commit(); db.close()
    sql = open('db.tmp','rb').read()
    head = b'CHNKHead' + struct.pack('>Q', 40) + b'\0'*40
    exta = b'CHNKExta' + struct.pack('>Q', 100) + os.urandom(100)
    sqli = b'CHNKSQLi' + struct.pack('>Q', len(sql)) + sql
    foot = b'CHNKFoot' + struct.pack('>Q', 0)
    body = head + exta + sqli + foot
    open(path,'wb').write(b'CSFCHUNK' + struct.pack('>Q', 24+len(body)) + struct.pack('>Q', 24) + body)
    print(path, len(sql), 'bytes db')
make('full.clip', 690, 1600, 690, 1600)
make('small.clip', 345, 800, 690, 1600, pagesize=4096)
make('jpeg.clip', 300, 500, 300, 500, pagesize=65536, fmt='JPEG')
make('nopreview.clip', 10, 10, 10, 10, with_preview=False)
open('fake.clip', 'wb').write(b'hello world, not a clip')
