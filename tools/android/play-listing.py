#!/usr/bin/env python3
"""يضع فيلم الترويج في صفحة التطبيق على Google Play.

Play لا يأخذ الفيلم ملفاً بل رابطاً من YouTube، فيُرفع الفيلم إلى القناة أولاً
ثم يُعطى رابطه هنا، ويُقبل بأي صورة يكتبها YouTube: youtu.be أو watch أو shorts،
ويُحوَّل إلى صورة watch التي تعرفها صفحة المتجر.

    PLAY_SERVICE_ACCOUNT='<json>' python3 tools/android/play-listing.py \\
        --video https://youtu.be/FgFGNEa8W-U [--dry-run]

يفتح تحريراً، ويضع الرابط في كل لغة من لغات الصفحة، ثم يعتمد التحرير، وأيّ خطأ
يترك التحرير بلا اعتماد فلا يتغيّر شيء في المتجر، وبـ--dry-run يقرأ اللغات وما
فيها من فيلم ولا يغيّر شيئاً.
"""

import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

# الرمز والنداء من أداة الرفع نفسها، فلا يُكتب توقيع حساب الخدمة مرتين
_spec = importlib.util.spec_from_file_location('play_upload', Path(__file__).with_name('play-upload.py'))
pu = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pu)


def watch_url(url):
    """رابط YouTube بأي صورة إلى https://www.youtube.com/watch?v=ID."""
    m = (re.search(r'youtu\.be/([\w-]{11})', url) or re.search(r'[?&]v=([\w-]{11})', url)
         or re.search(r'/(?:shorts|embed|live)/([\w-]{11})', url))
    if not m:
        raise SystemExit('هذا ليس رابط فيلم من YouTube: ' + url)
    return 'https://www.youtube.com/watch?v=' + m.group(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--package', default=pu.PACKAGE)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    video = watch_url(a.video)

    raw = os.environ.get('PLAY_SERVICE_ACCOUNT')
    if not raw:
        sys.exit('PLAY_SERVICE_ACCOUNT غير موجود في البيئة')
    sa = json.loads(raw)
    tok = pu.token(sa)
    print('حساب الخدمة:', sa['client_email'])
    print('الفيلم:', video)

    base = f'{pu.API}/{a.package}'
    edit = pu.call('POST', f'{base}/edits', tok, {})['id']
    print('تحرير', edit)
    try:
        listings = pu.call('GET', f'{base}/edits/{edit}/listings', tok).get('listings', [])
        if not listings:
            raise RuntimeError('لا صفحة متجر لهذا التطبيق بعد')
        for item in listings:
            lang = item['language']
            was = item.get('video') or 'لا فيلم'
            if a.dry_run:
                print(f'  {lang}: {was}')
                continue
            pu.call('PATCH', f'{base}/edits/{edit}/listings/{lang}', tok, {'video': video})
            print(f'  {lang}: كان {was}، وصار {video}')
        if a.dry_run:
            pu.call('DELETE', f'{base}/edits/{edit}', tok)
            print('قراءة فقط، ولم يتغيّر شيء')
            return
        try:
            pu.call('POST', f'{base}/edits/{edit}:commit', tok, {})
            print('اعتُمد التحرير، والفيلم في صفحة التطبيق')
        except RuntimeError as e:
            # تطبيق يُدار نشره بيد صاحبه لا تُرسل تغييراته للمراجعة من هنا، فتُحفظ
            # ويرسلها صاحبه من Play Console
            if 'changesNotSentForReview' not in str(e):
                raise
            pu.call('POST', f'{base}/edits/{edit}:commit?changesNotSentForReview=true', tok, {})
            print('اعتُمد التحرير، والتغيير ينتظر أن يُرسل للمراجعة من Play Console')
    except Exception:
        try:
            pu.call('DELETE', f'{base}/edits/{edit}', tok)
            print('أُلغي التحرير، ولم يتغيّر شيء في المتجر')
        except Exception:
            pass
        raise


if __name__ == '__main__':
    main()
