# سُنّتي على iOS

الغلاف يفتح `sunnati.3li.info` ويضيف ما لا تقدر عليه صفحة: إشعارات تصل
والتطبيق مغلق، ولكلٍّ صوتها الذي اختاره القارئ، والأذان في وقته لمكانه.

**البناء كلّه على GitHub، لا يلزمك ماك.** الملفّ `.github/workflows/ios.yml`
يبني على ماك تملكه GitHub، ويوقّع، ويُخرج `ipa`.

## ما يلزم مرّة واحدة

**حساب Apple Developer، ٩٩ دولاراً سنوياً.** لا سبيل إلى النشر بدونه، ولا إلى
تثبيت التطبيق على جهازك أكثر من أسبوع.

## الأسرار الأربعة

تُوضع في المستودع: Settings ← Secrets and variables ← Actions.

| السرّ | ما هو |
| --- | --- |
| `IOS_TEAM_ID` | عشرة أحرف، تجدها في developer.apple.com ← Membership |
| `IOS_CERT_P12` | شهادة التوزيع، بصيغة base64 |
| `IOS_CERT_PASSWORD` | كلمة السرّ التي أعطيتها للشهادة |
| `IOS_PROFILE` | ملفّ التخويل، بصيغة base64 |

### الشهادة، بلا ماك

أبل تطلب طلب توقيع (CSR)، وتصنعه على أيّ نظام:

```
openssl req -new -newkey rsa:2048 -nodes \
  -keyout sunnati.key -out sunnati.csr \
  -subj "/emailAddress=YOUR_EMAIL/CN=Ali AlAnezi/C=KW"
```

ثم في developer.apple.com ← Certificates ← `+` ← **Apple Distribution**،
ارفع `sunnati.csr`، ونزّل `distribution.cer`.

واجمع المفتاح والشهادة في ملفّ `.p12`:

```
openssl x509 -in distribution.cer -inform DER -out cert.pem -outform PEM
openssl pkcs12 -export -inkey sunnati.key -in cert.pem -out sunnati.p12
```

سيسألك عن كلمة سرّ، وهي `IOS_CERT_PASSWORD`. ثم:

```
base64 -w0 sunnati.p12          # هذا IOS_CERT_P12
```

### ملفّ التخويل

في developer.apple.com:

1. **Identifiers** ← `+` ← App IDs ← معرّف التطبيق `com.eworldq8.sunnati`،
   وفعّل **Push Notifications** إن أردتها لاحقاً
2. **Profiles** ← `+` ← **App Store Connect** ← اختر المعرّف والشهادة
3. نزّل الملفّ، ثم `base64 -w0 Sunnati.mobileprovision` وهو `IOS_PROFILE`

## التشغيل

بلا أسرار يبني ويختبر فقط، وهذا نافع بذاته: يمسك انكسار البناء قبل أن تقترب
من شهادة. ومع الأسرار يوقّع ويُخرج `ipa` تجده في Artifacts.

للبناء: ادفع وسماً `ios-v8.85.0`، أو اضغط **Run workflow** في تبويب Actions.

## قبل أن ترفع إلى App Store

**أبل ترفض الغلاف الذي يفتح موقعاً وحسب**، بالبند 4.2. وما يجعل هذا التطبيق
مقبولاً هو ما يضيفه الغلاف فعلاً:

- إشعارات مجدولة محلّياً تصل والتطبيق مغلق
- ثلاثة أصوات لكلّ تذكير: صوت الجهاز، نغمة هادئة، صامت
- الأذان بصوت مؤذّن في وقته لمكان القارئ
- الصوت يبقى مع إغلاق الشاشة

وإن رُفض، فالردّ عليهم يكون بهذه القائمة لا بالجدل.

## ما لم يُنجز بعد

- **أيقونة التطبيق**: يلزم `AppIcon.appiconset`، ولم تُصنع بعد
- **الودجت**: ودجت أوقات الصلاة تُقوّي القبول كثيراً
- **لم يُجرَّب على جهاز قطّ**: هذه الشيفرة مكتوبة ولم تُبنَ على ماك بعد، وأوّل
  تشغيل سيُظهر أخطاء بناء على الأرجح. هذا متوقَّع، والغرض أن يكون الهيكل جاهزاً
