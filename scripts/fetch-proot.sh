#!/usr/bin/env bash
#
# 取 Termux 的 proot（aarch64），放进 jniLibs。
#
# 为什么必须放 jniLibs：
#   Android 10+ 的 SELinux 不允许执行 app 私有目录里的文件，只允许执行
#   nativeLibraryDir（APK 里的 lib/arm64-v8a/）。文件名还得是 lib*.so，
#   所以 bin/proot -> libproot.so、libexec/proot/loader -> libprootloader.so。
#
# 这两个文件是 gitignore 的（*.so），换机器要重新跑一遍。
# 依赖库 libtalloc.so.2 / libandroid-shmem.so 已经在 assets 里，不用管。
#
# 用法（仓库根目录）：
#   bash scripts/fetch-proot.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/app/android/app/src/main/jniLibs/arm64-v8a"
VER="${PROOT_VER:-5.1.107.102}"
URL="https://packages.termux.dev/apt/termux-main/pool/main/p/proot/proot_${VER}_aarch64.deb"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "下载 $URL"
curl -fL --retry 3 -o "$TMP/proot.deb" "$URL"

# macOS 的 ar 不认 deb 成员名尾部的 "/"，用 python 解（macOS/Linux 都有）
python3 - "$TMP/proot.deb" "$TMP" <<'PY'
import os
import sys

deb, out = sys.argv[1], sys.argv[2]
data = open(deb, 'rb').read()
if data[:8] != b'!<arch>\n':
    raise SystemExit('不是 ar 归档，下载可能被拦截了')
pos = 8
while pos + 60 <= len(data):
    hdr = data[pos:pos + 60]
    name = hdr[0:16].decode().strip().rstrip('/')
    size = int(hdr[48:58].decode().strip())
    start = pos + 60
    open(os.path.join(out, name), 'wb').write(data[start:start + size])
    pos = start + size + (size % 2)
PY

tar -xf "$TMP/data.tar.xz" -C "$TMP"
PREFIX="$TMP/data/data/com.termux/files/usr"

for f in "$PREFIX/bin/proot" "$PREFIX/libexec/proot/loader"; do
  [ -f "$f" ] || { echo "包里没有 $f"; exit 1; }
done

mkdir -p "$OUT"
cp "$PREFIX/bin/proot" "$OUT/libproot.so"
cp "$PREFIX/libexec/proot/loader" "$OUT/libprootloader.so"
chmod 755 "$OUT/libproot.so" "$OUT/libprootloader.so"

ls -l "$OUT/libproot.so" "$OUT/libprootloader.so"
echo
echo "✓ proot 就位；现在 assembleDebug 出来的包才带得动引擎"
