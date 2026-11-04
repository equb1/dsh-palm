#!/system/bin/sh
# Run one command inside the phone rootfs (debug helper).
# The app-uid shell cannot read /data/app, so nativeLibraryDir is passed in.
#
#   adb shell run-as cool.cnb.dshpalm sh files/run-in-rootfs.sh <nativeLibraryDir> \
#       '/bin/sh /root/work/my-probe.sh'
#
# nativeLibraryDir = <codePath>/lib/arm64, codePath from:
#   adb shell "dumpsys package cool.cnb.dshpalm | grep codePath"
LIBDIR=$1
shift
FILES=/data/user/0/cool.cnb.dshpalm/files
LIB="$FILES/runtime"

export PROOT_LOADER="$LIBDIR/libprootloader.so"
export LD_LIBRARY_PATH="$LIB/lib"
export PROOT_TMP_DIR="$LIB/tmp"
mkdir -p "$PROOT_TMP_DIR"
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/root
export TERM=dumb
export LANG=C.UTF-8
export DEBIAN_FRONTEND=noninteractive

exec "$LIBDIR/libproot.so" -0 -r "$LIB/rootfs" \
  -b /dev -b /proc -b /sys \
  -b "$FILES/workspace:/root/work" \
  -b "$FILES/bridge:/bridge" \
  -b "$FILES/home/.dsh:/root/.dsh" \
  -w /root /bin/sh -c "$*"
