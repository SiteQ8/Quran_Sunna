# لقطات شاشة iPhone للمتجر

## إنشاء لقطات احترافية مع نصوص تسويقية

أداة Python متقدمة تولّد لقطات شاشة احترافية بمقاس App Store (1242 × 2688) مع إطار iPhone حقيقي ونصوص تسويقية عربية في الأسفل.

### المميزات

- إطار iPhone 15 Pro احترافي بتفاصيل دقيقة
- نصوص تسويقية عربية محترفة تحت كل لقطة
- ألوان وخطوط Sunnati الفعلية (السدو الأحمر والأخضر والذهبي)
- جودة App Store العالية
- قابلة للتخصيص والتعديل

### المتطلبات

```bash
pip install pillow --break-system-packages
```

### الخطوات

```bash
# 1. شغّل الموقع محلياً
python3 -m http.server 8840 --directory docs

# 2. شغّل أداة اللقطات
python3 tools/store/iphone-appstore.py

# 3. اللقطات جاهزة في
ls docs/screens/iphone/
```

### اللقطات المولدة

| الملف | الحجم | الوصف |
| --- | --- | --- |
| `home-appstore.png` | 232K | الشاشة الرئيسية مع أوقات الصلاة |
| `prayers-appstore.png` | 154K | صلاتي والتتبع |
| `page-appstore.png` | 247K | صفحة المصحف |
| `hisn-appstore.png` | 311K | حصن المسلم والأذكار |
| `dua-appstore.png` | 172K | الأدعية والآيات |
| `umrah-appstore.png` | 237K | صفة العمرة |

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
