#!/bin/sh
# Puts the android toolchain on a bare machine: a jdk with a compiler, the sdk
# the app compiles against, and a gradle that matches the plugin. Written after
# an afternoon of finding out, one missing piece at a time, what a build needs.
#
#   sh tools/android/setup-sdk.sh
#
# Then: cd android && gradle --no-daemon bundleRelease assembleRelease
set -e

SDK=${ANDROID_HOME:-/opt/android-sdk}
GRADLE_VERSION=8.9          # com.android.application 8.5.2 asks for 8.7 or more
COMPILE_SDK=36              # keep beside compileSdk in android/app/build.gradle
BUILD_TOOLS=36.0.0
CMDLINE=commandlinetools-linux-11076708_latest.zip

say() { echo "· $*"; }

# 1 · a jdk, not a jre: the runtime alone has no javac and the compile gate dies
if ! command -v javac >/dev/null 2>&1; then
  say "installing a jdk"
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-21-jdk-headless unzip zip
  else
    echo "install a jdk 21 by hand, then run this again" >&2
    exit 1
  fi
fi
say "javac $(javac -version 2>&1 | cut -d' ' -f2)"

# 2 · the sdk
if [ ! -d "$SDK/cmdline-tools/latest" ]; then
  say "fetching the command line tools"
  mkdir -p "$SDK/cmdline-tools"
  TMP=$(mktemp -d)
  curl -sS -L -o "$TMP/tools.zip" "https://dl.google.com/android/repository/$CMDLINE"
  unzip -q -o "$TMP/tools.zip" -d "$TMP"
  mv "$TMP/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$TMP"
fi

export ANDROID_HOME="$SDK"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
say "accepting the licences"
yes 2>/dev/null | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
say "installing platform $COMPILE_SDK and build tools $BUILD_TOOLS"
"$SDKMANAGER" --install "platform-tools" "platforms;android-$COMPILE_SDK" "build-tools;$BUILD_TOOLS" >/dev/null

# 3 · gradle
if ! command -v gradle >/dev/null 2>&1; then
  say "installing gradle $GRADLE_VERSION"
  TMP=$(mktemp -d)
  curl -sS -L -o "$TMP/gradle.zip" "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
  unzip -q -o "$TMP/gradle.zip" -d /opt
  ln -sf "/opt/gradle-$GRADLE_VERSION/bin/gradle" /usr/local/bin/gradle
  rm -rf "$TMP"
fi
say "gradle $(gradle -v 2>/dev/null | grep '^Gradle' | cut -d' ' -f2)"

cat <<NOTE

ready. the release build still needs a keystore, which is not in this repository
and is not meant to be:

  android/keystore.properties   storeFile, storePassword, keyAlias, keyPassword

without it everything compiles and packaging alone stops.
NOTE
