#!/bin/sh
# خطّاف git: يرفع رقم النسخة تلقائياً مع كل commit
#
# التثبيت:
#   cp tools/git/update-version-hook.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# pre-commit لا prepare-commit-msg: الثاني يعمل بعد أن يأخذ git لقطة الملفّات،
# فكان الرقم المرفوع يبقى مرحَّلاً ويدخل الإيداع الذي بعده، وأول إيداع في نسخة
# جديدة يخرج بالرقم الذي قبله فلا تتجدّد النسخ المثبّتة. والأول يعمل قبل اللقطة.
#
# الهدف:
#   - رفع رقم النسخة في المواضع الأربعة معاً، فالمستودع يشترط تطابقها
#     docs/js/app.js و docs/sw.js و android/app/build.gradle و ios/project.yml
#   - وشارة الإصدار في README.md معها، فقد بقيت على 5.1.0 والتطبيق على 8.87
#   - إجبار Service Worker على تجديد الـ cache، فيصل المستخدم بانر «حدّث الآن»
#   - رفع versionCode ورقم بناء iOS معاً، فلا يُرفض بناء المتجر
#
# رفع sw.js وحده يكسر اختبارات النسخة في test/interface.test.js، لذلك تُحدَّث
# الثلاثة في عملية واحدة أو لا يُحدَّث شيء.

APP="docs/js/app.js"
SW="docs/sw.js"
GRADLE="android/app/build.gradle"
IOS="ios/project.yml"
README="README.md"

for f in "$APP" "$SW" "$GRADLE" "$IOS"; do
  [ -f "$f" ] || exit 0
done

current=$(grep -m1 "var VERSION = " "$APP" | sed "s/.*'\([0-9.]*\)'.*/\1/")
[ -z "$current" ] && exit 0

major=$(echo "$current" | cut -d. -f1)
minor=$(echo "$current" | cut -d. -f2)
patch=$(echo "$current" | cut -d. -f3)
new="$major.$minor.$((patch + 1))"

code=$(grep -m1 "versionCode " "$GRADLE" | sed "s/[^0-9]*\([0-9]*\).*/\1/")
[ -z "$code" ] && exit 0
new_code=$((code + 1))

sed -i "s/var VERSION = '[0-9.]*';/var VERSION = '$new';/" "$APP"
sed -i "s/var VERSION = 'sunnati-v[0-9.]*';/var VERSION = 'sunnati-v$new';/" "$SW"
sed -i "s/versionName \"[0-9.]*\"/versionName \"$new\"/" "$GRADLE"
sed -i "s/versionCode [0-9]*/versionCode $new_code/" "$GRADLE"
sed -i "s/MARKETING_VERSION: \"[0-9.]*\"/MARKETING_VERSION: \"$new\"/" "$IOS"
sed -i "s/CURRENT_PROJECT_VERSION: \"[0-9]*\"/CURRENT_PROJECT_VERSION: \"$new_code\"/" "$IOS"
# الشارة إن وُجدت، ولا يتوقّف الخطّاف على وجودها
[ -f "$README" ] && sed -i "s/الإصدار-[0-9.]*-1e6f47/الإصدار-$new-1e6f47/" "$README"

git add "$APP" "$SW" "$GRADLE" "$IOS" "$README" 2>/dev/null

exit 0
