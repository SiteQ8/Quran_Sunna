#!/bin/sh
# Git hook: تحديث VERSION تلقائياً مع كل commit
# 
# التثبيت:
#   cp tools/git/update-version-hook.sh .git/hooks/prepare-commit-msg
#   chmod +x .git/hooks/prepare-commit-msg
#
# الهدف:
#   - تحديث الإصدار تلقائياً في docs/sw.js
#   - إجبار Service Worker على تحديث الـ cache
#   - عرض البanner "حدّث الآن" للمستخدم تلقائياً
#   - بدون ما نضطر نتذكر تحديث الإصدار يدوياً

if [ ! -f "docs/sw.js" ]; then
  exit 0
fi

# استخرج الرقم الحالي من VERSION
current_version=$(grep "var VERSION = " docs/sw.js | sed "s/.*v\([0-9.]*\).*/\1/")

if [ -z "$current_version" ]; then
  exit 0
fi

# قسّم الإصدار إلى major.minor.patch
major=$(echo "$current_version" | cut -d. -f1)
minor=$(echo "$current_version" | cut -d. -f2)
patch=$(echo "$current_version" | cut -d. -f3)

# زيادة patch number
new_patch=$((patch + 1))
new_version="$major.$minor.$new_patch"

# حدّث VERSION في sw.js
sed "s/var VERSION = 'sunnati-v[0-9.]*';/var VERSION = 'sunnati-v$new_version';/" docs/sw.js > docs/sw.js.tmp
mv docs/sw.js.tmp docs/sw.js

# أضف sw.js للـ staging إذا كان هناك تغيير
git add docs/sw.js 2>/dev/null

exit 0
