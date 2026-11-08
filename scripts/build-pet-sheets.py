"""
生成桌宠 sprite sheet（程序化 v1，后续可替换为手绘/AI 帧）。

源图：app/assets/pets/<role>_<waiting|coding|done|sleeping>.png
输出：app/assets/pets/<role>/sheets/<state>.png
每张 sheet：8 帧横排，128×128/帧。

用法：
  python scripts/build-pet-sheets.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PETS = ROOT / "app" / "assets" / "pets"
FRAME = 128
COLS = 8
CONTENT = 120
BOTTOM = 124

# 状态 -> (源图 key, 每帧参数)
# 参数: (dx, dy, scale_x, scale_y, rotate_deg)
STATES: dict[str, tuple[str, list[tuple[float, float, float, float, float]]]] = {
    "idle": (
        "waiting_clean",
        [
            (0, 0, 1.00, 1.00, 0),
            (1, -1, 1.00, 1.01, 0.6),
            (1, -2, 1.00, 1.02, 0.8),
            (0, -2, 1.00, 1.02, 0),
            (-1, -1, 1.00, 1.01, -0.6),
            (-1, 0, 1.00, 1.00, -0.8),
            (0, 1, 1.00, 0.99, 0),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "thinking": (
        "waiting_clean",
        [
            (0, 0, 1.00, 1.00, -1),
            (-1, -1, 1.00, 1.00, -2),
            (-1, -2, 1.00, 1.01, -2),
            (0, -2, 1.00, 1.01, 0),
            (1, -1, 1.00, 1.00, 2),
            (1, 0, 1.00, 1.00, 2),
            (0, 0, 1.00, 1.00, 1),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "working": (
        "coding",
        [
            (0, 0, 1.00, 1.00, 0),
            (0, -2, 1.00, 1.01, 0),
            (1, -1, 1.00, 1.00, 0.5),
            (-1, -2, 1.00, 1.01, -0.5),
            (0, 0, 1.00, 1.00, 0),
            (0, -3, 1.00, 1.02, 0),
            (1, -1, 1.00, 1.00, 0.5),
            (-1, -1, 1.00, 1.00, -0.5),
        ],
    ),
    "juggling": (
        "coding",
        [
            (-3, 0, 1.00, 1.00, -3),
            (-2, -2, 0.99, 1.02, -1),
            (0, -3, 1.01, 1.00, 0),
            (2, -2, 0.99, 1.02, 1),
            (3, 0, 1.00, 1.00, 3),
            (2, -2, 0.99, 1.02, 1),
            (0, -3, 1.01, 1.00, 0),
            (-2, -2, 0.99, 1.02, -1),
        ],
    ),
    "sweeping": (
        "coding",
        [
            (-2, 0, 1.00, 1.00, -4),
            (-1, -2, 1.00, 1.02, -2),
            (1, -4, 1.00, 1.02, 2),
            (2, -2, 1.00, 1.00, 4),
            (1, 0, 1.00, 1.00, 2),
            (-1, -2, 1.00, 1.02, -2),
            (-2, -4, 1.00, 1.02, -4),
            (0, -2, 1.00, 1.00, 0),
        ],
    ),
    "attention": (
        "waiting",
        [
            (0, 0, 1.00, 1.00, 0),
            (2, -1, 1.00, 1.00, 2),
            (3, 0, 1.00, 1.00, 3),
            (2, 1, 1.00, 1.00, 2),
            (0, 0, 1.00, 1.00, 0),
            (-2, -1, 1.00, 1.00, -2),
            (-3, 0, 1.00, 1.00, -3),
            (-2, 1, 1.00, 1.00, -2),
        ],
    ),
    "notification": (
        "done",
        [
            (0, 0, 1.00, 1.00, 0),
            (0, -4, 1.00, 1.02, 0),
            (0, -8, 1.00, 1.04, -3),
            (0, -10, 1.00, 1.04, 0),
            (0, -6, 1.00, 1.02, 3),
            (0, -2, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "error": (
        "waiting",
        [
            (0, 0, 1.00, 1.00, 0),
            (-2, 0, 1.00, 1.00, -3),
            (2, 0, 1.00, 1.00, 3),
            (-2, 0, 1.00, 1.00, -3),
            (2, 0, 1.00, 1.00, 3),
            (-1, 0, 1.00, 1.00, -1),
            (1, 0, 1.00, 1.00, 1),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "carrying": (
        "coding",
        [
            (0, -2, 1.00, 0.99, 0),
            (0, -3, 1.00, 0.98, 0),
            (1, -2, 1.00, 0.99, 0.5),
            (1, -3, 1.00, 0.98, 0.5),
            (0, -2, 1.00, 0.99, 0),
            (-1, -3, 1.00, 0.98, -0.5),
            (-1, -2, 1.00, 0.99, -0.5),
            (0, -2, 1.00, 0.99, 0),
        ],
    ),
    "sleeping": (
        "sleeping",
        [
            (0, 0, 1.00, 1.00, 0),
            (0, -1, 1.00, 1.01, 0),
            (0, -2, 1.00, 1.02, 0),
            (0, -3, 1.00, 1.03, 0),
            (0, -2, 1.00, 1.02, 0),
            (0, -1, 1.00, 1.01, 0),
            (0, 0, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "waking": (
        "done",
        [
            (0, 14, 1.00, 1.00, 0),
            (0, 10, 1.00, 1.00, 0),
            (0, 6, 1.00, 1.00, 0),
            (0, 3, 1.00, 1.00, 0),
            (0, 1, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
            (0, -1, 1.00, 1.01, 0),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "roam": (
        "waiting_clean",
        [
            (-4, 0, 1.00, 1.00, -2),
            (-2, -1, 1.00, 1.00, -1),
            (0, 0, 1.00, 1.00, 0),
            (2, -1, 1.00, 1.00, 1),
            (4, 0, 1.00, 1.00, 2),
            (2, -1, 1.00, 1.00, 1),
            (0, 0, 1.00, 1.00, 0),
            (-2, -1, 1.00, 1.00, -1),
        ],
    ),
    "react-left": (
        "waiting",
        [
            (0, 0, 1.00, 1.00, 0),
            (-4, -1, 1.00, 1.00, -3),
            (-6, 0, 1.00, 1.00, -5),
            (-4, 0, 1.00, 1.00, -3),
            (-2, 0, 1.00, 1.00, -1),
            (0, 0, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "react-right": (
        "waiting",
        [
            (0, 0, 1.00, 1.00, 0),
            (4, -1, 1.00, 1.00, 3),
            (6, 0, 1.00, 1.00, 5),
            (4, 0, 1.00, 1.00, 3),
            (2, 0, 1.00, 1.00, 1),
            (0, 0, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "react-tickle": (
        "done",
        [
            (0, 0, 1.00, 1.00, 0),
            (0, -2, 1.00, 1.01, 3),
            (0, -4, 1.00, 1.02, -3),
            (0, -2, 1.00, 1.01, 3),
            (0, 0, 1.00, 1.00, 0),
            (0, 2, 1.00, 0.99, -2),
            (0, 0, 1.00, 1.00, 0),
            (0, 0, 1.00, 1.00, 0),
        ],
    ),
    "react-drag": (
        "coding",
        [
            (0, -8, 1.00, 1.00, -2),
            (0, -10, 1.00, 1.00, -3),
            (0, -10, 1.00, 1.00, 2),
            (0, -9, 1.00, 1.00, 3),
            (0, -8, 1.00, 1.00, -2),
            (0, -8, 1.00, 1.00, -1),
            (0, -8, 1.00, 1.00, 0),
            (0, -8, 1.00, 1.00, 0),
        ],
    ),
}

FRAME_MS = {
    "idle": 140,
    "thinking": 150,
    "working": 90,
    "juggling": 80,
    "sweeping": 70,
    "attention": 120,
    "notification": 90,
    "error": 80,
    "carrying": 130,
    "sleeping": 220,
    "waking": 100,
    "roam": 110,
    "react-left": 70,
    "react-right": 70,
    "react-tickle": 80,
    "react-drag": 90,
}


def fit_source(src: Image.Image) -> Image.Image:
    """把源图按比例缩放到 content 框内，最近邻保留像素边缘。"""
    src = src.convert("RGBA")
    scale = min(CONTENT / src.width, CONTENT / src.height)
    w = max(1, round(src.width * scale))
    h = max(1, round(src.height * scale))
    return src.resize((w, h), Image.Resampling.NEAREST)


def make_frame(src: Image.Image, dx: float, dy: float, sx: float, sy: float, angle: float) -> Image.Image:
    canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))

    # 阴影：让角色落地，不是悬空贴纸
    shadow = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.ellipse((40, 116, 88, 126), fill=(0, 0, 0, 42))
    canvas.alpha_composite(shadow)

    img = src
    if sx != 1.0 or sy != 1.0:
        img = img.resize(
            (max(1, round(img.width * sx)), max(1, round(img.height * sy))),
            Image.Resampling.NEAREST,
        )
    if angle:
        img = img.rotate(angle, resample=Image.Resampling.NEAREST, expand=True)

    x = round(FRAME / 2 - img.width / 2 + dx)
    y = round(BOTTOM - img.height + dy)
    canvas.alpha_composite(img, (x, y))
    return canvas


def build_role(role: str) -> None:
    out_dir = PETS / role / "sheets"
    out_dir.mkdir(parents=True, exist_ok=True)
    sources = {
        key: Image.open(PETS / f"{role}_{key}.png")
        for key in ("waiting", "coding", "done", "sleeping")
    }
    # waiting 素材左上角带一个感叹号气泡；idle/thinking 用去掉气泡的版本
    sources["waiting_clean"] = sources["waiting"].crop(
        (0, 30, sources["waiting"].width, sources["waiting"].height)
    )

    for state, (source_key, frames) in STATES.items():
        sheet = Image.new("RGBA", (FRAME * COLS, FRAME), (0, 0, 0, 0))
        src = fit_source(sources[source_key])
        for i, (dx, dy, sx, sy, angle) in enumerate(frames):
            sheet.alpha_composite(make_frame(src, dx, dy, sx, sy, angle), (i * FRAME, 0))
        sheet.save(out_dir / f"{state}.png", optimize=True)
        print(f"{role}/{state}.png  {FRAME * COLS}x{FRAME}  {FRAME_MS[state]}ms")

    write_pack(role)


PACK_NAMES = {"deepy": "小章鱼 Deepy", "maid": "鲸娘"}
ONESHOT = {"notification", "waking", "react-left", "react-right", "react-tickle", "react-drag"}


def write_pack(role: str) -> None:
    """生成与 sheet 严格对齐的 pack.json。"""
    animations = {}
    for state in STATES:
        animations[state] = {
            "sheet": f"sheets/{state}.png",
            "frameW": FRAME,
            "frameH": FRAME,
            "cols": COLS,
            "frames": [{"i": i, "ms": FRAME_MS[state]} for i in range(COLS)],
            "loop": state not in ONESHOT,
        }

    pack = {
        "schema": 2,
        "id": role,
        "name": PACK_NAMES[role],
        "version": "2.0.0",
        "canvas": {"width": FRAME, "height": FRAME},
        "anchor": {"x": 0.5, "y": 1.0},
        "contentBox": {"x": 4, "y": 4, "width": 120, "height": 120},
        "hitBoxes": {
            "head": {"x": 24, "y": 20, "width": 80, "height": 56},
            "body": {"x": 16, "y": 70, "width": 96, "height": 54},
        },
        "animations": animations,
        "states": {state: state for state in STATES},
        "tiers": {
            "working": {"minTasks": 1, "maxTasks": 1, "anim": "working"},
            "juggling": {"minTasks": 2, "maxTasks": 2, "anim": "juggling"},
            "sweeping": {"minTasks": 3, "maxTasks": 99, "anim": "sweeping"},
        },
        "idlePool": [
            {"anim": "idle", "weight": 75},
            {"anim": "roam", "weight": 25},
        ],
        "reactions": {
            "tapLeft": "react-left",
            "tapRight": "react-right",
            "tickle": "react-tickle",
            "drag": "react-drag",
        },
        "timings": {
            "minDisplayMs": 400,
            "autoReturnMs": 1500,
            "wakeMs": 600,
            "sleepAfterMs": 60000,
        },
        "bubbles": {
            "thinking": ["让我想想…", "正在梳理思路"],
            "attention": ["等你确认一下", "这里需要你拍板"],
            "error": ["出错了，我检查一下", "网络好像不太稳"],
            "done": ["搞定！", "这一轮完成"],
            "sleeping": ["Zzz…", "眯一会儿"],
            "working": ["正在干活…", "马上就好"],
            "tapLeft": ["戳我左边啦~"],
            "tapRight": ["戳我右边啦~"],
            "tickle": ["哈哈，好痒"],
            "drag": ["起飞咯~"],
        },
    }
    (PETS / role / "pack.json").write_text(
        __import__("json").dumps(pack, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"{role}/pack.json  {len(animations)} animations")


def main() -> None:
    for role in ("deepy", "maid"):
        build_role(role)


if __name__ == "__main__":
    main()
