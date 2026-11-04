#!/bin/sh
# Build the Python + Office runtime layer (python.bin) on a phone rootfs.
#
# 在手机 proot 里跑（宿主网络/前台要正常）：
#   adb shell run-as cool.cnb.dshpalm sh files/run-in-rootfs.sh <nativeLibraryDir> \
#       '/bin/sh /root/work/build-python-layer.sh'
# 产物：/root/work/python.bin（目标位置 app/android/app/src/main/assets/python.bin）
#
# 为什么不 dpkg：app 私有目录里 SELinux 禁 link()，dpkg 做备份文件时直接失败。
# 所以用 `dpkg-deb --fsys-tarfile | tar -x --hard-dereference` 把 deb 解进 rootfs，
# 再把「这些文件」打包成层。compat 见 docs/PITFALLS.md F6。
set -e
DEBS=/var/cache/apt/archives
PKGS="python3 python3-docx python3-openpyxl python3-pil python3-pip"
OUT=/root/work/python.bin
LIST=/root/work/python-layer-files.txt

echo "== 1/5 apt lists =="
if [ ! -f /var/lib/apt/lists/*Packages* ] 2>/dev/null; then
  apt-get update -o Acquire::Retries=3
fi

echo "== 2/5 download debs (cached ok) =="
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  --download-only -o Acquire::Retries=3 $PKGS

echo "== 3/5 extract debs into rootfs =="
cd "$DEBS"
n=0
for deb in *.deb; do
  case "$deb" in
    libssl3t64*) echo "skip in-use libssl upgrade: $deb"; continue ;;
  esac
  dpkg-deb --fsys-tarfile "$deb" | tar -x --hard-dereference --no-same-owner -C /
  n=$((n+1))
done
echo "extracted $n debs"

echo "== 4/5 python-pptx + CA bundle =="
mkdir -p /etc/ssl/certs
cat /usr/share/ca-certificates/mozilla/*.crt > /etc/ssl/certs/ca-certificates.crt 2>/dev/null || true
if ! python3 -c 'import pptx' 2>/dev/null; then
  python3 -m pip install --break-system-packages --no-cache-dir --timeout 60 --retries 2 "python-pptx==1.0.2"
fi

echo "== 5/5 pack layer =="
: > "$LIST"
cd "$DEBS"
for deb in *.deb; do
  case "$deb" in
    libssl3t64*) continue ;;
  esac
  dpkg-deb --fsys-tarfile "$deb" | tar -t >> "$LIST"
done
find /usr/local/lib/python3.12 -mindepth 1 >> "$LIST" 2>/dev/null || true
find /usr/local/bin -mindepth 1 >> "$LIST" 2>/dev/null || true
[ -f /etc/ssl/certs/ca-certificates.crt ] && echo /etc/ssl/certs/ca-certificates.crt >> "$LIST"
sed -e 's|^\./||' -e 's|^/||' "$LIST" | grep -v PaxHeaders | grep -v '^$' | sort -u > "$LIST.norm"
echo "layer entries: $(wc -l < "$LIST.norm")"
tar -czf "$OUT" -C / --no-recursion -T "$LIST.norm"
ls -l "$OUT"
sha256sum "$OUT"
