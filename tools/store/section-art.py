#!/usr/bin/env python3
"""The paintings on the cards of «الأقسام», the sections on the home screen.

Every card carries a small painting of the shore the sky of the hour is
painted on. The paintings are made large, at any size so long as they are
4:3, and this turns a folder of them into the nine files the app ships:

    python3 tools/store/section-art.py <folder of masters> [--out <folder>]

The folder holds one PNG for each section, named after it as the app names
it: azkar, mosques, qada, umrah, qibla, khatma, hadith, ruqyah and dua. Each
is cut to 4:3 about its middle, scaled with Lanczos to 384 by 288, which is
what the widest card asks of a screen at three pixels to the point, and
written as WebP at quality 78 with the slowest and smallest method into
docs/img/sections, or wherever --out says.

A test holds every painting under 30000 bytes, so one that comes out heavier
is named and the run fails, rather than the suite failing later for a reason
it cannot see. A missing master stops the run before anything is written,
so the nine never come from two different sets.
"""

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]

# in the order the cards stand on the home screen
SECTIONS = ['azkar', 'mosques', 'qada', 'umrah', 'qibla', 'khatma', 'hadith', 'ruqyah', 'dua']
SIZE = (384, 288)
QUALITY = 78
LIMIT = 30000

LANCZOS = getattr(Image, 'Resampling', Image).LANCZOS


def middle_four_by_three(im):
    """The largest 4:3 box about the middle of the picture."""
    w, h = im.size
    if w * 3 > h * 4:
        cw, ch = round(h * 4 / 3), h
    else:
        cw, ch = w, round(w * 3 / 4)
    left, top = (w - cw) // 2, (h - ch) // 2
    return (left, top, left + cw, top + ch)


def main():
    ap = argparse.ArgumentParser(description='Turn the section masters into the WebP files the app ships.')
    ap.add_argument('masters', type=Path, help='folder holding azkar.png, mosques.png and the rest')
    ap.add_argument('--out', type=Path, default=ROOT / 'docs' / 'img' / 'sections',
                    help='where the nine files go (default: docs/img/sections)')
    ap.add_argument('--quality', type=int, default=QUALITY, help='WebP quality (default: %d)' % QUALITY)
    args = ap.parse_args()

    missing = [k for k in SECTIONS if not (args.masters / (k + '.png')).is_file()]
    if missing:
        sys.exit('missing in %s: %s' % (args.masters, ', '.join(k + '.png' for k in missing)))

    args.out.mkdir(parents=True, exist_ok=True)
    heavy = []
    for key in SECTIONS:
        src = args.masters / (key + '.png')
        with Image.open(src) as opened:
            im = ImageOps.exif_transpose(opened).convert('RGB')
        box = middle_four_by_three(im)
        art = im.crop(box).resize(SIZE, LANCZOS)
        dest = args.out / (key + '.webp')
        art.save(dest, 'WEBP', quality=args.quality, method=6)
        size = dest.stat().st_size
        print('%-8s %5d x %-5d cut to %d x %d  ->  %s  %6d bytes' % (
            key, im.width, im.height, box[2] - box[0], box[3] - box[1], dest.name, size))
        if size >= LIMIT:
            heavy.append('%s (%d bytes)' % (dest.name, size))

    if heavy:
        sys.exit('over %d bytes, try a lower --quality: %s' % (LIMIT, ', '.join(heavy)))


if __name__ == '__main__':
    main()
