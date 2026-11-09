#!/usr/bin/env bash
#
# 补齐安卓构建需要、但**不进 git** 的东西。
#
#   1. debug 签名证书   app/android/app/debug.keystore      （*.keystore 被忽略）
#   2. proot 二进制     app/android/app/src/main/jniLibs/…  （*.so 被忽略）
#   3. 运行时镜像       app/android/app/src/main/assets/rootfs.bin / payload.bin
#   4. Python/Office 层 app/android/app/src/main/assets/python.bin（约 36.8MB）
#
# 已经存在的会跳过（镜像按 sha256 校验）；可以反复跑。
#
# 用法（仓库根目录）：
#   bash scripts/setup-android.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app/android/app"
ASSETS="$APP/src/main/assets"
JNI="$APP/src/main/jniLibs/arm64-v8a"
KEYS="$APP/debug.keystore"

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_HOME

# JDK：优先 Android Studio 自带的（17/21 都行），其次系统 java
if [ -z "${JAVA_HOME:-}" ]; then
  for cand in "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
              "$HOME/Library/Java/JavaVirtualMachines"/*/Contents/Home; do
    if [ -x "$cand/bin/keytool" ]; then export JAVA_HOME="$cand"; break; fi
  done
fi

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 1. 签名

say "1/3 debug 签名证书"
if [ -f "$KEYS" ]; then
  echo "  已存在：$KEYS"
else
  command -v "${JAVA_HOME:+$JAVA_HOME/bin/}keytool" >/dev/null 2>&1 || {
    echo "  找不到 keytool：装 JDK 17+，或设置 JAVA_HOME 指向 Android Studio 的 jbr"; exit 1; }
  "${JAVA_HOME:+$JAVA_HOME/bin/}keytool" -genkeypair -v -storetype JKS \
    -keystore "$KEYS" -storepass android -alias androiddebugkey -keypass android \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
  echo "  已生成（Android 标准的 debug 证书，密码都是 android）"
fi

# ---------------------------------------------------------------- 2. proot

say "2/3 proot（jniLibs）"
if [ -x "$JNI/libproot.so" ] && [ -x "$JNI/libprootloader.so" ]; then
  echo "  已存在：$JNI/libproot.so"
else
  bash "$ROOT/scripts/fetch-proot.sh"
fi

# ---------------------------------------------------------------- 3. 镜像

say "3/3 运行时镜像（约 225MB）"
GITHUB_BASE="https://github.com/equb1/dsh-palm/releases/download/runtime-v1"
CNB_BASE="https://cnb.cool/debaox3.0/test-new-technology/dsh-palm/-/releases/download/runtime-v1"
# 默认 GitHub Releases；可用 DSH_PALM_RUNTIME_BASE 覆盖，GitHub 失败时回退 cnb
BASE="${DSH_PALM_RUNTIME_BASE:-$GITHUB_BASE}"
fetch() {
  local name="$1" want="$2"
  local dest="$ASSETS/$name"
  if [ -f "$dest" ]; then
    local got
    got="$(shasum -a 256 "$dest" 2>/dev/null | cut -d' ' -f1 || sha256sum "$dest" | cut -d' ' -f1)"
    if [ "$got" = "$want" ]; then echo "  $name 已存在且校验通过"; return; fi
    echo "  $name 校验不符，重新下载"
    rm -f "$dest"
  fi
  echo "  下载 $name …"
  if ! curl -fL --retry 3 -o "$dest.part" "$BASE/$name"; then
    if [ "$BASE" = "$CNB_BASE" ]; then exit 1; fi
    echo "  GitHub 下载失败，回退 cnb …"
    curl -fL --retry 3 -o "$dest.part" "$CNB_BASE/$name"
  fi
  local got
  got="$(shasum -a 256 "$dest.part" 2>/dev/null | cut -d' ' -f1 || sha256sum "$dest.part" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    echo "  $name 校验失败：期望 $want 实际 $got"; rm -f "$dest.part"; exit 1
  fi
  mv "$dest.part" "$dest"
  echo "  $name 就位（sha256 通过）"
}

fetch rootfs.bin  a91d5a93010193712d346d761372b7c9db6dfcf093893161c64ca107f05914f2
fetch payload.bin 39447c6fd0dfb287c61d852a13e2417409d3b8589159274e8e589256888e35b1
# P0 1.1 Python/Office 层；rootfs 重建时不用重打 payload，但必须一起校验
fetch python.bin  2cc882ce91212fc997c67befbef34dc7ad24d218e856e24f206b6788d13c40c5

say "就绪"
echo "  ANDROID_HOME=$ANDROID_HOME"
echo "  JAVA_HOME=$JAVA_HOME"
[ -x "$ANDROID_HOME/platform-tools/adb" ] && "$ANDROID_HOME/platform-tools/adb" devices | sed 's/^/  adb: /'
echo
echo "下一步：cd app/android && sh gradlew :app:assembleDebug"
