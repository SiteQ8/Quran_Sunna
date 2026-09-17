#!/usr/bin/env python3
"""
لقطات iPhone احترافية لمتجر Apple مع نصوص تسويقية
بخطوط وألوان Sunnati تماماً

python3 tools/store/iphone-appstore.py
"""

import asyncio
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import subprocess
import sys

# ألوان Sunnati من CSS
COLORS = {
    'accent': '#9c2b2b',      # الأحمر الداكن (السدو)
    'green': '#1e6f47',       # الأخضر
    'gold': '#b08833',        # الذهبي
    'ink': '#16241c',         # الأسود تقريباً
    'paper': '#f6f4ee',       # الكريمي الفاتح
    'raised': '#fffdf8',      # أبيض دافئ
    'sunken': '#edeae1',      # رمادي فاتح
    'line': '#e0dbcf',        # خط فاصل
}

# معلومات اللقطات مع نصوص تسويقية عربية
SCREENSHOTS = [
    {
        'name': 'home',
        'title': 'المصحف والمواقيت',
        'subtitle': 'ستة آلاف آية محفوظة في جهازك، وحساب فلكي دقيق لأوقات الصلاة بلا إنترنت',
    },
    {
        'name': 'prayers',
        'title': 'صلاتي',
        'subtitle': 'تتبع صلواتك اليومية والعودة إلى أيام الاستقامة، مع سلسلة أيامك المتصلة',
    },
    {
        'name': 'page',
        'title': 'نص المصحف',
        'subtitle': 'صفحة صفحة كالمطبوع، برواية حفص عن عاصم بالرسم العثماني الأصيل',
    },
    {
        'name': 'hisn',
        'title': 'حصن المسلم',
        'subtitle': 'مئتان وستة وستون ذكراً لكل منها عداد يحفظ موضعك يومك',
    },
    {
        'name': 'dua',
        'title': 'الأدعية والآيات',
        'subtitle': 'ثلاثون موضوعاً من كتيب فإنك بأعيننا، كل موضوع مع آياته من القرآن',
    },
    {
        'name': 'umrah',
        'title': 'صفة العمرة',
        'subtitle': 'خطوة خطوة من الميقات إلى التحلل، معك كل المواقيت والأدعية والأخطاء الشائعة',
    },
]

# أبعاد جهاز App Store
DEVICE = {
    'width': 1242,
    'height': 2688,
    'screen_width': 1080,
    'screen_height': 1920,
    'top_safe': 180,
    'bezel': 81,
}

# أبعاد منطقة النص الوصفي
TEXT_AREA = {
    'top': 2050,
    'height': 600,
    'padding': 40,
    'bg_color': COLORS['raised'],
}


def hex_to_rgb(hex_color):
    """تحويل hex إلى RGB"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def create_iphone_frame():
    """إنشاء إطار iPhone احترافي"""
    img = Image.new('RGB', (DEVICE['width'], DEVICE['height']), hex_to_rgb(COLORS['paper']))
    draw = ImageDraw.Draw(img, 'RGBA')
    
    # منطقة النص البيضاء في الأسفل
    draw.rectangle(
        [(0, TEXT_AREA['top']), (DEVICE['width'], DEVICE['height'])],
        fill=hex_to_rgb(TEXT_AREA['bg_color']),
        outline=None
    )
    
    # حد فاصل دقيق
    draw.line(
        [(0, TEXT_AREA['top']), (DEVICE['width'], TEXT_AREA['top'])],
        fill=hex_to_rgb(COLORS['line']),
        width=1
    )
    
    # إطار الجهاز الخارجي
    screen_x = DEVICE['bezel']
    screen_y = DEVICE['top_safe']
    screen_w = DEVICE['screen_width']
    screen_h = DEVICE['screen_height']
    
    # حد معدني دقيق للشاشة
    draw.rounded_rectangle(
        [(screen_x, screen_y), (screen_x + screen_w, screen_y + screen_h)],
        radius=60,
        outline=hex_to_rgb(COLORS['sunken']),
        width=3
    )
    
    return img


def add_text_to_frame(frame, title, subtitle):
    """إضافة النصوص التسويقية الاحترافية"""
    draw = ImageDraw.Draw(frame)
    
    # محاولة استخدام خطوط النظام
    title_size = 50
    subtitle_size = 32
    
    try:
        # محاولة استخدام خط DejaVu أو Liberation
        title_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size=title_size)
        subtitle_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size=subtitle_size)
    except:
        try:
            # خيار بديل
            title_font = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', size=title_size)
            subtitle_font = ImageFont.truetype('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', size=subtitle_size)
        except:
            # استخدام الخط الافتراضي
            title_font = ImageFont.load_default()
            subtitle_font = ImageFont.load_default()
    
    # مساحة النص
    text_left = TEXT_AREA['padding'] + DEVICE['bezel']
    text_right = DEVICE['width'] - TEXT_AREA['padding'] - DEVICE['bezel']
    text_top = TEXT_AREA['top'] + TEXT_AREA['padding']
    
    # العنوان
    title_y = text_top + 30
    draw.text(
        (text_left, title_y),
        title,
        font=title_font,
        fill=hex_to_rgb(COLORS['accent']),
        anchor='lm',
        direction='rtl',
        align='right'
    )
    
    # الوصف
    subtitle_y = title_y + 100
    # تقسيم النص إلى أسطر
    words = subtitle.split()
    lines = []
    current_line = []
    
    for word in words:
        current_line.append(word)
        line_text = ' '.join(current_line)
        
        # تقدير عرض النص (تقريبي)
        if len(line_text) > 35:
            lines.append(' '.join(current_line[:-1]))
            current_line = [word]
    
    if current_line:
        lines.append(' '.join(current_line))
    
    for i, line in enumerate(lines[:3]):
        draw.text(
            (text_left, subtitle_y + (i * 50)),
            line,
            font=subtitle_font,
            fill=hex_to_rgb(COLORS['ink']),
            anchor='lm',
            direction='rtl',
            align='right'
        )


def add_frame_to_screenshot(screenshot_path, output_path, title, subtitle):
    """دمج لقطة الشاشة في الإطار مع النصوص"""
    # تحميل لقطة الشاشة الخام
    screenshot = Image.open(screenshot_path).convert('RGB')
    
    # إنشاء الإطار الفارغ
    frame = create_iphone_frame()
    
    # إدراج لقطة الشاشة
    screen_x = DEVICE['bezel']
    screen_y = DEVICE['top_safe']
    
    # قص لقطة الشاشة لتناسب الارتفاع المتاح (بدون منطقة النص)
    available_height = TEXT_AREA['top'] - screen_y
    if screenshot.height > available_height:
        crop_height = available_height
        screenshot = screenshot.crop((0, 0, screenshot.width, crop_height))
    
    # لصق اللقطة
    frame.paste(screenshot, (screen_x, screen_y))
    
    # إضافة النصوص
    add_text_to_frame(frame, title, subtitle)
    
    # حفظ
    frame.save(output_path, 'PNG', quality=95, optimize=True)
    print(f'shot {Path(output_path).name}')


async def main():
    """إنشاء جميع اللقطات"""
    print('إنشاء لقطات iPhone احترافية لـ Sunnati...')
    
    # تأكد من وجود المجلد
    out_dir = Path('docs/screens/iphone-appstore')
    out_dir.mkdir(parents=True, exist_ok=True)
    
    for shot in SCREENSHOTS:
        raw_path = f'docs/screens/{shot["name"]}.png'
        
        if not Path(raw_path).exists():
            print(f'تحذير: {raw_path} غير موجود')
            continue
        
        output_path = out_dir / f'{shot["name"]}-appstore.png'
        
        add_frame_to_screenshot(
            raw_path,
            str(output_path),
            shot['title'],
            shot['subtitle']
        )
    
    print(f'\nتم إنشاء اللقطات في: {out_dir}')
    print(f'المجموع: {len(SCREENSHOTS)} لقطات احترافية')


if __name__ == '__main__':
    asyncio.run(main())
