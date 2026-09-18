# نظام تحديث الإصدار التلقائي

## المشكلة

في السابق، عند إضافة تحديث جديد، كان يجب تحديث `VERSION` في `docs/sw.js` يدوياً حتى يكتشف المستخدم التحديث ويرى البanner "حدّث الآن".

## الحل

نظام آلي يحدّث الإصدار تلقائياً مع كل commit باستخدام Git Hook.

## كيف يعمل

### 1. عند الـ commit

```bash
git commit -m "تعديل النص والإشعارات"
```

### 2. Git Hook يعمل تلقائياً

- يستخرج الإصدار الحالي من `docs/sw.js`
- يزيد رقم `patch` بمقدار 1
- مثلاً: `v8.87.5` → `v8.87.6`
- يحدّث الملف تلقائياً
- يضيفه للـ staging

### 3. المستخدم يرى التحديث

- Service Worker يكتشف تغيير `VERSION`
- سيظهر البanner: **"حدّث الآن"**
- بدون ما يضطر المستخدم يمسح الـ cache

## التثبيت

### لأول مرة (بعد الـ clone)

```bash
cp tools/git/update-version-hook.sh .git/hooks/prepare-commit-msg
chmod +x .git/hooks/prepare-commit-msg
```

### للمجموعة

أضف هذا في `package.json` أو `Makefile`:

```bash
# في setup script
ln -sf ../../tools/git/update-version-hook.sh .git/hooks/prepare-commit-msg
chmod +x .git/hooks/prepare-commit-msg
```

## مثال

```bash
# تعديل أي ملف
echo "تحديث جديد" >> docs/js/app.js

# الـ commit
git commit -m "إضافة ميزة جديدة"

# Git Hook سيحدّث VERSION تلقائياً
# v8.87.5 → v8.87.6
# ويضيفه للـ commit الحالي
```

## الملفات

- `update-version-hook.sh` — الـ hook script
- `.git/hooks/prepare-commit-msg` — الـ hook المثبّت (يتم نسخه هنا)
- `docs/sw.js` — يحتوي على `VERSION` (يُحدّث تلقائياً)

## ملاحظات

- الـ hook يعمل فقط إذا كان هناك `docs/sw.js`
- لا يؤثر على الـ commits إذا كان الملف غير موجود
- يمكن تعطيله بـ `--no-verify` إذا لزم الأمر:

```bash
git commit --no-verify -m "تجاهل الـ hook"
```

## النتيجة

✅ كل تحديث = تحديث تلقائي للمستخدم  
✅ بدون نسيان تحديث الإصدار يدوياً  
✅ المستخدم يرى "حدّث الآن" فوراً  
✅ Service Worker يعمل كما يجب
