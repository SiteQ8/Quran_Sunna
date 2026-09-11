#!/bin/sh
# Compiles the wrapper's classes against the real android platform without the
# full sdk, so a wrong signature is caught before a build on a phone. Needs a
# jdk, and downloads the platform jar once into /tmp.
set -e
SDK=/tmp/sunnati-sdk
mkdir -p "$SDK"
[ -f "$SDK/android-36/android.jar" ] || {
  curl -sS -L -o "$SDK/platform.zip" "https://dl.google.com/android/repository/platform-36_r02.zip"
  (cd "$SDK" && unzip -q -o platform.zip '*/android.jar')
}
mkdir -p "$SDK/gen/com/eworldq8/sunnati" "$SDK/out"
cat > "$SDK/gen/com/eworldq8/sunnati/R.java" <<'R'
package com.eworldq8.sunnati;
public final class R {
  public static final class raw { public static final int ojeiri = 1; }
  public static final class drawable { public static final int ic_notification = 2; }
}
R
cat > "$SDK/gen/com/eworldq8/sunnati/BuildConfig.java" <<'B'
package com.eworldq8.sunnati;
public final class BuildConfig { public static final String VERSION_NAME = "check"; }
B
HERE=$(cd "$(dirname "$0")/../.." && pwd)

# This used to end in `| grep ... || true` and then an unconditional echo, so it
# said the wrapper compiled whether it did or not, and said it once when javac
# was not even installed. What javac says is now kept, shown, and obeyed.
command -v javac >/dev/null 2>&1 || {
  echo "no javac on the path: a jre is not enough, install a jdk" >&2
  exit 1
}

javac -Xlint:all -Werror -d "$SDK/out" --release 17 \
  -cp "$SDK/android-36/android.jar" \
  "$SDK/gen/com/eworldq8/sunnati/R.java" "$SDK/gen/com/eworldq8/sunnati/BuildConfig.java" \
  "$HERE"/android/app/src/main/java/com/eworldq8/sunnati/*.java >"$SDK/javac.log" 2>&1
STATUS=$?

grep -v "^warning: \[options\]" "$SDK/javac.log" || true

if [ "$STATUS" -ne 0 ]; then
  echo "the wrapper does NOT compile" >&2
  exit 1
fi
echo "wrapper classes compile"
