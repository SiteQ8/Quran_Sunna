#!/usr/bin/env python3
"""لقطات المتجر، معنونة.

سير عمل iOS يأخذ ستّ شاشات نظيفة من المحاكي في كل تشغيلة، وأبل تزن صفحة
المنتج ضمن السبعة التي تزنها، والشاشة العارية لا تقول لمن يمرّ عليها شيئاً.
فهذه تضع فوق كل شاشة سطراً من كلام التطبيق نفسه، على ورقه، وبخطوطه، وشريط
سدو مرسوم من tools/social/sadu.mjs لا مصوَّراً عن قماش.

قدّم docs أولاً حتى تأتي الخطوط من التطبيق لا ممّا في الجهاز:

    python3 -m http.server 8840 --directory docs &
    python3 tools/store/appstore-shots.py <مجلّد 6.9-inch> [المخرج]

مجلّد اللقطات هو 6.9-inch من مخرج sunnati-ios-shots في سير العمل، والمخرج
يقع افتراضياً في /tmp/sunnati-store.
"""

import asyncio
import base64
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

# ٦٫٩ بوصة، وهو الصنف الوحيد الذي تطلبه أبل، وتصغّره لما دونه
W, H = 1320, 2868

# سطران لكل شاشة: ما هي، وما يستحق أن يُعرف عنها. سطر واحد طويل يلتفّ
# التفافاً رديئاً في العربية على هذا العرض، وثلاثة تزحم الشاشة عن صورتها.
CAPTIONS = [
    ('1-home.png',   'أوقات الصلاة والأذان',   'تقويم العجيري للكويت، وحسابٌ في جهازك لكل مكان'),
    ('2-azkar.png',  'أذكارك في وقتها',        'الصباح والمساء وأذكار اليوم، بعدّادٍ يحفظ أين وصلت'),
    ('3-quran.png',  'المصحف كاملاً بلا شبكة', 'برواية حفص بالرسم العثماني، ٦٠٤ صفحات وتفسير'),
    ('4-tasbih.png', 'مسبحة تعدّ لك',          'اضغط الدائرة، وتُحفظ تسبيحاتك مع مجموع اليوم'),
    ('5-hisn.png',   'حصن المسلم كاملاً',      'كل أبوابه بين يديك، تقرؤه أو تسمعه'),
    ('6-more.png',   'والقبلة والمساجد والسنن', 'صفة العمرة، وخطة الختمة، والأربعون النووية'),
]

# عرض الهاتف محسوب ليملأ ما تحت العنوان: اللقطة ١٣٢٠ في ٢٨٦٨، فارتفاعها عند
# هذا العرض يقارب ٢٤٣٠، والعنوان والشريط يأخذان نحو ٣٧٥، فيبقى نفَس في الأسفل
# ولا تبقى ثلاث مئة بكسل فارغة
PHONE_W, RADIUS, BORDER = 1120, 88, 10


def sadu_band():
    """شريط السدو من وحدته، فلا يُرسم مرتين في مكانين."""
    out = subprocess.run(
        ['node', '--input-type=module', '-e',
         "import { cushion } from './tools/social/sadu.mjs'; process.stdout.write(cushion());"],
        cwd=ROOT, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def page_html(shot_uri, top, sub, band):
    return f"""<!doctype html><html dir="rtl"><head>
<meta charset="utf-8">
<link rel="stylesheet" href="http://localhost:8840/css/fonts.css">
<style>
  *{{margin:0;padding:0;box-sizing:border-box}}
  html,body{{width:{W}px;height:{H}px;overflow:hidden}}
  body{{
    font-family:'IBM Plex Sans Arabic',sans-serif;
    background:linear-gradient(170deg,#faf8f3 0%,#f2ede1 58%,#e8e0cf 100%);
    display:flex;flex-direction:column;align-items:center;
  }}
  .band{{width:{W}px;height:34px;background-image:{band};background-size:96px 120px;flex:none}}
  .words{{padding:76px 92px 0;text-align:center;flex:none}}
  .top{{font-size:84px;font-weight:700;line-height:1.24;color:#7d2323;letter-spacing:-.4px}}
  .sub{{font-size:41px;font-weight:400;line-height:1.62;color:#5c5346;margin-top:24px}}
  .stage{{flex:1;display:flex;align-items:flex-start;justify-content:center;width:100%;padding-top:70px}}
  .phone{{
    width:{PHONE_W}px;border-radius:{RADIUS}px;background:#16241c;padding:{BORDER}px;
    box-shadow:0 44px 90px rgba(40,26,18,.30), 0 8px 22px rgba(40,26,18,.16);overflow:hidden;
  }}
  .phone img{{display:block;width:100%;border-radius:{RADIUS - BORDER}px}}
</style></head><body>
  <div class="band"></div>
  <div class="words"><div class="top">{top}</div><div class="sub">{sub}</div></div>
  <div class="stage"><div class="phone"><img src="{shot_uri}"></div></div>
</body></html>"""


async def main():
    if len(sys.argv) < 2 or not Path(sys.argv[1]).is_dir():
        sys.exit('اعطِ مجلّد اللقطات: python3 tools/store/appstore-shots.py <6.9-inch> [المخرج]')
    shots = Path(sys.argv[1])
    out = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/sunnati-store')
    out.mkdir(parents=True, exist_ok=True)
    band = sadu_band()

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        for name, top, sub in CAPTIONS:
            src = shots / name
            if not src.exists():
                print('ناقصة: ' + name)
                continue
            uri = 'data:image/png;base64,' + base64.b64encode(src.read_bytes()).decode()
            await page.set_content(page_html(uri, top, sub, band), wait_until='load')
            # الخطوط قبل الرسم، وإلا خرج العنوان بوجهٍ غير وجه التطبيق
            await page.evaluate('document.fonts.ready')
            await page.wait_for_timeout(400)
            await page.screenshot(path=str(out / name))
            print('رُسمت ' + name)
        await browser.close()
    print('في ' + str(out))


if __name__ == '__main__':
    asyncio.run(main())
