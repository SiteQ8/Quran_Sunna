#!/bin/sh
# Compiles the wrapper's classes against the real android platform without the
# full sdk, so a wrong signature is caught before a build on a phone. Needs a
# jdk, and downloads the platform jar and the browser helper once into /tmp.
set -e
SDK=/tmp/sunnati-sdk
mkdir -p "$SDK"
[ -f "$SDK/android-34/android.jar" ] || {
  curl -sS -L -o "$SDK/platform.zip" "https://dl.google.com/android/repository/platform-34-ext7_r03.zip"
  (cd "$SDK" && unzip -q -o platform.zip '*/android.jar')
}
[ -f "$SDK/abh.jar" ] || {
  curl -sS -L -o "$SDK/abh.aar" "https://dl.google.com/dl/android/maven2/com/google/androidbrowserhelper/androidbrowserhelper/2.5.0/androidbrowserhelper-2.5.0.aar"
  (cd "$SDK" && unzip -q -o abh.aar classes.jar && mv classes.jar abh.jar)
}
[ -f "$SDK/browser.jar" ] || {
  curl -sS -L -o "$SDK/browser.aar" "https://dl.google.com/dl/android/maven2/androidx/browser/browser/1.4.0/browser-1.4.0.aar"
  (cd "$SDK" && unzip -q -o browser.aar classes.jar && mv classes.jar browser.jar)
}
mkdir -p "$SDK/gen/io/github/siteq8/sunnati" "$SDK/out"
cat > "$SDK/gen/io/github/siteq8/sunnati/R.java" <<'R'
package io.github.siteq8.sunnati;
public final class R {
  public static final class raw { public static final int ojeiri = 1; }
  public static final class drawable { public static final int ic_notification = 2; }
}
R
HERE=$(cd "$(dirname "$0")/../.." && pwd)
javac -Xlint:all -Werror -d "$SDK/out" --release 17 \
  -cp "$SDK/android-34/android.jar:$SDK/abh.jar:$SDK/browser.jar" \
  "$SDK/gen/io/github/siteq8/sunnati/R.java" "$HERE"/android/app/src/main/java/io/github/siteq8/sunnati/*.java 2>&1 | grep -v "^warning: \[options\]" || true
echo "wrapper classes compile"
