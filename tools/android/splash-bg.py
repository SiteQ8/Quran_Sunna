#!/usr/bin/env python3
"""لوحات شاشة الافتتاح في أندرويد لوحةٌ لكل بلدٍ من الكويت والسعودية والإمارات
وقطر والبحرين وعُمان وأخرى لمن سواهم، ولكلّ لوحةٍ نهارٌ وليل.

تُرسم الأصول كبيرةً بنسبة ٩ إلى ١٦ تقريباً وأعلاها سماءٌ هادئة خالية والمعلم في
أسفلها، فتقصّ هذه الأداة كلّ أصلٍ من وسطه على ٩:١٦ ثم تصغّره إلى ١٠٨٠×١٩٢٠
بـLANCZOS وتكتبه WebP بجودة ٧٠ تقريباً في drawable-nodpi، لأن اللوحة لا تتغيّر
بكثافة الشاشة فتُحمل نسخةً واحدة.

ولكل لوحةٍ حدٌّ هو ٢٠٠٠٠٠ بايت، فإن زادت عليه نزلت الجودة درجةً بعد درجة حتى
تدخل فيه، وإن لم تدخل فيه عند ٥٠ بقي الملف القديم كما هو وخرجت الأداة بخطأ، فلا
تدخل التطبيقَ لوحةٌ أثقل من حدّها.

    python3 tools/android/splash-bg.py <مجلّد الأصول>

والأصول فيه بأسماء {kw,sa,ae,qa,bh,om,default}-{day,night}.png.
"""

import io
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'android' / 'app' / 'src' / 'main' / 'res' / 'drawable-nodpi'

PLACES = ['kw', 'sa', 'ae', 'qa', 'bh', 'om', 'default']
TIMES = ['day', 'night']
SIZE = (1080, 1920)
QUALITY = 70
FLOOR = 50
BUDGET = 200000


def crop_9_16(im):
    """وسط الأصل بنسبة ٩:١٦، فيُقصّ الجانبان إن كان أعرض ويُقصّ أعلاه وأسفله
       بالتساوي إن كان أطول."""
    w, h = im.size
    if w * 16 > h * 9:
        cw = round(h * 9 / 16)
        left = (w - cw) // 2
        return im.crop((left, 0, left + cw, h))
    ch = round(w * 16 / 9)
    top = (h - ch) // 2
    return im.crop((0, top, w, top + ch))


def encode(im):
    """يكتب اللوحة WebP بالجودة المعتادة في الذاكرة، ولا ينزل بها إلا إذا طلب
       الحدّ ذلك."""
    q = QUALITY
    while True:
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=q, method=6)
        data = buf.getvalue()
        if len(data) < BUDGET or q <= FLOOR:
            return q, data
        q -= 4


def main():
    if len(sys.argv) != 2:
        print('usage: python3 tools/android/splash-bg.py <masters dir>', file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    masters = [(p, t, src / f'{p}-{t}.png') for p in PLACES for t in TIMES]
    missing = [str(m) for _, _, m in masters if not m.is_file()]
    if missing:
        print('missing masters:\n  ' + '\n  '.join(missing), file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    faults = 0
    for place, time, master in masters:
        with Image.open(master) as raw:
            im = crop_9_16(raw.convert('RGB')).resize(SIZE, Image.LANCZOS)
        out = OUT / f'splash_bg_{place}_{time}.webp'
        q, data = encode(im)
        if len(data) >= BUDGET:
            print(f'{out.relative_to(ROOT)}  {len(data)} bytes even at q{q}: over budget, left as it was')
            faults += 1
            continue
        out.write_bytes(data)
        print(f'{out.relative_to(ROOT)}  q{q}  {len(data)} bytes')
    if faults:
        print(f'{faults} painting(s) would not fit in {BUDGET} bytes', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
