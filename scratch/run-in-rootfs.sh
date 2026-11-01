#!/system/bin/sh
# 在手机 rootfs 里跑一条命令（调试用）。app 自己读不到 /data/app，所以 proot 路径要传进来。
#
#   adb push scratch/run-in-rootfs.sh /data/local/tmp/
#   adb shell run-as cool.cnb.dshpalm cp /data/local/tmp/run-in-rootfs.sh files/
#   adb shell run-as cool.cnb.dshpalm sh files/run-in-rootfs.sh <nativeLibraryDir> \
#       'xdg-user-dir DOCUMENTS'
#
# nativeLibraryDir 从日志里抄：adb shell run-as cool.cnb.dshpalm cat files/logs/engine.log
LIBDIR=$1
shift
LIB=/data/user/0/cool.cnb.dshpalm/files/runtime

export PROOT_LOADER="$LIBDIR/libprootloader.so"
export LD_LIBRARY_PATH="$LIB/lib"
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/root
export TERM=dumb
export LANG=C.UTF-8

exec "$LIBDIR/libproot.so" -0 -r "$LIB/rootfs" -b /dev -b /proc -b /sys -w /root /bin/sh -c "$*"
