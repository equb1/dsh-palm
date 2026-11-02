#!/bin/sh
# 手机 rootfs 里没有 xdg-user-dirs，而 dsh 用 `xdg-user-dir DOCUMENTS` 找默认工作区。
# 这个 shim 只回答“目录在哪”，目录本身由 dsh 自己建。
#
# DOCUMENTS 指向 $HOME/work：那个目录由原生层从外面 bind 进来
# （files/workspace → /root/work），不属于 rootfs ——
# 换运行时镜像不会把用户的文件冲掉。
case "$1" in
  DESKTOP) echo "$HOME/Desktop" ;;
  DOWNLOAD) echo "$HOME/Downloads" ;;
  TEMPLATES) echo "$HOME/Templates" ;;
  PUBLICSHARE) echo "$HOME/Public" ;;
  DOCUMENTS) echo "$HOME/work" ;;
  MUSIC) echo "$HOME/Music" ;;
  PICTURES) echo "$HOME/Pictures" ;;
  VIDEOS) echo "$HOME/Videos" ;;
  *) echo "$HOME" ;;
esac
exit 0
