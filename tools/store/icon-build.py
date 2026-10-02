#!/usr/bin/env python3
"""أيقونة سُنّتي كلّها من أصلٍ واحد: نبض القلب يرسم المسجد النبوي، وتحته
«سُنّتي» بخطّ لاله‌زار مشكولةً كما في التطبيق.

والاسم يدخل الأيقونة مساراتٍ متّجهة لا كتابةً تحتاج الخطّ عند العرض: يُشكَّل
بـHarfBuzz على خطّ لاله‌زار نفسه، فتُحسب مواضع الضمّة والشدّة كما يحسبها
المتصفّح، ثم تُنسخ حدود كل حرف من الخطّ. فالأيقونة واحدة في كل جهاز، حادّة
في كل حجم، ولا تتوقّف على خطٍّ منصّب. ولاله‌زار من القلّة التي فيها ميزتا
تثبيت الحركات mark وmkmk، ولهذا تقع الضمّة على السين والشدّة على النون،
وقد سقطت بهذا أميري ورقّاص والرقعة وغيرها.

ومن الأصل تخرج كل الصور، كلٌّ بقاعدة منصّته:
  الويب       أيقونات مدوّرة الزوايا، وأخرى تُقنَّع بمنطقة أمان ٨٠٪، وicon.svg
  iOS         ١٠٢٤ مربّعة ممتلئة بلا شفافية، فالنظام يدوّرها وحده
  أندرويد     واجهة أمامية شفّافة داخل دائرة الأمان ٦٦ من ١٠٨، وخلفية حمراء،
              ونسخة أحادية اللون للأيقونات الموحّدة في أندرويد ١٣
  المتجر      play-1024 مربّعة ممتلئة

    python3 tools/store/icon-build.py
"""

import asyncio
import io
import sys
from pathlib import Path

import uharfbuzz as harf
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image
from playwright.async_api import async_playwright

import math

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

# الخطّ في المستودع مع رخصته المفتوحة، فالأداة تعمل في أي جهاز
FONT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'fonts' / 'Lalezar-Regular.ttf'
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
NAME = 'سُنّتي'

S = 1024
RADIUS = 230
C = S / 2
RED_D, RED_DD = '#6e1c1c', '#3a0d0d'
GOLD, GOLD_L = '#e0b04a', '#fff0c4'
CREAM = '#fbecc8'


# ── خطّ النبض والمسجد ───────────────────────────────────────────────
def crescent(cx, cy, r, fill, rot=-25):
    """هلال من قوسين، ونصف قطر الداخلي أكبر من نصف الوتر، وإلا كبّره المتصفّح
       حتى ينطبق على الخارجي فلا يبقى شيء."""
    return (f"<path d='M{cx} {cy-r} A{r} {r} 0 1 0 {cx} {cy+r} A{r*1.26:.1f} {r*1.26:.1f} 0 1 1 {cx} {cy-r}Z' "
            f"fill='{fill}' transform='rotate({rot} {cx} {cy})'/>")


def glow_line(d, w=12):
    """الخطّ مرّتين: عريضٌ مموّه تحته فيتوهّج، ورفيعٌ ساطع فوقه."""
    return (f"<path d='{d}' fill='none' stroke='{GOLD}' stroke-width='{w*2.8:.0f}' stroke-linejoin='round' "
            f"stroke-linecap='round' opacity='.55' filter='url(#b14)'/>"
            f"<path d='{d}' fill='none' stroke='{GOLD_L}' stroke-width='{w}' stroke-linejoin='round' stroke-linecap='round'/>")


def tops(points, cres):
    """قمّتا المئذنتين، والسنان والهلال فوق القبّة."""
    out = ''.join(f"<circle cx='{x:.0f}' cy='{y:.0f}' r='30' fill='{GOLD}' opacity='.5' filter='url(#b6)'/>"
                  f"<circle cx='{x:.0f}' cy='{y:.0f}' r='15' fill='{GOLD_L}'/>" for x, y in points)
    x, y0, y1 = cres
    return (out + f"<line x1='{x}' y1='{y0}' x2='{x}' y2='{y1}' stroke='{GOLD_L}' stroke-width='9' stroke-linecap='round'/>"
            + crescent(x, y1 - 22, 16, GOLD_L)
            + f"<circle cx='{x}' cy='{y1-22}' r='30' fill='{GOLD}' opacity='.45' filter='url(#b6)'/>")


def halo(cx, cy, rx, ry, op=.18):
    return f"<ellipse cx='{cx}' cy='{cy}' rx='{rx}' ry='{ry}' fill='{GOLD}' opacity='{op}' filter='url(#b30)'/>"


def mosque_line(y, x0, x1, k):
    """خطّ النبض، وفي وسطه المسجد النبوي: نبضة، فمئذنة، فقبّة، فمئذنة، فنبضة.
       k يصغّر المسجد والنبضتين معاً حول المركز، والخطّ يمتدّ من x0 إلى x1."""
    def X(v):
        return C + (v - C) * k

    def H(v):
        return y - v * k

    d = (f"M{x0} {y} "
         f"L{X(214):.0f} {y} L{X(236):.0f} {H(46):.0f} L{X(258):.0f} {H(-56):.0f} L{X(280):.0f} {y} "
         f"L{X(326):.0f} {y} L{X(332):.0f} {H(292):.0f} L{X(338):.0f} {y} L{X(370):.0f} {y} "
         f"C{X(374):.0f} {H(150):.0f} {X(446):.0f} {H(226):.0f} {C:.0f} {H(232):.0f} "
         f"C{X(578):.0f} {H(226):.0f} {X(650):.0f} {H(150):.0f} {X(654):.0f} {y} "
         f"L{X(686):.0f} {y} L{X(692):.0f} {H(292):.0f} L{X(698):.0f} {y} "
         f"L{X(744):.0f} {y} L{X(766):.0f} {H(46):.0f} L{X(788):.0f} {H(-56):.0f} L{X(810):.0f} {y} "
         f"L{x1} {y}")
    return d, [(X(335), H(312)), (X(695), H(312))], (C, H(232), H(232) - 64 * k)


# شبكة خافتة كشاشة جهاز النبض
GRID = ("<pattern id='grid' width='48' height='48' patternUnits='userSpaceOnUse'>"
        f"<path d='M48 0 L0 0 0 48' fill='none' stroke='{CREAM}' stroke-width='1.2'/></pattern>")

# موضع الاسم في الأصل: مركز حبره، وأقصى عرض وارتفاع له
NAME_CY, NAME_W, NAME_H = 724, 600, 340
LINE_Y, LINE_X0, LINE_X1, LINE_K = 420, 96, 928, 0.82


# ── الاسم مسارات ────────────────────────────────────────────────────
def shaped(text, font_path):
    """يشكّل الاسم بـHarfBuzz ويعيد الحروف ومواضعها بوحدات الخطّ. والحروف
       تخرج مرتّبة من اليسار إلى اليمين حتى في العربية، فتُرصف بجمع المسافات."""
    blob = harf.Blob.from_file_path(str(font_path))
    face = harf.Face(blob)
    font = harf.Font(face)
    buf = harf.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    harf.shape(font, buf, {'kern': True, 'mark': True, 'mkmk': True})
    return face.upem, list(zip(buf.glyph_infos, buf.glyph_positions))


def draw_name(pen_factory, text, font_path, scale, ox, oy):
    """يرسم الحروف بقلمٍ يُعطى، بمقياس وإزاحة، وy مقلوبة لأن الخطّ يصعد
       إلى أعلى والشاشة تنزل إلى أسفل."""
    tt = TTFont(str(font_path))
    gs = tt.getGlyphSet()
    order = tt.getGlyphOrder()
    upem, glyphs = shaped(text, font_path)
    k = scale / upem
    x = 0
    for info, pos in glyphs:
        name = order[info.codepoint]
        t = (k, 0, 0, -k, ox + (x + pos.x_offset) * k, oy - pos.y_offset * k)
        gs[name].draw(TransformPen(pen_factory(), t))
        x += pos.x_advance


def name_path(text, font_path, cx, cy, max_w, max_h):
    """مسار الاسم مضبوطاً بحبره: يُقاس أولاً بمقياس ١٠٠٠، ثم يُكبَّر حتى يملأ
       عرضه أو ارتفاعه، ويُوسَّط حبره لا صندوقه."""
    tt = TTFont(str(font_path))
    bounds = BoundsPen(tt.getGlyphSet())
    draw_name(lambda: bounds, text, font_path, 1000, 0, 0)
    x0, y0, x1, y1 = bounds.bounds
    f = min(max_w / (x1 - x0), max_h / (y1 - y0))
    ox = cx - (x0 + x1) / 2 * f
    oy = cy - (y0 + y1) / 2 * f
    svg = SVGPathPen(tt.getGlyphSet())
    draw_name(lambda: svg, text, font_path, 1000 * f, ox, oy)
    top, bottom = cy - (y1 - y0) * f / 2, cy + (y1 - y0) * f / 2
    return svg.getCommands(), (top, bottom), f


# ── التكوين ─────────────────────────────────────────────────────────
NAME_D, (N_TOP, N_BOTTOM), _ = name_path(NAME, FONT, C, NAME_CY, NAME_W, NAME_H)
LINE_D, TOPS, FINIAL = mosque_line(LINE_Y, LINE_X0, LINE_X1, LINE_K)
COMP_TOP = FINIAL[2] - 22 - 18                 # أعلى الهلال
COMP_CY = (COMP_TOP + N_BOTTOM) / 2            # مركز التكوين كلّه


def defs(stroke_scale=1.0):
    return (f"<radialGradient id='bg' cx='50%' cy='44%' r='74%'>"
            f"<stop offset='0' stop-color='#b5372f'/><stop offset='.55' stop-color='{RED_D}'/>"
            f"<stop offset='1' stop-color='{RED_DD}'/></radialGradient>"
            f"<linearGradient id='ng' gradientUnits='userSpaceOnUse' x1='0' y1='{N_TOP:.0f}' x2='0' y2='{N_BOTTOM:.0f}'>"
            f"<stop offset='0' stop-color='#fff6d8'/><stop offset='.45' stop-color='#f7d27a'/>"
            f"<stop offset='1' stop-color='#d4952f'/></linearGradient>"
            f"<filter id='b6' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='6'/></filter>"
            f"<filter id='b14' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='14'/></filter>"
            f"<filter id='b22' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='22'/></filter>"
            f"<filter id='b30' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='30'/></filter>"
            + GRID)


def figure():
    """النبض والمسجد والاسم، بلا خلفية، بإحداثيات الأصل."""
    return (halo(C, 330, 280, 190) + glow_line(LINE_D, 11) + tops(TOPS, FINIAL)
            # الاسم: توهّج ذهبي كتوهّج النبض، ثم ظلّ يرفعه، ثم الذهب المتدرّج
            + f"<path d='{NAME_D}' fill='rgba(240,186,84,.55)' filter='url(#b22)'/>"
            + f"<path d='{NAME_D}' fill='#7a4a12' opacity='.55' transform='translate(0 10)' filter='url(#b6)'/>"
            + f"<path d='{NAME_D}' fill='url(#ng)'/>")


def background():
    return (f"<rect width='{S}' height='{S}' fill='url(#bg)'/>"
            f"<rect width='{S}' height='{S}' fill='url(#grid)' opacity='.06'/>")


def svg(body, rounded=False, size=S):
    clip = (f"<clipPath id='round'><rect width='{S}' height='{S}' rx='{RADIUS}'/></clipPath>" if rounded else '')
    inner = f"<g clip-path='url(#round)'>{body}</g>" if rounded else body
    return (f"<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}' viewBox='0 0 {S} {S}'>"
            f"<defs>{clip}{defs()}</defs>{inner}</svg>")


def scaled_figure(s, extend_line_to=None):
    """التكوين مصغّراً حول المركز حتى يقع في منطقة أمان، والخطّ يُمدّ بعده إلى
       حافّة المساحة المرئية فلا يقف قبلها ويترك جانبين فارغين."""
    ty = C - COMP_CY * s
    tx = C - C * s
    g = f"<g transform='translate({tx:.2f} {ty:.2f}) scale({s})'>{figure()}</g>"
    if extend_line_to:
        a, b = extend_line_to
        y = ty + LINE_Y * s
        xl, xr = tx + LINE_X0 * s, tx + LINE_X1 * s
        for x0, x1 in ((a, xl), (xr, b)):
            d = f'M{x0:.1f} {y:.1f} L{x1:.1f} {y:.1f}'
            g += (f"<path d='{d}' fill='none' stroke='{GOLD}' stroke-width='{31*s:.1f}' stroke-linecap='round' "
                  f"opacity='.55' filter='url(#b14)'/>"
                  f"<path d='{d}' fill='none' stroke='{GOLD_L}' stroke-width='{11*s:.1f}' stroke-linecap='round'/>")
    return g


# ── أندرويد: أحادي اللون، رسمٌ متّجه بلغة VectorDrawable ───────────────
def circle_d(cx, cy, r):
    return f'M{cx-r:.1f},{cy:.1f}a{r:.1f},{r:.1f} 0 1,0 {2*r:.1f},0a{r:.1f},{r:.1f} 0 1,0 {-2*r:.1f},0'


def monochrome_xml(s):
    """أندرويد ١٣ يلوّن الأيقونة بلون السمة، فيطلب رسماً بلونٍ واحد في دائرة
       الأمان. والإحداثيات هي إحداثيات الأصل، ومجموعةٌ تصغّرها إلى ١٠٨ dp."""
    k = 108 / S
    ty = C - COMP_CY * s
    tx = C - C * s
    cres = crescent(FINIAL[0], FINIAL[2] - 22, 16, '#fff')
    cres_d = cres.split("d='")[1].split("'")[0]
    rot = cres.split("rotate(")[1].split(")")[0].split()
    dots = ''.join(f'<path android:fillColor="#FFFFFFFF" android:pathData="{circle_d(x, y, 15)}"/>' for x, y in TOPS)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/store/icon-build.py. The heartbeat drawing the Prophet's
     mosque, and the name, in one colour for Android 13 themed icons. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
  <group android:scaleX="{k:.6f}" android:scaleY="{k:.6f}">
    <group android:translateX="{tx:.2f}" android:translateY="{ty:.2f}" android:scaleX="{s}" android:scaleY="{s}">
      <path android:strokeColor="#FFFFFFFF" android:strokeWidth="14" android:strokeLineJoin="round"
            android:strokeLineCap="round" android:fillColor="#00000000" android:pathData="{LINE_D}"/>
      {dots}
      <path android:strokeColor="#FFFFFFFF" android:strokeWidth="9" android:strokeLineCap="round"
            android:fillColor="#00000000" android:pathData="M{FINIAL[0]},{FINIAL[1]} L{FINIAL[0]},{FINIAL[2]}"/>
      <group android:rotation="{rot[0]}" android:pivotX="{rot[1]}" android:pivotY="{rot[2]}">
        <path android:fillColor="#FFFFFFFF" android:pathData="{cres_d}"/>
      </group>
      <path android:fillColor="#FFFFFFFF" android:pathData="{NAME_D}"/>
    </group>
  </group>
</vector>
"""


BACKGROUND_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/store/icon-build.py: the red of the app, lighter at the
     middle where the heartbeat glows. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:type="radial" android:gradientRadius="75%"
        android:centerX="0.5" android:centerY="0.44"
        android:startColor="#b5372f" android:centerColor="#6e1c1c" android:endColor="#3a0d0d"/>
</shape>
"""

ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- The heartbeat and the name sit inside the 66dp safe circle of the 108dp
     canvas, so no launcher mask crops them; the line runs on to the edge of
     what is shown. Generated by tools/store/icon-build.py. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
"""


# ── التصيير ─────────────────────────────────────────────────────────
async def render(pg, doc, size, transparent):
    await pg.set_viewport_size({'width': size, 'height': size})
    await pg.set_content(f"<body style='margin:0;background:transparent'>{doc}</body>", wait_until='load')
    await pg.wait_for_timeout(120)
    png = await pg.screenshot(omit_background=transparent)
    return Image.open(io.BytesIO(png))


async def main():
    icons = ROOT / 'docs' / 'icons'
    res = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
    ios = ROOT / 'ios' / 'Sunnati' / 'Assets.xcassets' / 'AppIcon.appiconset'

    full = background() + figure()
    # المقنّعة: التكوين داخل دائرة ٨٠٪، والخلفية تملأ المربّع
    mask_s = 0.80
    maskable = background() + scaled_figure(mask_s, (0, S))
    # أندرويد: داخل دائرة ٦٦ من ١٠٨، والمرئيّ ٧٢ من ١٠٨
    and_s = 0.62
    visible = S * 72 / 108
    foreground = scaled_figure(and_s, (C - visible / 2, C + visible / 2))

    (icons / 'icon.svg').write_text(svg(full, rounded=True, size=512), encoding='utf-8')
    (icons / 'maskable.svg').write_text(svg(maskable, size=512), encoding='utf-8')

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        pg = await b.new_page()

        # الويب: أيقونات مدوّرة الزوايا بشفافية حولها
        for n in (72, 96, 128, 144, 152, 192, 256, 384, 512):
            (await render(pg, svg(full, rounded=True, size=n), n, True)).save(icons / f'icon-{n}.png', optimize=True)
        # آبل تدوّر أيقونة اللمس وحدها، والشفافية فيها تصير سواداً
        (await render(pg, svg(full, size=180), 180, False)).convert('RGB').save(icons / 'icon-180.png', optimize=True)
        for n in (192, 512):
            (await render(pg, svg(maskable, size=n), n, False)).convert('RGB').save(icons / f'maskable-{n}.png', optimize=True)
        (await render(pg, svg(full, size=1024), 1024, False)).convert('RGB').save(icons / 'play-1024.png', optimize=True)
        # والأصل المربّع نفسه في الأدوات، تقرؤه أدوات الصور الأخرى إن احتاجته
        (await render(pg, svg(full, size=1024), 1024, False)).convert('RGB').save(HERE / 'icon-master.png', optimize=True)

        # iOS: مربّعة ممتلئة بلا شفافية، فمتجر آبل يرفض الأيقونة الشفّافة
        (await render(pg, svg(full, size=1024), 1024, False)).convert('RGB').save(ios / 'icon-1024.png', optimize=True)

        # أندرويد: الواجهة الأمامية شفّافة بكل كثافة
        for folder, n in (('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)):
            (await render(pg, svg(foreground, size=n), n, True)).save(
                res / f'mipmap-{folder}' / 'ic_launcher_foreground.png', optimize=True)
        await b.close()

    (res / 'drawable' / 'ic_launcher_background.xml').write_text(BACKGROUND_XML, encoding='utf-8')
    (res / 'drawable' / 'ic_launcher_monochrome.xml').write_text(monochrome_xml(and_s), encoding='utf-8')
    (res / 'mipmap-anydpi' / 'ic_launcher.xml').write_text(ADAPTIVE_XML, encoding='utf-8')
    print('بُنيت الأيقونات: الويب وiOS وأندرويد والمتجر')


if __name__ == '__main__':
    asyncio.run(main())
