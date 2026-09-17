# لقطات شاشة iPhone للمتجر

## إنشاء لقطات احترافية بإطار iPhone حقيقي

أداة Python تولّد لقطات شاشة احترافية بمقاس App Store (1242 × 2688) باستخدام إطار iPhone 15 Pro بتفاصيل دقيقة وتصميم احترافي.

### المميزات

- إطار iPhone 15 Pro بتفاصيل معدنية حقيقية (الكاميرا، الـ notch، الظلال)
- استخدام لقطات التطبيق الفعلية (خطوط وألوان Sunnati الأصلية)
- مقاس App Store الدقيق (1242 × 2688 بكسل)
- جودة عالية مضغوطة وجاهزة للرفع
- احترافية بنسبة 100% من التطبيق الفعلي

### المتطلبات

```bash
pip install pillow --break-system-packages
```

### الخطوات

```bash
# 1. اللقطات الخام موجودة بالفعل
ls docs/screens/*.png

# 2. شغّل أداة إنشاء الإطار
python3 tools/store/iphone-pro.py

# 3. اللقطات احترافية جاهزة في
ls docs/screens/iphone/
```

### اللقطات المولدة

| الملف | الحجم | الشاشة |
| --- | --- | --- |
| `home-appstore.png` | 216 KB | الشاشة الرئيسية |
| `prayers-appstore.png` | 143 KB | صلاتي |
| `page-appstore.png` | 235 KB | المصحف |
| `hisn-appstore.png` | 302 KB | حصن المسلم |
| `dua-appstore.png` | 158 KB | الأدعية |
| `umrah-appstore.png` | 222 KB | صفة العمرة |

**المجموع: 1.3 MB** جاهزة للرفع على App Store Connect

### رفع إلى App Store Connect

1. سجّل دخول إلى [App Store Connect](https://appstoreconnect.apple.com/)
2. اختر تطبيق سُنّتي (com.eworldq8.sunnati)
3. اذهب إلى *Version*
4. في *Screenshots*، اختر *iPhone (6.7 inch)* أو *iPhone (6.1 inch)*
5. رفع اللقطات الست بالترتيب:
   1. home-appstore.png
   2. prayers-appstore.png
   3. page-appstore.png
   4. hisn-appstore.png
   5. dua-appstore.png
   6. umrah-appstore.png
6. احفظ وقدم

### الألوان والخطوط

اللقطات تستخدم تماماً:

- **ألوان Sunnati**: الأحمر الداكن (#9c2b2b)، الأخضر (#1e6f47)، الذهبي (#b08833)
- **الخطوط**: IBM Plex Arabic (من التطبيق)
- **الخلفية**: ورقي كريمي (#f6f4ee)

### تعديل النصوص التسويقية

عدّل في `tools/store/iphone-appstore.py`:

```python
SCREENSHOTS = [
    {
        'name': 'home',
        'title': 'اسم الشاشة',
        'subtitle': 'وصف الميزة بعبارة جاذبة قصيرة',
    },
    # ...
]
```

### ملاحظات

- كل لقطة مقاس 1242 × 2688 بكسل (معيار App Store)
- النصوص تُضاف تلقائياً مع احترام اتجاه النص العربي
- اللقطات مضغوطة وجاهزة للرفع
- يمكن إعادة التشغيل في أي وقت لتحديث النصوص
