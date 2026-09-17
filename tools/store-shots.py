#!/usr/bin/env python3
"""يبني لقطات المتجر من لقطات الشاشة الخام.

A raw screenshot is what the app looks like; a store screenshot has to say
what the app is for, to someone scrolling past. Every serious app in this
category does the same three things, and they are worth copying because they
work: a ground in the app's own colour, a headline in large type above, and the
screen itself inside a phone frame so it reads as a phone and not as a picture.

Run:  python3 tools/store-shots.py <folder of shots> <folder to write>
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFont

# the app's own red and paper, the same values the stylesheet uses
RED = (124, 31, 31)
PAPER = (246, 244, 238)

# What each screen is for, said to someone who has never opened the app. The
# first line is large, the second explains it.
CAPTIONS = {
    '1-home':   ('أوقات الصلاة لمكانك', 'والأذان في وقته بصوت مؤذّن تختاره'),
    '2-azkar':  ('أذكارك في وقتها', 'الصباح والمساء وحصن المسلم كاملاً'),
    '3-quran':  ('المصحف كاملاً', 'اقرأ وتابع وردك وختمتك'),
    '4-tasbih': ('مسبحة تعدّ لك', 'وتحفظ ما سبّحت كل يوم'),
    '5-hisn':   ('حصن المسلم', 'أبوابه بنصّها، وبعضها بصوت القارئ'),
    '6-more':   ('كل شيء في مكانه', 'القبلة والتقويم والمساجد القريبة'),
}


def font(size, bold=False):
    """An arabic face for the captions. The app's own IBM Plex Arabic is loaded
    from the system at run time and is not in the repo, so a face is kept here
    rather than hoping the build machine happens to have one."""
    here = os.path.dirname(os.path.abspath(__file__))
    face = os.path.join(here, 'assets', 'caption-bold.ttf' if bold else 'caption.ttf')
    if not os.path.exists(face):
        face = os.path.join(here, 'assets', 'caption.ttf')
    if os.path.exists(face):
        return ImageFont.truetype(face, size)
    return ImageFont.load_default(size)


def shape(text):
    """Arabic needs its letters joined before it is drawn. Pillow lays the
    result out right to left already, so running the bidi pass as well reverses
    the words a second time and «أوقات» comes out as «تاقوأ»: joined correctly
    and read backwards."""
    try:
        import arabic_reshaper
        return arabic_reshaper.reshape(text)
    except ImportError:
        return text


def framed(shot, width):
    """The screenshot inside a phone: a dark bezel with rounded corners."""
    bezel = max(10, width // 60)
    inner = width - bezel * 2
    shot = shot.resize((inner, int(shot.height * inner / shot.width)), Image.LANCZOS)

    radius = width // 12
    frame = Image.new('RGBA', (width, shot.height + bezel * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)
    draw.rounded_rectangle([0, 0, width - 1, frame.height - 1], radius, fill=(26, 26, 26, 255))

    # the screen's own corners are rounded too, or it looks pasted on
    mask = Image.new('L', shot.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, shot.width - 1, shot.height - 1],
                                           radius - bezel, fill=255)
    frame.paste(shot, (bezel, bezel), mask)
    return frame


def build(src, dst, size):
    """One store screenshot: ground, headline, framed screen."""
    name = os.path.splitext(os.path.basename(src))[0]
    big, small = CAPTIONS.get(name, ('سُنّتي', 'رفيقك في يومك'))

    W, H = size
    card = Image.new('RGB', (W, H), RED)
    draw = ImageDraw.Draw(card)

    f_big = font(int(W * 0.070), bold=True)
    f_small = font(int(W * 0.045))

    top = int(H * 0.055)
    for text, f, gap in ((shape(big), f_big, int(H * 0.018)),
                         (shape(small), f_small, 0)):
        w = draw.textbbox((0, 0), text, font=f)[2]
        draw.text(((W - w) // 2, top), text, font=f, fill=(255, 255, 255))
        top += draw.textbbox((0, 0), text, font=f)[3] + gap

    phone = framed(Image.open(src).convert('RGB'), int(W * 0.82))
    card.paste(phone, ((W - phone.width) // 2, int(H * 0.215)), phone)
    card.save(dst, quality=95)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    made = 0
    for f in sorted(os.listdir(src_dir)):
        if not f.endswith('.png'):
            continue
        shot = Image.open(os.path.join(src_dir, f))
        build(os.path.join(src_dir, f), os.path.join(out_dir, f), shot.size)
        made += 1
    print('  %d store screenshots in %s' % (made, out_dir))
    return 0


if __name__ == '__main__':
    sys.exit(main())
