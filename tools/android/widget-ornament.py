#!/usr/bin/env python3
"""The strapwork in the corner of the home screen widgets, on both phones.

Eight pointed stars and crosses, the geometry of the mosques' doors and
windows, drawn the way the craftsmen drew it: by Hankin's method on the
tiling of octagons and squares. From the middle of every edge two lines run
into the shape at the contact angle until they meet the lines from the next
edge; at 67.5 degrees the octagons hold eight pointed stars and the squares
the crosses between them.

The piece is a square, rising from its top corner at the end of the line and
fading out before the words. It is written as a white mask: each phone tints
it, gold on paper by day and by night, white on the painted skies, so one
picture serves every theme, and each phone turns it over for a page read
from the right.

    python3 tools/android/widget-ornament.py

writes android/app/src/main/res/drawable-*dpi/widget_orn_{band,line}_mask.webp
and ios/Widget/Assets.xcassets/ornament_{band,line}.imageset. It draws with
the Chromium that Playwright carries, so a gradient and a mask come out the
same as any browser draws them.
"""
import json
import math
import os
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SIZE = 150      # dp: the side of the corner piece
UNIT = 26       # dp: from one octagon to the next
THETA = 67.5    # the contact angle: eight pointed stars and the crosses between them


def tiling(span):
    """the octagons on the whole lattice, and the squares between them"""
    half = math.tan(math.radians(22.5)) * 0.5
    out = []
    for i in span:
        for j in span:
            r = 0.5 / math.cos(math.radians(22.5))
            out.append([(i + r * math.cos(math.radians(22.5 + 45 * k)), j + r * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)])
            s = 2 * half / math.sqrt(2)
            out.append([(i + 0.5 + s * math.cos(math.radians(90 * k)), j + 0.5 + s * math.sin(math.radians(90 * k))) for k in range(4)])
    return out


def hankin(poly, theta):
    """the two lines from the middle of every edge, to where they meet the
    lines of the next edge, on the line from the centre to the corner"""
    n = len(poly)
    cx = sum(p[0] for p in poly) / n
    cy = sum(p[1] for p in poly) / n
    half_angle = math.radians((n - 2) * 180.0 / n / 2)
    th = math.radians(theta)
    segs = []
    for k in range(n):
        a, v, b = poly[k - 1], poly[k], poly[(k + 1) % n]
        m1 = ((a[0] + v[0]) / 2, (a[1] + v[1]) / 2)
        m2 = ((v[0] + b[0]) / 2, (v[1] + b[1]) / 2)
        reach = (math.dist(a, v) / 2) * math.sin(th) / math.sin(th + half_angle)
        d = math.dist(v, (cx, cy))
        p = (v[0] + (cx - v[0]) / d * reach, v[1] + (cy - v[1]) / d * reach)
        segs.append((m1, p))
        segs.append((m2, p))
    return segs


def path():
    d = []
    for poly in tiling(range(-10, 11)):
        for a, b in hankin(poly, THETA):
            x1, y1, x2, y2 = SIZE + a[0] * UNIT, a[1] * UNIT, SIZE + b[0] * UNIT, b[1] * UNIT
            if max(x1, x2) < -4 or min(x1, x2) > SIZE + 4 or max(y1, y2) < -4 or min(y1, y2) > SIZE + 4:
                continue
            d.append('M%.2f,%.2fL%.2f,%.2f' % (x1, y1, x2, y2))
    return ' '.join(d)


def svg(kind):
    p = path()
    fade = ('<radialGradient id="f" gradientUnits="userSpaceOnUse" cx="%d" cy="0" r="%d">'
            '<stop offset="0" stop-color="#fff" stop-opacity="1"/>'
            '<stop offset=".45" stop-color="#fff" stop-opacity=".55"/>'
            '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
            '<mask id="fm" maskUnits="userSpaceOnUse" x="0" y="0" width="%d" height="%d">'
            '<rect width="%d" height="%d" fill="url(#f)"/></mask>') % (SIZE, SIZE, SIZE, SIZE, SIZE, SIZE)
    if kind == 'band':
        # a band is the wide line with the narrow one taken out of it
        shape = ('<mask id="bm" maskUnits="userSpaceOnUse" x="0" y="0" width="%d" height="%d">'
                 '<rect width="%d" height="%d" fill="#000"/>'
                 '<path d="%s" stroke="#fff" stroke-width="3.2" fill="none" stroke-linejoin="round"/>'
                 '<path d="%s" stroke="#000" stroke-width="1.5" fill="none" stroke-linejoin="round"/></mask>') % (SIZE, SIZE, SIZE, SIZE, p, p)
        body = '<g mask="url(#fm)"><rect width="%d" height="%d" fill="#fff" mask="url(#bm)"/></g>' % (SIZE, SIZE)
    else:
        shape = ''
        body = ('<g mask="url(#fm)"><path d="%s" stroke="#fff" stroke-width="1.1" fill="none" '
                'stroke-linejoin="round" stroke-linecap="round"/></g>') % p
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">'
            '<defs>%s%s</defs>%s</svg>') % (SIZE, SIZE, SIZE, SIZE, fade, shape, body)


def main():
    from PIL import Image
    from playwright.sync_api import sync_playwright
    res = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
    xcassets = os.path.join(ROOT, 'ios', 'Widget', 'Assets.xcassets')
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as pw:
        browser = pw.chromium.launch()
        for kind in ('band', 'line'):
            page_file = os.path.join(tmp, kind + '.html')
            with open(page_file, 'w') as f:
                f.write('<html><body style="margin:0;background:transparent">%s</body></html>' % svg(kind))
            shots = {}
            for scale in (1, 1.5, 2, 3, 4):
                page = browser.new_page(viewport={'width': SIZE, 'height': SIZE}, device_scale_factor=scale)
                page.goto('file://' + page_file)
                out = os.path.join(tmp, '%s@%sx.png' % (kind, scale))
                page.screenshot(path=out, omit_background=True, clip={'x': 0, 'y': 0, 'width': SIZE, 'height': SIZE})
                page.close()
                shots[scale] = Image.open(out).convert('RGBA').getchannel('A')
            for scale, folder in ((1, 'drawable-mdpi'), (1.5, 'drawable-hdpi'), (2, 'drawable-xhdpi'), (3, 'drawable-xxhdpi'), (4, 'drawable-xxxhdpi')):
                mask = Image.new('RGBA', shots[scale].size, (255, 255, 255, 0))
                mask.putalpha(shots[scale])
                os.makedirs(os.path.join(res, folder), exist_ok=True)
                mask.save(os.path.join(res, folder, 'widget_orn_%s_mask.webp' % kind), 'WEBP', lossless=True, quality=100, method=6)
            folder = os.path.join(xcassets, 'ornament_%s.imageset' % kind)
            os.makedirs(folder, exist_ok=True)
            images = []
            for scale in (2, 3):
                name = 'ornament_%s@%dx.png' % (kind, scale)
                Image.merge('LA', (Image.new('L', shots[scale].size, 255), shots[scale])).save(os.path.join(folder, name), optimize=True)
                images.append({'idiom': 'universal', 'filename': name, 'scale': '%dx' % scale})
            with open(os.path.join(folder, 'Contents.json'), 'w') as f:
                json.dump({'images': images, 'info': {'author': 'xcode', 'version': 1},
                           'properties': {'template-rendering-intent': 'template'}}, f, indent=2)
        browser.close()
    print('written')


if __name__ == '__main__':
    sys.exit(main())
