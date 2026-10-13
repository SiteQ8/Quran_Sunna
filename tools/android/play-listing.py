#!/usr/bin/env python3
"""صفحة التطبيق في Google Play: الفيلم والأيقونة وصورة العرض ولقطات الهاتف.

Play لا يأخذ الفيلم ملفاً بل رابطاً من YouTube، فيُرفع الفيلم إلى القناة أولاً
ثم يُعطى رابطه هنا، ويُقبل بأي صورة يكتبها YouTube: youtu.be أو watch أو shorts،
ويُحوَّل إلى صورة watch التي تعرفها صفحة المتجر. أما الصور فتُرفع ملفات، وكل
نوع منها يُستبدل كله في كل لغة من لغات الصفحة، فلا تبقى لقطة قديمة بين الجديدة.

    PLAY_SERVICE_ACCOUNT='<json>' python3 tools/android/play-listing.py \\
        [--video https://youtu.be/VONcaRYi91M] \\
        [--icon play/listing/icon-512.png] [--feature play/feature-graphic-1024x500.png] \\
        [--phone play/listing/phone] [--text play/listing/ar] [--status] [--dry-run]

ونص الصفحة من مجلّد باسم لغتها، play/listing/ar، فيه الاسم والوصف القصير
والكامل في title.txt وshort.txt وfull.txt، وما وُجد منها يُكتب في صفحة تلك اللغة
وحدها، ويُقاس قبل أن يُرسل شيء.

--status يقرأ المسارات وما فيها من إصدارات، وما في الصفحة من فيلم وصور، ولا
يغيّر شيئاً. وبـ--dry-run يقرأ ما سيتغيّر ولا يغيّره. وأيّ خطأ يترك التحرير بلا
اعتماد فلا يتغيّر شيء في المتجر.
"""

import argparse
import importlib.util
import json
import os
import re
import struct
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


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit(f'{path} ليس PNG')
    return struct.unpack('>II', head[16:24])


def checked(kind, paths):
    """ما يقبله Play لكل نوع، يُفحص هنا قبل أن يرفضه هو في منتصف التحرير."""
    for p in paths:
        w, h = png_size(p)
        if kind == 'icon' and (w, h) != (512, 512):
            raise SystemExit(f'الأيقونة {w}×{h}، وPlay يريدها 512×512')
        if kind == 'featureGraphic' and (w, h) != (1024, 500):
            raise SystemExit(f'صورة العرض {w}×{h}، وPlay يريدها 1024×500')
        if kind == 'phoneScreenshots' and (min(w, h) < 320 or max(w, h) > 3840 or max(w, h) > 2 * min(w, h)):
            raise SystemExit(f'{p} {w}×{h}، وPlay يريد ضلعاً بين 320 و3840 ونسبةً لا تزيد على اثنين')
        if os.path.getsize(p) > 8 * 1024 * 1024:
            raise SystemExit(f'{p} أكبر من ثمانية ميغابايت')
    if kind == 'phoneScreenshots' and not 2 <= len(paths) <= 8:
        raise SystemExit(f'لقطات الهاتف {len(paths)}، وPlay يريد من اثنتين إلى ثمانٍ')
    return paths


# النص في المستودع مجلّد لكل لغة باسمها، play/listing/ar: الاسم في title.txt
# والوصف القصير في short.txt والكامل في full.txt، وما وُجد منها يُكتب، ويحدّ Play
# الاسم بثلاثين حرفاً والقصير بثمانين والكامل بأربعة آلاف
TEXT_FIELDS = (('title.txt', 'title', 30), ('short.txt', 'shortDescription', 80),
               ('full.txt', 'fullDescription', 4000))


def listing_text(folder):
    words = {}
    for name, field, limit in TEXT_FIELDS:
        path = Path(folder) / name
        if not path.is_file():
            continue
        text = path.read_text(encoding='utf-8').strip()
        if len(text) > limit:
            raise SystemExit(f'{path} طوله {len(text)} حرفاً، وPlay يأخذ {limit}')
        words[field] = text
    if not words:
        raise SystemExit(f'لا نص في {folder}: title.txt أو short.txt أو full.txt')
    return words


def status(base, edit, tok):
    for t in pu.call('GET', f'{base}/edits/{edit}/tracks', tok).get('tracks', []):
        for r in t.get('releases', []) or [{}]:
            print(f"  مسار {t['track']}: {r.get('name', '')} رموز {','.join(r.get('versionCodes', []) or ['لا شيء'])}"
                  f" | {r.get('status', '')}{' | ' + str(r['userFraction']) if 'userFraction' in r else ''}"
                  f"{' | ملاحظات ' + str(len(r['releaseNotes'])) if r.get('releaseNotes') else ''}"
                  f"{' | بلدان الإصدار ' + str(r['countryTargeting']) if r.get('countryTargeting') else ''}")
    # a release in production reaches only the countries the track is offered
    # in, and a track offered nowhere reaches no one however complete it reads
    for track in ('production', 'alpha'):
        try:
            ca = pu.call('GET', f'{base}/edits/{edit}/countryAvailability/{track}', tok)
        except RuntimeError as e:
            print(f'  بلدان {track}: لا تُقرأ ({str(e)[:160]})')
            continue
        codes = [c.get('countryCode', '') for c in ca.get('countries', [])]
        print(f"  بلدان {track}: {len(codes)} {' '.join(codes[:24])}{'…' if len(codes) > 24 else ''}"
              f"{' | وسائر العالم' if ca.get('restOfWorld') else ''}"
              f"{' | كبلدان الإنتاج' if ca.get('syncWithProduction') else ''}")
    for item in pu.call('GET', f'{base}/edits/{edit}/listings', tok).get('listings', []):
        lang = item['language']
        print(f"  الصفحة {lang}: {item.get('title', '')} | فيلم {item.get('video') or 'لا شيء'}")
        short, full = item.get('shortDescription', ''), item.get('fullDescription', '')
        print(f"    الوصف القصير ({len(short)}): {short}")
        print(f"    الوصف الكامل ({len(full)}): {full[:300]}{'…' if len(full) > 300 else ''}")
        for kind in ('icon', 'featureGraphic', 'phoneScreenshots'):
            imgs = pu.call('GET', f'{base}/edits/{edit}/listings/{lang}/{kind}', tok).get('images', [])
            print(f"    {kind}: {len(imgs)} {' '.join(i.get('sha1', '')[:8] for i in imgs)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video')
    ap.add_argument('--icon')
    ap.add_argument('--feature')
    ap.add_argument('--phone', help='مجلّد لقطات الهاتف، تُرفع بترتيب أسمائها')
    ap.add_argument('--text', help='مجلّد نص الصفحة بلغة واحدة، واسمه اللغة: play/listing/ar')
    ap.add_argument('--status', action='store_true')
    ap.add_argument('--package', default=pu.PACKAGE)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    images = {}
    if a.icon:
        images['icon'] = checked('icon', [a.icon])
    if a.feature:
        images['featureGraphic'] = checked('featureGraphic', [a.feature])
    if a.phone:
        shots = sorted(str(p) for p in Path(a.phone).glob('*.png'))
        images['phoneScreenshots'] = checked('phoneScreenshots', shots)
    video = watch_url(a.video) if a.video else None
    text = listing_text(a.text) if a.text else None
    text_lang = Path(a.text).name if a.text else None
    if not (video or images or text or a.status):
        ap.error('لا شيء ليُفعل: --video أو --icon أو --feature أو --phone أو --text أو --status')

    raw = os.environ.get('PLAY_SERVICE_ACCOUNT')
    if not raw:
        sys.exit('PLAY_SERVICE_ACCOUNT غير موجود في البيئة')
    sa = json.loads(raw)
    tok = pu.token(sa)
    print('حساب الخدمة:', sa['client_email'])

    base = f'{pu.API}/{a.package}'
    up = f'{pu.UPLOAD}/{a.package}'
    edit = pu.call('POST', f'{base}/edits', tok, {})['id']
    print('تحرير', edit)
    try:
        if a.status or a.dry_run:
            status(base, edit, tok)
        if a.status and not (video or images or text):
            pu.call('DELETE', f'{base}/edits/{edit}', tok)
            print('قراءة فقط، ولم يتغيّر شيء')
            return
        listings = pu.call('GET', f'{base}/edits/{edit}/listings', tok).get('listings', [])
        if not listings:
            raise RuntimeError('لا صفحة متجر لهذا التطبيق بعد')
        if text and text_lang not in [i['language'] for i in listings]:
            raise RuntimeError(f'لا صفحة بلغة {text_lang} يُكتب فيها النص')
        for item in listings:
            lang = item['language']
            if text and lang == text_lang:
                if not a.dry_run:
                    pu.call('PATCH', f'{base}/edits/{edit}/listings/{lang}', tok, text)
                for field, words in text.items():
                    print(f'  {lang}: {field} {len(item.get(field, ""))} حرفاً، وصار {len(words)}')
            if video:
                was = item.get('video') or 'لا فيلم'
                if not a.dry_run:
                    pu.call('PATCH', f'{base}/edits/{edit}/listings/{lang}', tok, {'video': video})
                print(f'  {lang}: الفيلم كان {was}، وصار {video}')
            for kind, paths in images.items():
                if a.dry_run:
                    print(f'  {lang}: {kind} يُستبدل بـ{len(paths)}: {", ".join(Path(p).name for p in paths)}')
                    continue
                pu.call('DELETE', f'{base}/edits/{edit}/listings/{lang}/{kind}', tok)
                for p in paths:
                    pu.call('POST', f'{up}/edits/{edit}/listings/{lang}/{kind}?uploadType=media', tok,
                            raw=Path(p).read_bytes(), ctype='image/png')
                print(f'  {lang}: {kind} صار {len(paths)}: {", ".join(Path(p).name for p in paths)}')
        if a.dry_run:
            pu.call('DELETE', f'{base}/edits/{edit}', tok)
            print('قراءة فقط، ولم يتغيّر شيء')
            return
        try:
            pu.call('POST', f'{base}/edits/{edit}:commit', tok, {})
            print('اعتُمد التحرير، والصفحة تتغيّر بعد مراجعة Play')
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
