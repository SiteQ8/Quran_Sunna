# لقطات شاشة iPhone للمتجر

## إنشاء لقطات مصنعة بإطار iPhone

يُنتج التطبيق ست لقطات شاشة مصنعة بإطار iPhone 15 Pro الحقيقي، بمقاس ١٢٤٢ في ٢٦٨٨ بكسل، وهو المقاس الذي يقبله App Store Connect.

### المتطلبات

```bash
pip install pillow --break-system-packages
# و playwright مثبت مسبقاً
```

### الخطوات

1. شغّل الموقع محلياً على 8840:
```bash
cd Quran_Sunna
python3 -m http.server 8840 --directory docs
```

2. شغّل أداة اللقطات:
```bash
python3 tools/store/iphone-screenshots.py
```

3. ستُنشأ اللقطات في `docs/screens/iphone/`:
   - `home-iphone.png` — الشاشة الرئيسية
   - `prayers-iphone.png` — صلاتي
   - `page-iphone.png` — صفحة المصحف
   - `hisn-iphone.png` — حصن المسلم
   - `dua-iphone.png` — الأدعية
   - `umrah-iphone.png` — صفة العمرة

### المقاسات

اللقطات بمقاس **١٢٤٢ × ٢٦٨٨** بكسل، الحد الأدنى المقبول من App Store:

| الشاشة | النسبة | الحد الأدنى | ملاحظة |
| --- | --- | --- | --- |
| iPhone | 19.5:9 | 1242 × 2688 | أفقي فقط |
| iPad | 4:3 | 1536 × 2048 | اختياري |
| iPad Pro | 11-inch | 1668 × 2388 | اختياري |

### رفع إلى App Store Connect

1. سجّل دخول إلى [App Store Connect](https://appstoreconnect.apple.com/)
2. اختر تطبيق سُنّتي (com.eworldq8.sunnati)
3. اذهب إلى الإصدار المتاح
4. اذهب إلى *Screenshots*
5. حدّد *iPhone (6.7 inch)* أو *iPhone (6.1 inch)*
6. رفع اللقطات الست بترتيب معين
7. أضف نص وصفي قصير (اختياري) أسفل كل لقطة
8. احفظ

### ترتيب لقطات التسويق (مقترح)

1. **home-iphone.png** — *الشاشة الرئيسية مع أوقات الصلاة*
2. **page-iphone.png** — *المصحف، ستة آلاف آية محفوظة في جهازك*
3. **hisn-iphone.png** — *حصن المسلم، أذكار يومية بعدادات*
4. **prayers-iphone.png** — *صلاتي، تتبع صلواتك*
5. **dua-iphone.png** — *الأدعية والآيات، ثلاثون موضوعاً*
6. **umrah-iphone.png** — *صفة العمرة، خطوة خطوة*

### ملاحظات

- كل لقطة تحتوي على إطار iPhone حقيقي بجميع التفاصيل (الكاميرا، الكتوف، إلخ)
- الخط العربي هو خط التطبيق الأساسي
- الألوان تتطابق مع النمط المعتمد (السدو الكويتي الأحمر)
- التطبيق مُهيأ للعرض بلا شبكة
- كل لقطة توضح ميزة رئيسية مختلفة

### تعديل اللقطات

لتعديل اللقطات (سحب دعائم مختلفة، شاشات جديدة):

1. عدّل `tools/store/iphone-screenshots.py`
2. غيّر قائمة `SHOTS` بإضافة شاشات جديدة
3. أضف الكود اللازم لفتح الشاشة المطلوبة
4. أعد تشغيل الأداة

مثال لإضافة شاشة جديدة:
```python
SHOTS = [
    # ...
    ('calendar', 'App.go("calendar")'),
]
```

### الملفات المرتبطة

- `tools/store/screens.mjs` — أداة لقطات Android (١٠٨٠ × ١٩٢٠)
- `tools/store/iphone-screenshots.py` — أداة لقطات iPhone (١٢٤٢ × ٢٦٨٨)
- `APPSTORE.md` — الوثائق الأخرى للنشر على App Store
