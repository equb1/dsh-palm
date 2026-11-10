"""
生成品牌桌宠「小寄（Crabstack / 蟹栈）」的 sprite sheet。

源图：design/pet/{idle,thinking,working,success,error,sleeping}-1024.png
输出：
  app/assets/pets/xiaoji/sheets/<state>.png   # 8 帧横排，256×256/帧
  app/assets/pets/xiaoji/pack.json
  app/android/app/src/main/res/drawable/xiaoji_*.png  # 原生悬浮窗静态兜底

design/ 是本地设计源（未入库）；生成物入库。没有 design/ 时脚本会直接报错，
不会写出半成品。

用法：
  python3 scripts/build-pet-sheets.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "pet"
OUT = ROOT / "app" / "assets" / "pets" / "xiaoji"
DRAWABLE = ROOT / "app" / "android" / "app" / "src" / "main" / "res" / "drawable"

FRAME = 256
COLS = 8
CONTENT = 236
BOTTOM = 250

# 每一帧：(dx, dy, scale, angle)
# 小寄是平涂粗描边插画，动作只做轻微位移 / 挤压 / 旋转，避免破坏角色设定。
Frame = tuple[float, float, float, float]

STATES: dict[str, tuple[str, list[Frame]]] = {
    "idle": (
        "idle",
        [
            (0, 0, 1.000, 0.0),
            (0, -2, 1.005, 0.3),
            (0, -3, 1.010, 0.5),
            (0, -2, 1.005, 0.3),
            (0, 0, 1.000, 0.0),
            (0, 1, 0.998, -0.3),
            (0, 1, 0.998, -0.4),
            (0, 0, 1.000, 0.0),
        ],
    ),
    "thinking": (
        "thinking",
        [
            (0, 0, 1.000, -1.5),
            (-1, -2, 1.000, -1.0),
            (0, -3, 1.005, -0.5),
            (1, -2, 1.000, 0.0),
            (1, 0, 1.000, 0.8),
            (0, -1, 1.000, 1.2),
            (-1, -2, 1.000, 0.6),
            (0, -1, 1.000, 0.0),
        ],
    ),
    "working": (
        "working",
        [
            (0, 0, 1.000, 0.0),
            (0, -2, 1.002, 0.4),
            (1, -3, 1.004, -0.3),
            (0, -1, 1.000, 0.5),
            (-1, 0, 1.000, -0.4),
            (0, -2, 1.002, 0.3),
            (1, -3, 1.004, -0.2),
            (0, -1, 1.000, 0.0),
        ],
    ),
    "juggling": (
        "working",
        [
            (-1, 0, 1.000, -1.5),
            (1, -4, 1.005, 1.0),
            (-1, -2, 1.000, -1.0),
            (1, -5, 1.006, 1.8),
            (-1, -1, 1.000, -1.0),
            (1, -4, 1.005, 1.0),
            (-1, -2, 1.000, -1.5),
            (1, -3, 1.002, 1.0),
        ],
    ),
    "sweeping": (
        "working",
        [
            (-2, -2, 1.000, -2.0),
            (0, -5, 1.006, 1.5),
            (2, -2, 1.000, -1.0),
            (0, -6, 1.008, 2.0),
            (-2, -2, 1.000, -2.0),
            (0, -5, 1.006, 1.5),
            (2, -1, 1.000, -1.0),
            (0, -6, 1.008, 2.0),
        ],
    ),
    "attention": (
        "thinking",
        [
            (1, 0, 1.000, -2.0),
            (-1, -3, 1.004, 2.0),
            (1, -1, 1.000, -2.0),
            (-1, -4, 1.006, 2.0),
            (1, 0, 1.000, -2.0),
            (-1, -3, 1.004, 2.0),
            (1, -1, 1.000, -2.0),
            (-1, -2, 1.002, 1.0),
        ],
    ),
    "notification": (
        "success",
        [
            (0, 0, 1.000, 0.0),
            (0, -4, 1.002, -1.0),
            (0, -10, 1.004, 2.0),
            (0, -16, 1.006, -2.0),
            (0, -10, 1.004, 1.0),
            (0, -4, 1.002, 0.0),
            (0, 0, 1.000, 0.0),
            (0, 0, 1.000, 0.0),
        ],
    ),
    "error": (
        "error",
        [
            (0, 0, 1.000, 0.0),
            (-2, -1, 1.000, -2.5),
            (2, 0, 1.000, 2.5),
            (-2, -1, 1.000, -2.5),
            (2, 0, 1.000, 2.5),
            (-1, 0, 1.000, -1.0),
            (1, 0, 1.000, 1.0),
            (0, 0, 1.000, 0.0),
        ],
    ),
    "carrying": (
        "idle",
        [
            (0, 0, 1.000, -1.0),
            (0, -3, 1.002, -0.2),
            (1, -1, 1.000, 0.8),
            (1, -3, 1.002, 0.2),
            (0, 0, 1.000, 1.0),
            (-1, -3, 1.002, 0.2),
            (-1, -1, 1.000, -0.8),
            (0, -2, 1.000, -0.2),
        ],
    ),
    "sleeping": (
        "sleeping",
        [
            (0, 0, 1.000, 0.0),
            (0, -1, 1.005, 0.0),
            (0, -2, 1.010, 0.0),
            (0, -3, 1.015, 0.0),
            (0, -2, 1.010, 0.0),
            (0, -1, 1.005, 0.0),
            (0, 0, 1.000, 0.0),
            (0, 0, 1.000, 0.0),
        ],
    ),
    "waking": (
        "idle",
        [
            (0, 22, 0.980, 0.0),
            (0, 16, 0.988, -0.5),
            (0, 10, 0.994, 0.5),
            (0, 6, 1.000, 0.0),
            (0, 3, 1.000, -0.3),
            (0, 1, 1.000, 0.3),
            (0, 0, 1.000, 0.0),
            (0, 0, 1.000, 0.0),
        ],
    ),
    "roam": (
        "idle",
        [
            (-4, 0, 1.000, -1.5),
            (-2, -1, 1.000, -0.8),
            (0, -2, 1.002, 0.0),
            (2, -1, 1.000, 0.8),
            (4, 0, 1.000, 1.5),
            (2, -1, 1.000, 0.8),
            (0, -2, 1.002, 0.0),
            (-2, -1, 1.000, -0.8),
        ],
    ),
    "react-left": (
        "idle",
        [
            (0, 0, 1.000, 0.0),
            (-4, -1, 1.000, -2.0),
            (-8, 0, 0.998, -4.0),
            (-10, 0, 0.996, -5.0),
            (-8, 0, 0.998, -4.0),
            (-4, -1, 1.000, -2.0),
            (-2, 0, 1.000, -1.0),
            (0, 0, 1.000, 0.0),
        ],
    ),
    "react-right": (
        "idle",
        [
            (0, 0, 1.000, 0.0),
            (4, -1, 1.000, 2.0),
            (8, 0, 0.998, 4.0),
            (10, 0, 0.996, 5.0),
            (8, 0, 0.998, 4.0),
            (4, -1, 1.000, 2.0),
            (2, 0, 1.000, 1.0),
            (0, 0, 1.000, 0.0),
        ],
    ),
    "react-tickle": (
        "success",
        [
            (0, 0, 1.000, 0.0),
            (0, -3, 1.000, 1.5),
            (0, -6, 1.002, -2.0),
            (0, -3, 1.000, 2.0),
            (0, 0, 1.000, -1.5),
            (0, -2, 1.000, 1.5),
            (0, -5, 1.002, -1.5),
            (0, -2, 1.000, 0.5),
        ],
    ),
    "react-drag": (
        "working",
        [
            (0, -6, 1.000, -2.0),
            (0, -7, 1.000, -1.0),
            (0, -6, 1.000, 1.0),
            (0, -7, 1.000, 2.0),
            (0, -6, 1.000, 1.0),
            (0, -7, 1.000, -1.0),
            (0, -6, 1.000, -2.0),
            (0, -6, 1.000, -1.0),
        ],
    ),
}

FRAME_MS = {
    "idle": 140,
    "thinking": 150,
    "working": 95,
    "juggling": 85,
    "sweeping": 75,
    "attention": 120,
    "notification": 90,
    "error": 90,
    "carrying": 130,
    "sleeping": 240,
    "waking": 100,
    "roam": 110,
    "react-left": 80,
    "react-right": 80,
    "react-tickle": 80,
    "react-drag": 90,
}

ONESHOT = {"notification", "waking", "react-left", "react-right", "react-tickle", "react-drag"}

# 原生悬浮窗兜底静态图：状态 -> 源状态名
STATIC_ICONS = {
    "xiaoji_thinking": "thinking",
    "xiaoji_working": "working",
    "xiaoji_done": "success",
    "xiaoji_sleeping": "sleeping",
}

BUBBLES = {
    "idle": ["把整套工具，背在壳里", "合上就走，打开就干"],
    "thinking": ["让我想想…", "正在梳理思路"],
    "attention": ["等你确认一下", "这里需要你拍板"],
    "working": ["正在干活…", "马上就好"],
    "juggling": ["双任务并进", "两只钳子都不够用了"],
    "sweeping": ["多任务全力冲刺", "工具全摊开了"],
    "done": ["搞定！", "这一轮完成"],
    "error": ["出错了，我检查一下", "好像掉了颗螺丝"],
    "sleeping": ["Zzz…", "眯一会儿，壳还开着"],
    "waking": ["醒啦，继续干活"],
    "tapLeft": ["戳我左边啦", "左边有抽屉"],
    "tapRight": ["戳我右边啦", "别碰插件口"],
    "tickle": ["哈哈，好痒", "壳要笑开了"],
    "drag": ["起飞咯，工具都背好了"],
}


def clean_working(src: Image.Image) -> Image.Image:
    """
    精简 working：去掉壳右侧重复的悬浮屏，只留左侧一个悬浮屏。

    用左右两侧的壳面蓝色按行插值填平，再补回被挡住的面板接缝，
    保证缩到 64dp 也不会多出一块白色方块。
    """
    img = src.copy()
    px = img.load()
    polygon = [(646, 438), (816, 426), (810, 590), (642, 602)]

    def blue(x: int, y: int) -> tuple[int, int, int] | None:
        if x < 0 or y < 0 or x >= img.width or y >= img.height:
            return None
        r, g, b, a = px[x, y]
        if a < 200:
            return None
        if b > 120 and b > r + 55 and b > g + 25:
            return (r, g, b)
        return None

    min_y = min(p[1] for p in polygon)
    max_y = max(p[1] for p in polygon)
    left_x = {y: None for y in range(min_y, max_y + 1)}
    right_x = {y: None for y in range(min_y, max_y + 1)}
    for y in range(min_y, max_y + 1):
        # 多边形的左右边界（按上下两条边线性插值）
        t = (y - polygon[0][1]) / (polygon[3][1] - polygon[0][1])
        xl = int(polygon[0][0] + (polygon[3][0] - polygon[0][0]) * t)
        xr = int(polygon[1][0] + (polygon[2][0] - polygon[1][0]) * t)
        left_x[y] = xl
        right_x[y] = xr
        left = None
        for dx in range(4, 60):
            left = blue(xl - dx, y)
            if left:
                break
        right = None
        for dx in range(4, 60):
            right = blue(xr + dx, y)
            if right:
                break
        left = left or (48, 104, 194)
        right = right or (40, 87, 155)
        for x in range(xl, xr + 1):
            f = (x - xl) / max(1, xr - xl)
            px[x, y] = (
                round(left[0] + (right[0] - left[0]) * f),
                round(left[1] + (right[1] - left[1]) * f),
                round(left[2] + (right[2] - left[2]) * f),
                255,
            )

    # 补回被白色面板挡住的壳面接缝（深色 + 右侧高光）
    draw = ImageDraw.Draw(img)
    draw.line([(760, 426), (753, 602)], fill=(24, 38, 64, 255), width=7)
    draw.line([(764, 426), (757, 602)], fill=(48, 84, 142, 255), width=2)
    return img


def load_sources() -> dict[str, Image.Image]:
    sources: dict[str, Image.Image] = {}
    for name in ("idle", "thinking", "working", "success", "error", "sleeping"):
        path = SRC / f"{name}-1024.png"
        if not path.exists():
            raise SystemExit(f"缺少设计源：{path}（design/ 未入库，请让维护者提供设计包）")
        sources[name] = Image.open(path).convert("RGBA")
    sources["working"] = clean_working(sources["working"])
    return sources


def premultiply(img: Image.Image) -> Image.Image:
    """Alpha 预乘：避免 LANCZOS  resize 时透明像素的白色 RGB 渗到边缘形成白边。"""
    r, g, b, a = img.split()
    return Image.merge(
        "RGBA",
        (
            ImageChops.multiply(r, a),
            ImageChops.multiply(g, a),
            ImageChops.multiply(b, a),
            a,
        ),
    )


def resize_rgba(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    return premultiply(img).resize(size, Image.Resampling.LANCZOS)


def fit(src: Image.Image) -> Image.Image:
    """整张 1024 画布等比缩放，保留设计源里的安全区和相对比例。"""
    scale = CONTENT / src.width
    return resize_rgba(
        src,
        (max(1, round(src.width * scale)), max(1, round(src.height * scale))),
    )


def make_frame(src: Image.Image, dx: float, dy: float, scale: float, angle: float) -> Image.Image:
    canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))

    # 柔和落地阴影（平涂风格用低透明度椭圆，不留白底）
    shadow = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.ellipse((FRAME * 0.24, FRAME * 0.90, FRAME * 0.76, FRAME * 0.975), fill=(17, 24, 39, 34))
    canvas.alpha_composite(shadow)

    img = src
    if scale != 1.0:
        img = resize_rgba(
            img, (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        )
    if angle:
        img = img.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)

    x = round(FRAME / 2 - img.width / 2 + dx)
    y = round(BOTTOM - img.height + dy)
    canvas.alpha_composite(img, (x, y))
    return canvas


def build() -> None:
    sources = load_sources()
    fitted = {name: fit(img) for name, img in sources.items()}
    out_dir = OUT / "sheets"
    out_dir.mkdir(parents=True, exist_ok=True)

    for state, (source, frames) in STATES.items():
        sheet = Image.new("RGBA", (FRAME * COLS, FRAME), (0, 0, 0, 0))
        for i, (dx, dy, scale, angle) in enumerate(frames):
            sheet.alpha_composite(
                make_frame(fitted[source], dx, dy, scale, angle), (i * FRAME, 0)
            )
        sheet.quantize(
            colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE
        ).save(out_dir / f"{state}.png", optimize=True)
        print(f"xiaoji/{state}.png  {FRAME * COLS}x{FRAME}  {FRAME_MS[state]}ms")

    write_pack()
    write_static_icons(sources)


def write_pack() -> None:
    animations = {
        state: {
            "sheet": f"sheets/{state}.png",
            "frameW": FRAME,
            "frameH": FRAME,
            "cols": COLS,
            "frames": [{"i": i, "ms": FRAME_MS[state]} for i in range(COLS)],
            "loop": state not in ONESHOT,
        }
        for state in STATES
    }

    pack = {
        "schema": 2,
        "id": "xiaoji",
        "name": "小寄（蟹栈助手）",
        "version": "1.0.0",
        "canvas": {"width": FRAME, "height": FRAME},
        "anchor": {"x": 0.5, "y": 1.0},
        "contentBox": {"x": 8, "y": 8, "width": 240, "height": 240},
        "hitBoxes": {
            "head": {"x": 56, "y": 40, "width": 144, "height": 104},
            "body": {"x": 32, "y": 144, "width": 192, "height": 104},
        },
        "animations": animations,
        "states": {state: state for state in STATES},
        "tiers": {
            "working": {"minTasks": 1, "maxTasks": 1, "anim": "working"},
            "juggling": {"minTasks": 2, "maxTasks": 2, "anim": "juggling"},
            "sweeping": {"minTasks": 3, "maxTasks": 99, "anim": "sweeping"},
        },
        "idlePool": [
            {"anim": "idle", "weight": 78},
            {"anim": "roam", "weight": 22},
        ],
        "reactions": {
            "tapLeft": "react-left",
            "tapRight": "react-right",
            "tickle": "react-tickle",
            "drag": "react-drag",
        },
        "timings": {
            "minDisplayMs": 600,
            "autoReturnMs": 1800,
            "wakeMs": 650,
            "sleepAfterMs": 60000,
        },
        "bubbles": BUBBLES,
    }
    (OUT / "pack.json").write_text(
        json.dumps(pack, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"xiaoji/pack.json  {len(animations)} animations")


def write_static_icons(sources: dict[str, Image.Image]) -> None:
    """原生悬浮窗在 pack 读取失败时的兜底图（192px，透明背景）。"""
    DRAWABLE.mkdir(parents=True, exist_ok=True)
    for resource, state in STATIC_ICONS.items():
        img = sources[state]
        scale = 192 / max(img.width, img.height)
        icon = resize_rgba(
            img, (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
        )
        canvas = Image.new("RGBA", (192, 192), (0, 0, 0, 0))
        canvas.alpha_composite(
            icon, ((192 - icon.width) // 2, (192 - icon.height) // 2)
        )
        canvas.quantize(
            colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE
        ).save(DRAWABLE / f"{resource}.png", optimize=True)
        print(f"drawable/{resource}.png  192x192")


if __name__ == "__main__":
    build()
