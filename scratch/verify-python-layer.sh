#!/bin/sh
echo "== python =="
command -v python3 && python3 -V
python3 - <<'PY'
import sys
print("python", sys.version.split()[0])
for mod in ("docx", "openpyxl", "pptx", "PIL", "lxml", "xlsxwriter"):
    try:
        m = __import__(mod)
        print(mod, getattr(m, "__version__", "ok"))
    except Exception as exc:
        print(mod, "MISSING", exc)
PY
echo "== marker =="
cat /usr/lib/python3.12/.dshpalm-layer
echo
echo "== PaxHeaders left =="
find / -xdev -type d \( -name PaxHeaders -o -name 'PaxHeaders.*' \) 2>/dev/null | wc -l
echo "== smoke =="
python3 /root/work/office-smoke.py 2>&1 | tail -6
