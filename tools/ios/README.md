# أدوات iOS

## `set-secrets.py`

يضع أسرار التوقيع والرفع في المستودع مشفّرةً كما تطلبها واجهة GitHub، فلا
تُنسخ ثمانية أسرار يدوياً في المتصفّح. يقرأ الملفّات ويشفّرها ويرسلها ولا
يكتبها في مكان.

```
pip install pynacl
GITHUB_TOKEN=... python3 tools/ios/set-secrets.py \
    --team-id XXXXXXXXXX \
    --cer distribution.cer --key sunnati.key --p12-password '...' \
    --profile Sunnati.mobileprovision \
    --profile-widget SunnatiWidget.mobileprovision \
    --asc-key-id XXXXXXXXXX --asc-issuer-id '....' --asc-p8 AuthKey_XXXXXXXXXX.p8
```

ولأندرويد، مفتاح الرفع الذي يعرفه Play:

```
GITHUB_TOKEN=... python3 tools/ios/set-secrets.py \
    --keystore sunnati-upload.keystore --keystore-password '...' \
    --key-alias sunnati --key-password '...'
```

يُعطى ما هو في اليد، ويقول في آخره ما بقي ناقصاً لكلّ منصّة. وإن أُعطي
`--cer` و`--key` صنع الـ`p12` بنفسه فلا يلزم `openssl` على حدة.

## `hinge.c`

يفتح محاكي iPhone Duo ويطويه من سطر الأوامر، لأن Xcode 27.1 لا يفعل ذلك
إلا من شريط في Device Hub ولا شيء في `simctl` يقوم مقامه، فالبناء على GitHub
كان سيصوّر شاشة واحدة ولا يرى الأخرى. يُبنى للمحاكي ويُشغَّل داخله:

```
xcrun -sdk iphonesimulator clang -arch arm64 -mios-simulator-version-min=17.0 -O2 \
    -o hinge tools/ios/hinge.c -framework IOKit -framework CoreFoundation
codesign -f -s - hinge
xcrun simctl spawn <UDID> ./hinge 180    # مفتوح
xcrun simctl spawn <UDID> ./hinge 0      # مطويّ
```

وهو لسير العمل وحده ولا يدخل التطبيق، لأن ما يناديه خاصّ بنظام iOS. والحدث
الذي يرسله وجده Artem Novichkov في أداته
[hinge](https://github.com/artemnovichkov/hinge) بترخيص MIT، والملف منقول
عنها مختصراً ومعه نصّ الترخيص.

## `pick-xcode.py`

يقرّر أيّ Xcode يبني به سير عمل iOS وعلى أيّ جهاز من أجهزة GitHub. الخيار
auto هو أحدث Xcode من 27.1 فما بعده يحمله GitHub إصداراً أو نسخة مرشّحة، لأنه
أول ما يبني لـiPhone Duo، و26 حتى يصل. ويقرأ ما على جهاز xcode-27 من الصفحة
التي ينشرها GitHub معه، ولا يثق بالاسم، فـXcode_27.1.app كان رابطاً إلى نسخة
تجريبية. وإن لم يقرأ شيئاً بقي على 26.

```
python3 tools/ios/pick-xcode.py auto          # سطران: الإصدار ثم الجهاز
python3 tools/ios/pick-xcode.py --release-only # 27.1 أو لا شيء
```

## `asc-release.py`

يأخذ بناءً وصل إلى App Store Connect إلى المتجر: يصنع الإصدار أو يجد المفتوح
منه، ويربط البناء، ويكتب ما الجديد من `ios/whatsnew/ar-SA.txt`، وينقل لقطات
٦٫٩ بوصة من الإصدار المعروض إن جاء الجديد بلاها، ويضع لقطات iPhone Duo في
مجموعتها APP_IPHONE_DUO، ثم يرسله للمراجعة. ولا يعمل إلا حين يُطلب بيد،
بتشغيل iOS و store على prepare أو send. وبـ`--dry-run` يقرأ كل شيء ولا يغيّر
شيئاً.

ويضع معه أفلام المعاينة من `ios/previews`، فلكل جهاز مجلّد، و`iphone-67` لهاتف
٦٫٩ بوصة بمقاس ٨٨٦ في ١٩٢٠، وبجانب كل فيلم ملف `.poster` فيه اللحظة التي
يعرضها المتجر صورةً قبل أن يبدأ الفيلم، أي `00:00:18:24` بالساعات والدقائق
والثواني والإطارات، والفيلم الموجود بالبايتات نفسها يُترك، والذي تغيّر يحلّ
محلّ مجموعته.

```
python3 tools/ios/asc-release.py --previews-only --version 8.87.63 --previews ios/previews
```

وبـ`--previews-only` يضع الأفلام وحدها في الإصدار المُعَدّ، أو في إصدار جديد إن
لم يكن، وينقل إليه لقطات الهاتف فلا يبقى فارغاً، ولا يبني شيئاً ولا يرسل شيئاً،
فتذهب الأفلام إلى المتجر مع أول إصدار يُرسل بعدها، وهذا ما يفعله سير العمل
«App Store previews» حين يُشغَّل بيد من صفحة Actions.

## أفلام المعاينة

`tools/store/sky-preview.mjs` يصوّر الفيلم من التطبيق نفسه إطاراً إطاراً، أي
يوماً كاملاً من «سماء الوقت» في ثمانٍ وعشرين ثانية، فيمسك ساعة التطبيق ويحرّكها
بيده، فكل إطار هو ما يرسمه التطبيق في تلك الدقيقة بعينها، ثم يجمعه ffmpeg بما
يطلبه App Store Connect من الترميز والصوت.

```
python3 -m http.server 8765 --directory docs &
node tools/store/sky-preview.mjs portrait     # ios/previews/iphone-67/sky-day.mp4
node tools/store/sky-preview.mjs landscape    # 1920 في 1080 لـYouTube، ومنه يأخذ Google Play فيلمه
```

