#!/usr/bin/env python3
"""The paintings behind the opening screen, one for each country by day and
by night.

The page opens on a painting of the reader's own country, chosen before the
first frame by the zone they set or the phone's own, and by whether the sun
is up there now. The paintings are made large, at any size so long as they
are about 9:16, and this turns a folder of them into the files the app
ships, two for each country:

    python3 tools/store/splash-art.py <folder of masters> [--out <folder>]

The folder holds one PNG for each country and each half of the day, named as
the page names them, the codes in COUNTRIES below, each with -day and
-night, so kw-day.png and kw-night.png and the rest. Each is cut to 9:16
about its middle, scaled with Lanczos to 900 by 1600, which fills a phone of
three pixels to the point with the sky to spare, and written as WebP at
quality 72 with the slowest and smallest method into docs/img/splash, or
wherever --out says.

A test holds every painting under 180000 bytes. A painting that comes out
heavier is written again a few steps lower until it fits, and named in the
output with the quality it took, so a calm sky keeps its quality and only a
busy one gives any up. One that cannot fit even at the floor stops the run.
A missing master stops the run before anything is written, so the set never
comes from two different batches.
"""

import argparse
import io
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]

# as the page names them: the zone gives the country, the sun the half
COUNTRIES = ['kw', 'sa', 'ae', 'qa', 'bh', 'om', 'eg', 'in', 'iq', 'jo', 'ma', 'dz', 'sy', 'ye', 'ly', 'id', 'my', 'tr', 'pk', 'bd', 'ng', 'default']
HALVES = ['day', 'night']
SIZE = (900, 1600)
QUALITY = 72
FLOOR = 40
STEP = 4
LIMIT = 180000

LANCZOS = getattr(Image, 'Resampling', Image).LANCZOS


def names():
    return ['%s-%s' % (c, h) for c in COUNTRIES for h in HALVES]


def middle_nine_by_sixteen(im):
    """The largest 9:16 box about the middle of the picture."""
    w, h = im.size
    if w * 16 > h * 9:
        cw, ch = round(h * 9 / 16), h
    else:
        cw, ch = w, round(w * 16 / 9)
    left, top = (w - cw) // 2, (h - ch) // 2
    return (left, top, left + cw, top + ch)


def encode(art, quality):
    """The WebP bytes at this quality, with no colour profile or metadata:
       the page draws them as sRGB and a profile only adds weight."""
    out = io.BytesIO()
    art.save(out, 'WEBP', quality=quality, method=6, icc_profile=None, exif=b'')
    return out.getvalue()


def main():
    ap = argparse.ArgumentParser(description='Turn the opening masters into the WebP files the app ships.')
    ap.add_argument('masters', type=Path, help='folder holding kw-day.png, kw-night.png and the rest')
    ap.add_argument('--out', type=Path, default=ROOT / 'docs' / 'img' / 'splash',
                    help='where the files go (default: docs/img/splash)')
    ap.add_argument('--quality', type=int, default=QUALITY, help='WebP quality to start from (default: %d)' % QUALITY)
    args = ap.parse_args()

    missing = [n for n in names() if not (args.masters / (n + '.png')).is_file()]
    if missing:
        sys.exit('missing in %s: %s' % (args.masters, ', '.join(n + '.png' for n in missing)))

    args.out.mkdir(parents=True, exist_ok=True)
    heavy = []
    for name in names():
        src = args.masters / (name + '.png')
        with Image.open(src) as opened:
            im = ImageOps.exif_transpose(opened).convert('RGB')
        box = middle_nine_by_sixteen(im)
        art = im.crop(box).resize(SIZE, LANCZOS)
        quality = args.quality
        data = encode(art, quality)
        while len(data) >= LIMIT and quality - STEP >= FLOOR:
            quality -= STEP
            data = encode(art, quality)
        dest = args.out / (name + '.webp')
        dest.write_bytes(data)
        print('%-13s %5d x %-5d cut to %d x %d  ->  %-18s q%-3d %7d bytes' % (
            name, im.width, im.height, box[2] - box[0], box[3] - box[1], dest.name, quality, len(data)))
        if len(data) >= LIMIT:
            heavy.append('%s (%d bytes at quality %d)' % (dest.name, len(data), quality))

    if heavy:
        sys.exit('over %d bytes even at quality %d: %s' % (LIMIT, FLOOR, ', '.join(heavy)))


if __name__ == '__main__':
    main()
