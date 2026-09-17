#!/usr/bin/env python3
"""
iPhone App Store screenshots with device frames (1242x2688 resolution).
Generates from app screenshots with iPhone 15 Pro frame added.
Requires: PIL/Pillow and playwright running with service

Serve docs/ on 8840, then: python3 tools/store/iphone-screenshots.py
"""

import asyncio
import os
from pathlib import Path
from PIL import Image, ImageDraw
import subprocess
import sys

# Device dimensions for App Store
DEVICE = {
    'width': 1242,
    'height': 2688,
    'screen_width': 1080,
    'screen_height': 1920,
    'top_safe': 180,
    'bottom_safe': 204,
    'corner_radius': 60,
    'bezel': 81,  # (1242 - 1080) / 2
}

SHOTS = [
    ('home', 'App.go("home")'),
    ('prayers', '''
        const d = new Date();
        const day = (n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - n);
        [1, 2, 3, 4, 6, 7, 8].forEach((n) => Store.PRAYER_KEYS.forEach((k) => Store.setPrayer(k, n % 3 === 0 ? "ontime" : "jamaah", day(n))));
        [5, 9].forEach((n) => Store.PRAYER_KEYS.forEach((k, i) => Store.setPrayer(k, i === 2 ? "late" : "ontime", day(n))));
        Store.setPrayer("fajr", "jamaah"); Store.setPrayer("dhuhr", "jamaah"); Store.setPrayer("asr", "ontime");
        App.go("prayers");
    '''),
    ('page', 'App.helpers.openPage(249)'),
    ('hisn', 'App.state.hisn = 27; App.go("hisn")'),
    ('dua', 'App.go("dua")'),
    ('umrah', '''
        Store.set("umrah", {"before:0": 1, "before:1": 1, "before:2": 1});
        App.go("umrah");
        const head = document.querySelector("#umrah-stages .fold-head");
        if (head) head.click();
    '''),
]

def create_iphone_frame():
    """Create iPhone 15 Pro frame/bezel as PIL Image"""
    img = Image.new('RGBA', (DEVICE['width'], DEVICE['height']), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img)
    
    # Screen area with subtle border
    screen_x = DEVICE['bezel']
    screen_y = DEVICE['top_safe']
    screen_w = DEVICE['screen_width']
    screen_h = DEVICE['screen_height']
    radius = DEVICE['corner_radius']
    
    # Draw rounded rectangle for screen border
    draw.rounded_rectangle(
        [(screen_x, screen_y), (screen_x + screen_w, screen_y + screen_h)],
        radius=radius,
        outline=(51, 51, 51, 77),
        width=2
    )
    
    # Notch area (simplified)
    notch_x = (DEVICE['width'] - 402) // 2
    notch_y = 30
    draw.rounded_rectangle(
        [(notch_x, notch_y), (notch_x + 402, notch_y + 120)],
        radius=40,
        fill=(0, 0, 0, 255)
    )
    
    return img


def add_frame_to_screenshot(screenshot_path, output_path):
    """Composite screenshot into iPhone frame"""
    # Load screenshot
    screenshot = Image.open(screenshot_path).convert('RGBA')
    
    # Create frame
    frame = create_iphone_frame()
    
    # Composite screenshot onto frame
    screen_x = DEVICE['bezel']
    screen_y = DEVICE['top_safe']
    frame.paste(screenshot, (screen_x, screen_y), screenshot)
    
    # Convert to RGB for PNG
    final = Image.new('RGB', (DEVICE['width'], DEVICE['height']), (0, 0, 0))
    final.paste(frame, (0, 0), frame)
    
    # Save
    final.save(output_path, 'PNG', quality=95, optimize=True)
    print(f"framed {Path(output_path).name}")


async def generate_screenshots():
    """Use Playwright to capture app screenshots and add frames"""
    
    # Import playwright
    from playwright.async_api import async_playwright
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
            args=['--no-sandbox']
        )
        
        context = await browser.new_context(
            viewport={'width': 360, 'height': 640},
            device_scale_factor=3,
            locale='ar-KW',
            timezone_id='Asia/Kuwait'
        )
        
        page = await context.new_page()
        
        # Install clock at specific time
        await page.clock.install(time=int(1694607600000))  # Sep 13, 2026 3:40 PM
        
        await page.goto('http://localhost:8840/', wait_until='networkidle')
        await page.wait_for_function(
            'window.Mushaf && window.Mushaf.ready()',
            timeout=40000
        )
        
        # Initialize app state
        await page.evaluate("""
            Store.set('placeAsked', true);
            Store.set('notifyAsked', true);
            Store.set('lastRead', {s: 18, a: 10});
            const st = document.createElement('style');
            st.textContent = '#banner,#toast,.toast,#sheet{display:none!important}';
            document.head.appendChild(st);
        """)
        
        await page.clock.run_for(1500)
        
        # Ensure output directory exists
        out_dir = Path('docs/screens/iphone')
        out_dir.mkdir(parents=True, exist_ok=True)
        
        # Capture each screen
        for name, js_code in SHOTS:
            await page.evaluate(js_code)
            await page.clock.run_for(700)
            await page.wait_for_timeout(200)
            
            # Capture raw screenshot
            raw_path = f'/tmp/screen-{name}.png'
            await page.screenshot(path=raw_path)
            
            # Add iPhone frame
            output_path = f'docs/screens/iphone/{name}-iphone.png'
            add_frame_to_screenshot(raw_path, output_path)
            print(f'shot {name}')
            
            # Cleanup
            if os.path.exists(raw_path):
                os.remove(raw_path)
        
        await browser.close()


def main():
    """Main entry point"""
    print('Generating iPhone App Store screenshots...')
    
    try:
        asyncio.run(generate_screenshots())
        print('All iPhone screenshots with frames generated in docs/screens/iphone/')
        return 0
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
