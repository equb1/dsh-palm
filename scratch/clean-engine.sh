#!/system/bin/sh
# 清掉遗留的引擎进程（调试用；App 自己的进程树由 am force-stop 负责）
for pid in $(ps -A -o PID,ARGS | grep -E 'libproot|dsh/lib/bin' | awk '{print $1}'); do
  if [ "$pid" != "$$" ]; then
    kill -9 "$pid" 2>/dev/null && echo "killed $pid"
  fi
done
sleep 1
ps -A -o PID,ARGS | grep -E 'libproot|dsh/lib/bin' || echo clean
