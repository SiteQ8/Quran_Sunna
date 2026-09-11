#!/bin/sh
# Android Lint over the release variant. It catches what javac cannot: a call
# into an api newer than minSdk compiles perfectly and then throws on the phone,
# and seventeen such calls sat in MainActivity until this gate was written.
#
# Needs the full sdk and gradle. If they are not here, run tools/android/setup-sdk.sh.
# It does not skip quietly: a gate that passes when it did not run is no gate.
set -e

HERE=$(cd "$(dirname "$0")/../.." && pwd)
ANDROID_HOME=${ANDROID_HOME:-/opt/android-sdk}
JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}
export ANDROID_HOME JAVA_HOME

[ -d "$ANDROID_HOME/platforms" ] || {
  echo "no android sdk at $ANDROID_HOME: run tools/android/setup-sdk.sh" >&2
  exit 1
}

if [ -x "$HERE/android/gradlew" ]; then
  GRADLE="$HERE/android/gradlew"
elif command -v gradle >/dev/null 2>&1; then
  GRADLE=gradle
else
  echo "no gradle: run tools/android/setup-sdk.sh" >&2
  exit 1
fi

# Reports from an earlier run are cleared first, or a stale one is read and
# believed. This gate was itself written wrong that way once.
find "$HERE/android/app/build" -name 'lint-results-release.*' -delete 2>/dev/null || true

cd "$HERE/android"
STATUS=0
"$GRADLE" --no-daemon :app:lintRelease >/tmp/sunnati-lint.log 2>&1 || STATUS=$?

REPORT=$(find "$HERE/android/app/build" -path '*lintReportRelease*' -name 'lint-results-release.txt' 2>/dev/null | head -1)
if [ -n "$REPORT" ]; then
  grep "Error:" "$REPORT" || true
  tail -5 "$REPORT" | grep -o '[0-9]* errors\?, [0-9]* warnings\?' | head -1
fi

if [ "$STATUS" -ne 0 ]; then
  echo "lint found errors; the log is at /tmp/sunnati-lint.log" >&2
  exit 1
fi
echo "lint clean of errors"
