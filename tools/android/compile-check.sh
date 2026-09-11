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
HERE=$(cd "$(dirname "$0")/../.." && pwd)
RES="$HERE/android/app/src/main/res"

# R was a hand-written stub naming two resources, so the gate went red the first
# time the wrapper referred to a third. It is read off the resources themselves
# now, and cannot fall behind them.
names_from_files() {   # $1 = res kind, e.g. drawable
  find "$RES" -maxdepth 1 -type d \( -name "$1" -o -name "$1-*" \) 2>/dev/null |
    while read -r d; do ls "$d" 2>/dev/null; done |
    sed 's/\.[^.]*$//;s/[.-]/_/g' | sort -u
}
names_from_values() {  # $1 = tag, e.g. string
  # aapt turns a dot in a name into an underscore, since Theme.App is not a
  # java identifier. Doing otherwise makes the generated R refuse to compile.
  grep -ho "<$1 name=\"[^\"]*\"" "$RES"/values*/*.xml 2>/dev/null |
    sed "s/.*name=\"//;s/\"//;s/[.-]/_/g" | sort -u
}
{
  echo 'package com.eworldq8.sunnati;'
  echo 'public final class R {'
  ID=1
  for KIND in drawable raw mipmap xml layout anim; do
    echo "  public static final class $KIND {"
    for N in $(names_from_files "$KIND"); do
      echo "    public static final int $N = $ID;"
      ID=$((ID + 1))
    done
    echo '  }'
  done
  for TAG in string color style dimen integer bool array; do
    echo "  public static final class $TAG {"
    for N in $(names_from_values "$TAG"); do
      echo "    public static final int $N = $ID;"
      ID=$((ID + 1))
    done
    echo '  }'
  done
  echo '}'
} > "$SDK/gen/com/eworldq8/sunnati/R.java"
cat > "$SDK/gen/com/eworldq8/sunnati/BuildConfig.java" <<'B'
package com.eworldq8.sunnati;
public final class BuildConfig { public static final String VERSION_NAME = "check"; }
B
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
