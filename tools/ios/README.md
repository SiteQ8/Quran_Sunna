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
