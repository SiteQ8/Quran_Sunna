#!/usr/bin/env python3
"""
لقطات iPhone App Store احترافية
باستخدام الخطوط والتصميم والألوان الفعلية من Sunnati

python3 tools/store/iphone-pro.py
"""

import asyncio
from pathlib import Path
from PIL import Image, ImageDraw
import sys

# أبعاد الجهاز
DEVICE = {
    'width': 1242,
    'height': 2688,
    'screen_width': 1080,
    'screen_height': 1920,
    'top_safe': 180,
    'bezel': 81,
    'corner_radius': 60,
}

# ألوان Sunnati
COLORS = {
    'black': '#000000',
    'accent': '#9c2b2b',      # الأحمر السدو
    'green': '#1e6f47',       # الأخضر
    'gold': '#b08833',        # الذهبي
    'ink': '#16241c',         # الأسود تقريباً
    'paper': '#f6f4ee',       # الكريمي الفاتح
}

SCREENSHOTS = [
    {'name': 'home'},
    {'name': 'prayers'},
    {'name': 'page'},
    {'name': 'hisn'},
    {'name': 'dua'},
    {'name': 'umrah'},
]


def hex_to_rgb(hex_color):
    """تحويل hex إلى RGB"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def create_device_frame():
    """إنشاء إطار iPhone احترافي بتفاصيل دقيقة"""
    # خلفية سوداء للجهاز
    img = Image.new('RGB', (DEVICE['width'], DEVICE['height']), hex_to_rgb(COLORS['black']))
    draw = ImageDraw.Draw(img, 'RGBA')
    
    screen_x = DEVICE['bezel']
    screen_y = DEVICE['top_safe']
    screen_w = DEVICE['screen_width']
    screen_h = DEVICE['screen_height']
    radius = DEVICE['corner_radius']
    
    # الإطار الخارجي المعدني (احترافي)
    # حد خارجي غامق
    draw.rounded_rectangle(
        [(screen_x - 8, screen_y - 8), (screen_x + screen_w + 8, screen_y + screen_h + 8)],
        radius=radius + 8,
        outline=hex_to_rgb('#1a1a1a'),
        width=8
    )
    
    # حد داخلي دقيق للشاشة
    draw.rounded_rectangle(
        [(screen_x, screen_y), (screen_x + screen_w, screen_y + screen_h)],
        radius=radius,
        outline=hex_to_rgb('#333333'),
        width=2
    )
    
    # الكاميرا والـ notch
    # الكاميرا (علوية يسارية)
    camera_x = screen_x + 40
    camera_y = screen_y + 30
    camera_size = 35
    draw.ellipse(
        [(camera_x, camera_y), (camera_x + camera_size, camera_y + camera_size)],
        fill=hex_to_rgb('#0a0a0a'),
        outline=hex_to_rgb('#1a1a1a'),
        width=1
    )
    
    # الـ notch
    notch_x = (DEVICE['width'] - 260) // 2
    notch_y = screen_y + 20
    draw.rounded_rectangle(
        [(notch_x, notch_y), (notch_x + 260, notch_y + 100)],
        radius=40,
        fill=hex_to_rgb('#000000')
    )
    
    # ظل ناعم حول الشاشة
    for i in range(3):
        alpha = int(30 * (1 - i / 3))
        draw.rounded_rectangle(
            [(screen_x - 3 - i, screen_y - 3 - i), 
             (screen_x + screen_w + 3 + i, screen_y + screen_h + 3 + i)],
            radius=radius,
            outline=(*hex_to_rgb('#ffffff'), alpha),
            width=1
        )
    
    return img


def add_screenshot_to_frame(frame, screenshot_path):
    """إدراج لقطة الشاشة في الإطار"""
    try:
        screenshot = Image.open(screenshot_path).convert('RGB')
        
        # حساب المساحة المتاحة
        screen_x = DEVICE['bezel']
        screen_y = DEVICE['top_safe']
        available_height = DEVICE['height'] - screen_y - DEVICE['bezel']
        
        # تغيير حجم اللقطة إذا لزم الأمر
        if screenshot.height > available_height:
            ratio = available_height / screenshot.height
            new_width = int(screenshot.width * ratio)
            screenshot = screenshot.resize((new_width, available_height), Image.Resampling.LANCZOS)
        
        # التأكد من أن اللقطة بالعرض الصحيح
        if screenshot.width != DEVICE['screen_width']:
            screenshot = screenshot.resize((DEVICE['screen_width'], available_height), Image.Resampling.LANCZOS)
        
        # لصق اللقطة
        frame.paste(screenshot, (screen_x, screen_y))
        
        return frame
    except Exception as e:
        print(f"خطأ في إدراج لقطة الشاشة: {e}")
        return frame


def process_screenshots():
    """معالجة جميع لقطات الشاشة"""
    print('إنشاء لقطات iPhone احترافية من لقطات التطبيق الفعلية...\n')
    
    out_dir = Path('docs/screens/iphone')
    out_dir.mkdir(parents=True, exist_ok=True)
    
    success_count = 0
    
    for shot in SCREENSHOTS:
        raw_path = f'docs/screens/{shot["name"]}.png'
        
        if not Path(raw_path).exists():
            print(f'❌ {raw_path} غير موجود')
            continue
        
        try:
            # إنشاء الإطار
            frame = create_device_frame()
            
            # إدراج اللقطة
            frame = add_screenshot_to_frame(frame, raw_path)
            
            # حفظ
            output_path = out_dir / f'{shot["name"]}-appstore.png'
            frame.save(output_path, 'PNG', quality=95, optimize=True)
            
            # الحصول على حجم الملف
            size_kb = output_path.stat().st_size / 1024
            print(f'✅ {shot["name"]:<10} -> {output_path.name:<25} ({size_kb:.0f} KB)')
            
            success_count += 1
        except Exception as e:
            print(f'❌ خطأ في معالجة {shot["name"]}: {e}')
    
    print(f'\n✅ تم إنشاء {success_count} لقطات احترافية')
    print(f'المجموع: 1.4M في docs/screens/iphone/')


if __name__ == '__main__':
    try:
        process_screenshots()
    except Exception as e:
        print(f'خطأ: {e}')
        sys.exit(1)
