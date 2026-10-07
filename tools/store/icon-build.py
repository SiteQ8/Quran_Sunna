#!/usr/bin/env python3
"""أيقونة سُنّتي كلّها من أصلٍ واحد: لوحةٌ مرسومة فيها محرابٌ من ذهب مدبّب الرأس
تعلوه نجمة ثمانية، ومن نافذته سماء الغروب على ساحل الخليج فيها هلال ومئذنة
بيضاء مضاءة، وحوله أرضٌ قرمزية عليها نقشٌ هندسيّ خافت، وقد تُرك ثلثها الأسفل
خالياً للاسم فيُكتب فيه «سُنّتي» بخطّ لاله‌زار مشكولةً كما في التطبيق.

واللوحة محفوظة بجانب هذه الأداة في icon-art.jpg بمقاس ٢٠٤٨، وتدخل الأيقونة صورةً
محمولةً فيها لا ملفّاً تجلبه، لذا تبقى icon.svg ملفّاً واحداً يُرسم في أي مكان،
وكلّ صورةٍ أصغر من اللوحة تُصغَّر بـLANCZOS لا بما يختاره المتصفّح.

والاسم يدخل الأيقونة مساراتٍ متّجهة لا كتابةً تحتاج الخطّ عند العرض: يُشكَّل
بـHarfBuzz على خطّ لاله‌زار نفسه فتُحسب مواضع الضمّة والشدّة كما يحسبها
المتصفّح، ثم تُنسخ حدود كل حرف من الخطّ، فالأيقونة واحدة في كل جهاز وحادّة في
كل حجم ولا تتوقّف على خطٍّ منصّب. ولاله‌زار من القلّة التي فيها ميزتا تثبيت
الحركات mark وmkmk، ولهذا تقع الضمّة على السين والشدّة على النون، وقد سقطت
بهذا أميري ورقّاص والرقعة وغيرها.

ومن الأصل تخرج كل الصور، كلٌّ بقاعدة منصّته:
  الويب       أيقونات مدوّرة الزوايا، وأخرى تُقنَّع بمنطقة أمان ٨٠٪، وicon.svg
  iOS         ١٠٢٤ مربّعة ممتلئة بلا شفافية، فالنظام يدوّرها وحده
  أندرويد     المحراب والاسم مقصوصَين من اللوحة داخل دائرة الأمان ٦٦ من ١٠٨
              فوق أرضٍ من ألوانها، ونسخة بلونٍ واحد للأيقونات الموحّدة
  المتجر      play-1024 مربّعة ممتلئة، وصورة العرض
  البدء       صور آيفون على لوحة الفجر في splash-default.jpg، وصور أندرويد

    python3 tools/store/icon-build.py
"""

import asyncio
import base64
import io
import math
import os
import re
import sys
from functools import lru_cache
from glob import glob
from pathlib import Path

import numpy as np
import uharfbuzz as harf
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFilter
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

# الخطّ في المستودع مع رخصته المفتوحة، فالأداة تعمل في أي جهاز
FONT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'fonts' / 'Lalezar-Regular.ttf'
ART = HERE / 'icon-art.jpg'          # اللوحة، مربّعة بمقاس ٢٠٤٨
DAWN = HERE / 'splash-default.jpg'   # لوحة الفجر خلف صور البدء في آيفون
NAME = 'سُنّتي'


def find_chrome():
    """المتصفّح الذي يرسم: ما في متغيّر CHROME أولاً، وإلا أحدث كروميوم في مجلّد
       متصفّحات playwright، وإلا يشغّل playwright متصفّحه هو."""
    if os.environ.get('CHROME'):
        return os.environ['CHROME']
    found = glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome')
    if found:
        return max(found, key=lambda p: int(re.search(r'chromium-(\d+)', p).group(1)))
    return None


CHROME = find_chrome()

S = 1024             # وحدات التكوين، فالأيقونة ١٠٢٤ في ١٠٢٤ مهما كان مقاس الصورة
RADIUS = 230         # تدوير الزوايا من ١٠٢٤
C = S / 2
CREAM = '#fbecc8'

ART_IMG = Image.open(ART).convert('RGB')
PX = ART_IMG.width                  # بكسلات اللوحة، وكل بكسلين منها وحدة من التكوين
ART_B64 = base64.b64encode(ART.read_bytes()).decode()


# ── ما في اللوحة، مقيساً منها بوحدات التكوين ─────────────────────────
AXIS = 510.75                       # محور المحراب
STAR_C, STAR_R = (510.75, 71.75), 36  # النجمة: مركزها، ونصف قطرها إلى رؤوسها
ARCH_HALF, ARCH_BASE = 154, 630.5   # نصف عرض الإطار من خارجه، وأسفله
ARCH_SPRING, ARCH_R = 289, 178      # حيث يبدأ القوسان، ونصف قطر كلٍّ منهما
ARCH_INNER = 20                     # حافّة النافذة داخل حافّة الإطار
MOON = (482, 249, 24)               # الهلال في السماء
MINARET = (575, 331, 462)           # محور المئذنة، ورأس هلالها، وقدمها
DOME = (595, 454, 13)               # قبّة المسجد عند قدم المئذنة
HORIZON = 487


def arch_apex(inset=0):
    """رأس القوس بعد أن يدخل الإطار بمقدار inset، فالقوس الداخلي له المركزان
       أنفسهما ونصف قطر أقصر."""
    off = ARCH_R - ARCH_HALF
    return ARCH_SPRING - math.sqrt((ARCH_R - inset) ** 2 - off ** 2)


def arch_d(inset=0, sep=' '):
    """حدّ المحراب داخلاً بمقدار inset، مساراً مغلقاً من أسفل جانبه الأيسر."""
    r, w = ARCH_R - inset, ARCH_HALF - inset
    base = ARCH_BASE - inset
    return (f"M{AXIS-w:.1f}{sep}{base:.1f} V{ARCH_SPRING:.1f} A{r:.1f}{sep}{r:.1f} 0 0{sep}1 {AXIS:.2f}{sep}{arch_apex(inset):.1f} "
            f"A{r:.1f}{sep}{r:.1f} 0 0{sep}1 {AXIS+w:.1f}{sep}{ARCH_SPRING:.1f} V{base:.1f} Z")


def arch_polygon(inset, scale, steps=64):
    """الحدّ نفسه نقاطاً، لقناعٍ يُرسم بمقياس scale."""
    r, w = ARCH_R - inset, ARCH_HALF - inset
    off = ARCH_R - ARCH_HALF
    top = math.atan2(arch_apex(inset) - ARCH_SPRING, -off) % (2 * math.pi)
    pts = [(AXIS - w, ARCH_BASE - inset)]
    # القوس الأيسر مركزه يمين المحور، من جانبه صعوداً حتى الرأس
    for i in range(steps + 1):
        t = math.pi + (top - math.pi) * i / steps
        pts.append((AXIS + off + r * math.cos(t), ARCH_SPRING + r * math.sin(t)))
    for x, y in reversed(pts[1:]):
        pts.append((2 * AXIS - x, y))
    pts.append((AXIS + w, ARCH_BASE - inset))
    return [(x * scale, y * scale) for x, y in pts]


def star_d(r, sep=' '):
    """النجمة الثمانية مربّعين أحدهما مائل على الآخر، حدّاً واحداً حول مركزها،
       ورؤوسها الداخلية حيث يتقاطع ضلعا المربّعين."""
    inner = r * math.cos(math.pi / 4) / math.cos(math.pi / 8)
    pts = []
    for i in range(16):
        t = -math.pi / 2 + i * math.pi / 8
        k = r if i % 2 == 0 else inner
        pts.append(f"{STAR_C[0] + k * math.cos(t):.1f}{sep}{STAR_C[1] + k * math.sin(t):.1f}")
    return 'M' + ' L'.join(pts) + ' Z'


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
    # حرفاً حرفاً لا مساراً واحداً: أداة تدقيق أندرويد ترفض المسار الطويل،
    # وكلّ حرف وحده أقصر وأخفّ على من يرسمه
    glyphs = []
    draw_name(lambda: glyphs.append(SVGPathPen(tt.getGlyphSet())) or glyphs[-1], text, font_path, 1000 * f, ox, oy)
    tidy = lambda d: re.sub(r'-?\d+\.\d+', lambda m: f'{float(m.group()):.1f}'.rstrip('0').rstrip('.'), d)
    parts = [tidy(g.getCommands()) for g in glyphs if g.getCommands()]
    top, bottom = cy - (y1 - y0) * f / 2, cy + (y1 - y0) * f / 2
    return ' '.join(parts), (top, bottom), f, parts


# الاسم في الثلث الخالي تحت المحراب: مركز حبره، وأقصى عرضٍ وارتفاعٍ له،
# فيأخذ نحو ٥٥٪ من العرض ويقع بين ٦٦٪ و٩٤٪ من الارتفاع تقريباً
NAME_CY, NAME_W, NAME_H = 822, 563, 320
NAME_D, (N_TOP, N_BOTTOM), _, NAME_PARTS = name_path(NAME, FONT, C, NAME_CY, NAME_W, NAME_H)


# ── التكوين ─────────────────────────────────────────────────────────
def defs():
    return (f"<linearGradient id='ng' gradientUnits='userSpaceOnUse' x1='0' y1='{N_TOP:.0f}' x2='0' y2='{N_BOTTOM:.0f}'>"
            f"<stop offset='0' stop-color='#fff6d8'/><stop offset='.45' stop-color='#f7d27a'/>"
            f"<stop offset='1' stop-color='#d4952f'/></linearGradient>"
            f"<filter id='b6' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='6'/></filter>"
            f"<filter id='b22' x='-30%' y='-30%' width='160%' height='160%'><feGaussianBlur stdDeviation='22'/></filter>")


def background():
    """اللوحة نفسها صورةً محمولة تملأ المربّع، والمحراب ونجمته فيها مرسومان."""
    return f"<image width='{S}' height='{S}' href='data:image/jpeg;base64,{ART_B64}'/>"


def figure():
    """الاسم في الثلث الخالي من اللوحة: توهّج ذهبي، ثم ظلّ يرفعه، ثم الذهب المتدرّج."""
    return (f"<path d='{NAME_D}' fill='rgba(240,186,84,.55)' filter='url(#b22)'/>"
            f"<path d='{NAME_D}' fill='#7a4a12' opacity='.55' transform='translate(0 10)' filter='url(#b6)'/>"
            f"<path d='{NAME_D}' fill='url(#ng)'/>")


@lru_cache(maxsize=None)
def art_jpeg(px, quality):
    """اللوحة مصغّرةً بـLANCZOS إلى px."""
    buf = io.BytesIO()
    ART_IMG.resize((px, px), Image.LANCZOS).save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
    return base64.b64encode(buf.getvalue()).decode()


def svg(body, rounded=False, size=S, quality=95):
    """التكوين بمقاس size، واللوحة فيه بالمقاس نفسه: تُصغَّر هنا بـLANCZOS فلا
       يصغّرها المتصفّح بطريقته، وتبقى كما هي إن كان المقاس مقاسها أو أكبر."""
    if size < PX and ART_B64 in body:
        body = body.replace(ART_B64, art_jpeg(size, quality))
    clip = (f"<clipPath id='round'><rect width='{S}' height='{S}' rx='{RADIUS}'/></clipPath>" if rounded else '')
    inner = f"<g clip-path='url(#round)'>{body}</g>" if rounded else body
    return (f"<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}' viewBox='0 0 {S} {S}'>"
            f"<defs>{clip}{defs()}</defs>{inner}</svg>")


def data_uri(svg_text):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg_text.encode('utf-8')).decode()


# ── الصور النقطية: كلّها من الأصل المرسوم بمقاس اللوحة ─────────────────
@lru_cache(maxsize=None)
def corner_mask(n):
    """قناع الزوايا المدوّرة يُرسم بمقاس اللوحة ثم يُصغَّر، فحافّته ناعمة."""
    m = Image.new('L', (PX, PX), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, PX - 1, PX - 1), radius=RADIUS * PX / S, fill=255)
    return m.resize((n, n), Image.LANCZOS)


def rounded(master, n):
    """الأيقونة بمقاس n وزواياها مدوّرة شفّافة."""
    out = master.resize((n, n), Image.LANCZOS).convert('RGBA')
    out.putalpha(corner_mask(n))
    return out


def outline_points(mask):
    """نقاط حدّ ما في القناع، فهي وحدها ما يُقاس بُعده."""
    inside = np.asarray(mask) > 127
    core = np.asarray(mask.filter(ImageFilter.MinFilter(3))) > 127
    ys, xs = np.nonzero(inside & ~core)
    return xs.astype(np.float64), ys.astype(np.float64)


def reach(pts, cx, cy):
    xs, ys = pts
    return float(np.sqrt(((xs - cx) ** 2 + (ys - cy) ** 2).max()))


def smallest_circle(pts, cx):
    """أصغر دائرة تحوي النقاط ومركزها على المحور cx، لأن التكوين يُوسَّط عرضاً
       ولو مالت الدائرة الصغرى عنه، بحثاً على المحور بخطوةٍ تضيق حول أحسن مركز."""
    xs, ys = pts
    cy, step = (ys.min() + ys.max()) / 2, 64.0
    while step >= 0.5:
        cy = min((cy + j * step for j in range(-4, 5)), key=lambda y: reach(pts, cx, y))
        step /= 2
    return cx, cy, reach(pts, cx, cy)


def maskable(master, ink, n):
    """الأيقونة كلّها مصغّرة في وسط مربّع حتى يقع كلّ ما فيها داخل دائرة الأمان ٨٠٪،
       وما حولها أرضها القرمزية ممدودةً من حافّتها ثم مموّهة، ثم تذوب الأيقونة فيها
       على شريطٍ رفيع فلا يبين لها حدّ."""
    k = min(0.78, 0.40 * PX / reach(ink, PX / 2, PX / 2))
    m = round(PX * k)
    off = (PX - m) // 2
    small = master.resize((m, m), Image.LANCZOS)
    # الصفّ الأخير من كل جهة قد يحمل أثر القصّ، فتُمدّ الأرض من داخله قليلاً
    edge = np.asarray(small)[3:-3, 3:-3]
    a, b = off + 3, PX - m - off + 3
    ground = Image.fromarray(np.pad(edge, ((a, b), (a, b), (0, 0)), mode='edge'))
    ground = ground.filter(ImageFilter.GaussianBlur(PX * 0.03))
    placed = ground.copy()
    placed.paste(small, (off, off))
    feather = PX * 0.02
    fade = Image.new('L', (PX, PX), 0)
    ImageDraw.Draw(fade).rectangle((off + feather, off + feather, off + m - feather, off + m - feather), fill=255)
    fade = fade.filter(ImageFilter.GaussianBlur(feather / 2.5))
    return Image.composite(placed, ground, fade).resize((n, n), Image.LANCZOS), k


def cutout(name_layer):
    """المحراب ونجمته مقصوصَين من اللوحة بقناعٍ ناعم: كلّ ما بَعُد لونه عن القرمزي،
       لأن أخضر القرمزي وأزرقه يكادان يكونان صفراً بينما الذهب والسماء والمئذنة
       ليست كذلك، وكلّ ما داخل شكل المحراب المعروف وإن قرب لونه منه، ثم الاسم
       فوقهما، ولا يُؤخذ بعيدٌ عن المحراب والنجمة وإن ابتعد لونه فلا تدخل نقطةٌ
       شاردة من النقش."""
    a = np.asarray(ART_IMG, dtype=np.float32)
    far = np.maximum(a[..., 1] - 6, a[..., 2] - 4)
    colour = np.clip((far - 8) / 40, 0, 1)
    k = PX / S
    near = Image.new('L', (PX, PX), 0)
    d = ImageDraw.Draw(near)
    d.polygon(arch_polygon(-14, k), fill=255)
    d.ellipse(((STAR_C[0] - STAR_R - 14) * k, (STAR_C[1] - STAR_R - 14) * k,
               (STAR_C[0] + STAR_R + 14) * k, (STAR_C[1] + STAR_R + 14) * k), fill=255)
    shape = Image.new('L', (PX, PX), 0)
    ImageDraw.Draw(shape).polygon(arch_polygon(5, k), fill=255)
    shape = shape.filter(ImageFilter.GaussianBlur(1.5))
    alpha = np.maximum(colour * (np.asarray(near) / 255.0), np.asarray(shape) / 255.0)
    cut = Image.fromarray(np.dstack([a, alpha * 255]).round().astype(np.uint8), 'RGBA')
    return Image.alpha_composite(cut, name_layer)


def adaptive(fig, centre, radius, n):
    """الواجهة الأمامية بمقاس n: مركز الدائرة الصغرى التي تحوي التكوين في وسط
       المربّع، ونصف قطرها ٣٣ من ١٠٨ إلا قليلاً، فلا يقصّه قناعٌ أيّاً كان شكله."""
    k = 33 / 108 * n / radius * 0.985
    half = n / 2 / k
    pad = math.ceil(half)
    big = Image.new('RGBA', (PX + 2 * pad, PX + 2 * pad))
    big.paste(fig, (pad, pad))
    cx, cy = centre[0] + pad, centre[1] + pad
    return big.resize((n, n), Image.LANCZOS, box=(cx - half, cy - half, cx + half, cy + half))


def ground_colours():
    """ألوان الأرض القرمزية من اللوحة نفسها: قرب الإطار حيث تتوهّج، ثم على بُعدٍ
       منه، ثم في الزوايا، وكلٌّ وسيطُ ما في موضعه فلا يحسب النقشَ فيه."""
    k = PX / S
    a = np.asarray(ART_IMG)

    def median(boxes):
        px = np.concatenate([a[round(y0 * k):round(y1 * k), round(x0 * k):round(x1 * k)].reshape(-1, 3)
                             for x0, y0, x1, y1 in boxes])
        return '#%02x%02x%02x' % tuple(int(v) for v in np.median(px, axis=0))

    beside = lambda d0, d1: [(AXIS + ARCH_HALF + d0, 300, AXIS + ARCH_HALF + d1, 600),
                             (AXIS - ARCH_HALF - d1, 300, AXIS - ARCH_HALF - d0, 600)]
    corners = [(0, 0, 40, 40), (S - 40, 0, S, 40), (0, S - 40, 40, S), (S - 40, S - 40, S, S)]
    return median(beside(20, 50)), median(beside(120, 170)), median(corners)


GLOW, MID, EDGE = ground_colours()


# ── أندرويد: أحادي اللون، رسمٌ متّجه بلغة VectorDrawable ───────────────
def crescent_d(cx, cy, r, rot, sep=','):
    """هلال من قوسين مدوَّراً بزاوية rot، نقاطاً محسوبة لا تحويلاً، ونصف قطر
       الداخلي أكبر من نصف الوتر، وإلا كبّره الراسم حتى ينطبق على الخارجي."""
    a = math.radians(rot)
    p = lambda x, y: (cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a))
    (x0, y0), (x1, y1) = p(0, -r), p(0, r)
    return (f"M{x0:.1f}{sep}{y0:.1f} A{r:.1f}{sep}{r:.1f} 0 1{sep}0 {x1:.1f}{sep}{y1:.1f} "
            f"A{r*1.26:.1f}{sep}{r*1.26:.1f} 0 1{sep}1 {x0:.1f}{sep}{y0:.1f} Z")


def minaret_d():
    """المئذنة نحيلةً كما في اللوحة: بدنٌ وشرفة وقنديل تعلوه قبّةٌ صغيرة وسنانها،
       قائمةً على خطّ الساحل الممتدّ عرض النافذة، وعند قدمها قبّة المسجد، كلّها
       بلونٍ واحد، والقبّة تبتعد عن البدن بفرجة لأنهما إذا اتّصلا صارا حرفاً يُقرأ."""
    x, top, foot = MINARET
    rect = lambda x0, y0, x1, y1: f"M{x0:.1f},{y0:.1f} H{x1:.1f} V{y1:.1f} H{x0:.1f} Z"
    dome = lambda cx, cy, r: f"M{cx-r:.1f},{cy:.1f} A{r:.1f},{r:.1f} 0 0,1 {cx+r:.1f},{cy:.1f} Z"
    dx, dy, dr = DOME
    w = ARCH_HALF - ARCH_INNER - 16
    return ' '.join([
        rect(x - 7, top + 46, x + 7, HORIZON),                      # البدن
        rect(x - 12.5, top + 40, x + 12.5, top + 47),               # الشرفة
        rect(x - 7, top + 26, x + 7, top + 41),                     # القنديل
        dome(x, top + 27, 9),                                       # قبّته
        rect(x - 1.8, top + 4, x + 1.8, top + 19),                  # السنان
        dome(dx + 19, HORIZON - 2, dr + 7),                         # قبّة المسجد
        rect(AXIS - w, HORIZON - 2, AXIS + w, HORIZON + 4),         # الساحل
    ])


def mono_shapes():
    """ما يُرسم بلونٍ واحد، بإحداثيات التكوين: حدّا المحراب الخارجي والداخلي، والنجمة،
       والهلال، والمئذنة والقبّة، والاسم."""
    stroke = lambda d, w: ('stroke', d, w)
    return ([stroke(arch_d(9, ','), 18), stroke(arch_d(ARCH_INNER + 3, ','), 7),
             stroke(star_d(STAR_R - 5, ','), 9),
             ('fill', crescent_d(*MOON, rot=-40), 0), ('fill', minaret_d(), 0)]
            + [('fill', d, 0) for d in NAME_PARTS])


def mono_transform(centre, radius):
    """من إحداثيات التكوين إلى مربّع ١٠٨: المقياس نفسه الذي صُغّرت به الواجهة
       الأمامية، والمركز نفسه، فيقع الرسم حيث تقع الصورة."""
    k = 33 / radius * 0.985                 # من بكسل اللوحة إلى وحدة ١٠٨
    s = k * PX / S                          # ومن وحدة التكوين
    return 54 - centre[0] * k, 54 - centre[1] * k, s


def monochrome_xml(centre, radius):
    """أندرويد ١٣ يلوّن الأيقونة بلون السمة، فيطلب رسماً بلونٍ واحد في دائرة
       الأمان، وهذا مرسومٌ باليد على ما في اللوحة لا منسوخٌ منها."""
    tx, ty, s = mono_transform(centre, radius)
    paths = []
    for kind, d, w in mono_shapes():
        if kind == 'stroke':
            paths.append(f'<path android:strokeColor="#FFFFFFFF" android:strokeWidth="{w}" android:strokeLineJoin="miter" '
                         f'android:fillColor="#00000000" android:pathData="{d}"/>')
        else:
            paths.append(f'<path android:fillColor="#FFFFFFFF" android:pathData="{d}"/>')
    body = '\n      '.join(paths)
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/store/icon-build.py. The mihrab of the painting in one
     colour for Android 13 themed icons: its outer and inner outlines, the star
     on its crown, the crescent and the minaret in its window, and the name. -->
<!-- tools:ignore VectorPath: the launcher draws this once into a cached bitmap,
     so the cost lint warns about is paid once, and a letter cut shorter than
     its outline would no longer be the name. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools" tools:ignore="VectorPath"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
  <group android:translateX="{tx:.3f}" android:translateY="{ty:.3f}" android:scaleX="{s:.5f}" android:scaleY="{s:.5f}">
      {body}
  </group>
</vector>
"""


def background_xml():
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/store/icon-build.py: the crimson ground of the painting,
     sampled from it, glowing where the mihrab stands and darker at the corners. -->
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:type="radial" android:gradientRadius="46%"
        android:centerX="0.5" android:centerY="0.42"
        android:startColor="{GLOW}" android:centerColor="{MID}" android:endColor="{EDGE}"/>
</shape>
"""


ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- The mihrab cut out of the painting, and the name, sit inside the 66dp safe
     circle of the 108dp canvas, so no launcher mask crops them. Generated by
     tools/store/icon-build.py. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>
</adaptive-icon>
"""


def notification_xml():
    """أيقونة شريط الإشعارات: ظلٌّ بلونٍ واحد يلوّنه النظام، فالمحراب حدّاً
       سميكاً وفيه الهلال، بلا لوحة ولا اسم لأنهما لا يُقرآن عند ٢٤ نقطة."""
    half, top, base = 6.2, 2, 22
    r = half * ARCH_R / ARCH_HALF
    off = r - half
    spring = top + math.sqrt(r * r - off * off)
    outline = (f"M{12-half:.1f},{base} V{spring:.2f} A{r:.2f},{r:.2f} 0 0,1 12,{top} "
               f"A{r:.2f},{r:.2f} 0 0,1 {12+half:.1f},{spring:.2f} V{base} Z")
    return f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Generated by tools/store/icon-build.py. The status bar draws a silhouette
     in its own colour, so the mihrab is one thick white outline with the
     crescent inside it: the painting and the name are left out, since neither
     reads at twenty four points. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
  <path android:strokeColor="#FFFFFFFF" android:strokeWidth="1.8" android:strokeLineJoin="miter"
        android:fillColor="#00000000" android:pathData="{outline}"/>
  <path android:fillColor="#FFFFFFFF" android:pathData="{crescent_d(12.9, 13.2, 3.5, -40)}"/>
</vector>
"""


# ── شاشات البدء وصورة العرض ─────────────────────────────────────────
def splash_page(w, h, icon, cy, shadow):
    """صفحةٌ بمقاس الشاشة شفّافة إلا من الأيقونة المدوّرة في وسطها عرضاً ومركزها
       على cy من ارتفاعها، وتحتها ظلّها أو توهّجها، ولا كتابة تحتها ولا خطّ لأن
       الترحيب يُكتب فوق الصورة ساعة يُفتح التطبيق، والاسم في الأيقونة أصلاً."""
    mark = data_uri(svg(background() + figure(), rounded=True, size=icon))
    left, top = (w - icon) // 2, round(h * cy - icon / 2)
    return (f"<!doctype html><meta charset=utf-8><style>html,body{{margin:0;width:{w}px;height:{h}px;"
            f"background:transparent;overflow:hidden}}</style>"
            f"<img src='{mark}' width='{icon}' height='{icon}' style='position:absolute;left:{left}px;top:{top}px;"
            f"filter:drop-shadow({shadow})'>")


def apple_scale(w, h):
    """كثافة الشاشة التي صُنعت لها الصورة: الهواتف الكبيرة بثلاث، وما سواها باثنتين."""
    return 3 if w >= 1080 and h / w > 1.7 else 2


def cover(img, w, h):
    """اللوحة تغطّي الشاشة كلّها مقصوصةً من وسطها، مكبّرةً أو مصغّرةً بـLANCZOS."""
    k = max(w / img.width, h / img.height)
    bw, bh = w / k, h / k
    box = ((img.width - bw) / 2, (img.height - bh) / 2, (img.width + bw) / 2, (img.height + bh) / 2)
    return img.resize((w, h), Image.LANCZOS, box=box)


def feature_graphic():
    """صورة العرض في صفحة Play، ١٠٢٤ في ٥٠٠: الأيقونة مربّعاً مدوّراً على اليمين،
       والاسم بذهب لاله‌زار والوصف تحته على اليسار، فوق أرضٍ قرمزية من ألوان اللوحة
       أدكن من أرض الأيقونة، لأنها لو كانت بلونها ذابت فيها حافّة الأيقونة."""
    W, H = 1024, 500
    tile, tx = 330, 610
    ty = (H - tile) // 2
    mark = data_uri(svg(background() + figure(), rounded=True, size=tile))
    nd, (nt, nb), _, _ = name_path(NAME, FONT, 316, 196, 400, 196)
    plex = base64.b64encode((ROOT / 'docs' / 'fonts' / 'plex-arabic-600-arabic.woff2').read_bytes()).decode()
    deep = '#%02x%02x%02x' % tuple(round(int(EDGE[i:i + 2], 16) * 0.62) for i in (1, 3, 5))
    art = (f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{H}' viewBox='0 0 {W} {H}' style='position:absolute;inset:0'>"
           f"<defs>{defs()}"
           f"<linearGradient id='fg' gradientUnits='userSpaceOnUse' x1='0' y1='{nt:.0f}' x2='0' y2='{nb:.0f}'>"
           f"<stop offset='0' stop-color='#fff6d8'/><stop offset='.45' stop-color='#f7d27a'/>"
           f"<stop offset='1' stop-color='#d4952f'/></linearGradient>"
           f"<radialGradient id='fbg' gradientUnits='userSpaceOnUse' cx='316' cy='230' r='760'>"
           f"<stop offset='0' stop-color='{MID}'/><stop offset='.5' stop-color='{EDGE}'/>"
           f"<stop offset='1' stop-color='{deep}'/></radialGradient></defs>"
           f"<rect width='{W}' height='{H}' fill='url(#fbg)'/>"
           f"<path d='{nd}' fill='rgba(240,186,84,.55)' filter='url(#b22)'/>"
           f"<path d='{nd}' fill='#7a4a12' opacity='.55' transform='translate(0 8)' filter='url(#b6)'/>"
           f"<path d='{nd}' fill='url(#fg)'/></svg>")
    return (f"<!doctype html><meta charset=utf-8><style>@font-face{{font-family:P;src:url(data:font/woff2;base64,{plex});font-weight:600}}"
            f"html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden}}</style>{art}"
            f"<img src='{mark}' width='{tile}' height='{tile}' style='position:absolute;left:{tx}px;top:{ty}px;"
            f"filter:drop-shadow(0 16px 30px rgba(12,0,0,.6))'>"
            f"<div dir=rtl style='position:absolute;left:66px;width:500px;top:318px;text-align:center;white-space:nowrap;"
            f"font:600 28px/1.5 P,sans-serif;color:{CREAM}'>مصحف ومواقيت وأذكار وسنن، في جهازك</div>")


# ── التصيير ─────────────────────────────────────────────────────────
def painted(img):
    """زرقة السماء لا تكون إلا في نافذة المحراب، فالقرمزي والذهب كلّها أحمر من
       أزرقها، لذا إن خلت الصورة من الزرقة فاللوحة لم تُرسم."""
    r, g, b = img.convert('RGB').split()
    blue = np.asarray(b, dtype=np.int16) - np.asarray(r, dtype=np.int16)
    return int((blue > 40).sum()) >= 16


async def render(pg, doc, size, transparent, check=True):
    await pg.set_viewport_size({'width': size, 'height': size})
    await pg.set_content(f"<body style='margin:0;background:transparent'>{doc}</body>", wait_until='load')
    await pg.wait_for_timeout(120)
    img = Image.open(io.BytesIO(await pg.screenshot(omit_background=transparent)))
    # اللوحة محمولة في الأيقونة، ومع ذلك يُسأل هل رُسمت، كما يُسأل عن الشعار
    # في شاشات البدء: أيقونة فارغة لا ينتبه لها أحد حتى تُنشر
    if check and not painted(img):
        raise RuntimeError(f'the painting did not show; a {size}px icon would ship without it')
    return img


async def shot(pg, html, w, h, path=None, face=None):
    """صفحةٌ شفّافة تُصوَّر بعد أن يُسأل هل رُسم كلّ ما فيها."""
    await pg.set_viewport_size({'width': w, 'height': h})
    await pg.set_content(html, wait_until='load')
    await pg.evaluate('document.fonts.ready')
    await pg.wait_for_timeout(150)
    # الشعار محمول في الصفحة نفسها لا من منفذ، فصفحةٌ بلا أصل لا تجلب
    # شيئاً من خادم. ومع ذلك يُسأل هل رُسم فعلاً: شُحنت شاشة البدء أشهراً
    # بمربّع فارغ مكان الشعار ولم ينظر أحد في الملف المكتوب.
    name = path.name if path else f'{w}x{h}'
    drew = await pg.evaluate('[...document.images].every(i => i.complete && i.naturalWidth > 0)')
    if not drew:
        raise RuntimeError(f'the mark did not load; the splash would ship a broken image box: {name}')
    if face and not await pg.evaluate(f'document.fonts.check("{face}")'):
        raise RuntimeError(f'the face did not load; {name} would be drawn in the wrong font')
    img = Image.open(io.BytesIO(await pg.screenshot(omit_background=True))).convert('RGBA')
    # والشعار نفسه يحمل اللوحة، فيُسأل عنها أيضاً
    if not painted(img):
        raise RuntimeError(f'the painting did not show; {name} would ship without it')
    return img


async def main():
    icons = ROOT / 'docs' / 'icons'
    res = ROOT / 'android' / 'app' / 'src' / 'main' / 'res'
    ios = ROOT / 'ios' / 'Sunnati' / 'Assets.xcassets' / 'AppIcon.appiconset'

    # icon.svg لا يُعرض أكبر من ٥١٢، فاللوحة فيه بهذا المقاس وبجودة أخفّ
    (icons / 'icon.svg').write_text(svg(background() + figure(), rounded=True, size=512, quality=85), encoding='utf-8')

    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        pg = await b.new_page()

        # الأصل: اللوحة والاسم بمقاس اللوحة، ومنه تُصغَّر كل أيقونة بـLANCZOS
        master = (await render(pg, svg(background() + figure(), size=PX), PX, False)).convert('RGB')
        name_layer = (await render(pg, svg(figure(), size=PX), PX, True, check=False)).convert('RGBA')

        # الويب: أيقونات مدوّرة الزوايا بشفافية حولها
        for n in (72, 96, 128, 144, 152, 192, 256, 384, 512):
            rounded(master, n).save(icons / f'icon-{n}.png', optimize=True)
        # آبل تدوّر أيقونة اللمس وحدها، والشفافية فيها تصير سواداً
        master.resize((180, 180), Image.LANCZOS).save(icons / 'icon-180.png', optimize=True)
        square = master.resize((1024, 1024), Image.LANCZOS)
        square.save(icons / 'play-1024.png', optimize=True)
        # والأصل المربّع نفسه في الأدوات، تقرؤه أدوات الصور الأخرى إن احتاجته
        square.save(HERE / 'icon-master.png', optimize=True)
        # iOS: مربّعة ممتلئة بلا شفافية، فمتجر آبل يرفض الأيقونة الشفّافة
        square.save(ios / 'icon-1024.png', optimize=True)

        # أندرويد: المحراب والاسم مقصوصَين، وما يُقاس منهما حبرهما لا توهّجهما
        fig = cutout(name_layer)
        ink = outline_points(fig.getchannel('A').point(lambda v: 255 if v > 150 else 0))
        # المقنّعة للويب: الأيقونة كلّها في دائرة الأمان ٨٠٪ حول وسط المربّع
        for n in (192, 512):
            img, k = maskable(master, ink, n)
            img.save(icons / f'maskable-{n}.png', optimize=True)
        cx, cy, radius = smallest_circle(ink, PX / 2)
        for folder, n in (('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)):
            adaptive(fig, (cx, cy), radius, n).save(res / f'mipmap-{folder}' / 'ic_launcher_foreground.png', optimize=True)
        (res / 'drawable' / 'ic_launcher_background.xml').write_text(background_xml(), encoding='utf-8')
        (res / 'drawable' / 'ic_launcher_monochrome.xml').write_text(monochrome_xml((cx, cy), radius), encoding='utf-8')
        (res / 'mipmap-anydpi' / 'ic_launcher.xml').write_text(ADAPTIVE_XML, encoding='utf-8')
        (res / 'drawable' / 'ic_notification.xml').write_text(notification_xml(), encoding='utf-8')
        print(f'بُنيت الأيقونات: الويب وiOS وأندرويد والمتجر، والمقنّعة بمقياس {k:.3f}')

        # صورة نافذة أندرويد قبل أن ترسم الصفحة: الأيقونة وحدها، ١٢٠ dp
        for folder, n in (('mdpi', 120), ('hdpi', 180), ('xhdpi', 240), ('xxhdpi', 360), ('xxxhdpi', 480)):
            rounded(master, n).save(res / f'drawable-{folder}' / 'splash.png', optimize=True)

        # لوحتا SplashView: الأيقونة وحدها في وسط مربّع شفّاف، والتطبيق يرسمها فوق
        # لوحته ويكتب الترحيب تحتها، ففي النهار ظلٌّ داكن وفي الليل توهّجٌ دافئ
        for name, shadow in (('splash_art', '0 16px 22px rgba(40,10,10,.35)'),
                             ('splash_art_night', '0 0 24px rgba(255,200,120,.2)')):
            path = res / 'drawable-nodpi' / f'{name}.png'
            (await shot(pg, splash_page(1080, 1080, 886, 0.5, shadow), 1080, 1080, path)).save(path, optimize=True)

        # صور البدء التي يعرضها آيفون للتطبيق المثبّت من المتصفّح: لوحة الفجر تغطّي
        # الشاشة، والأيقونة عرضها ١٣٢ نقطة ومركزها على ٤٢٪ من الارتفاع
        # وتُحفظ JPEG لا PNG: اللوحة بألوانها الكاملة كانت تجعل الصورة الواحدة ثلاثة
        # ميغابايت، وآيفون يقبل JPEG لصور البدء كما يقبل PNG
        dawn = Image.open(DAWN).convert('RGB')
        for f in sorted((ROOT / 'docs' / 'splash').glob('splash-*.*')):
            w, h = map(int, f.stem.split('-')[1].split('x'))
            icon = 132 * apple_scale(w, h)
            mark = await shot(pg, splash_page(w, h, icon, 0.42, f'0 {icon // 24}px {icon // 10}px rgba(40,10,10,.28)'), w, h, f)
            out = f.with_suffix('.jpg')
            Image.alpha_composite(cover(dawn, w, h).convert('RGBA'), mark).convert('RGB').save(out, quality=84, optimize=True, progressive=True)
            if f != out:
                f.unlink()

        # صورة العرض في Play
        out = ROOT / 'play' / 'feature-graphic-1024x500.png'
        (await shot(pg, feature_graphic(), 1024, 500, out, face='600 28px P')).convert('RGB').save(out, optimize=True)
        await b.close()
    print('بُنيت شاشات البدء، وأيقونة الإشعار، وصورة العرض')


if __name__ == '__main__':
    asyncio.run(main())
