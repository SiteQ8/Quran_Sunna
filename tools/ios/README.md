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
