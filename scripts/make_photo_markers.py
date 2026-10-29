# -*- coding: utf-8 -*-
"""
把点位照片做成地图用的圆形 marker 图片

输入：assets/photos-src/<点位id>.jpg（长边 1024 左右即可）
输出：miniprogram/assets/photos/<点位id>.png（96×96 圆形，白边 + 分类色环）

用法：
    python scripts/make_photo_markers.py
    python scripts/make_photo_markers.py --size 120     # 想大一点
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "photos-src"
OUT = ROOT / "miniprogram" / "assets" / "photos"
HERO_OUT = OUT / "hero"
PLACES = ROOT / "miniprogram" / "data" / "places.js"

EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def load_places():
    js = "console.log(JSON.stringify(require(String.raw`" + str(PLACES) + "`).PLACES))"
    try:
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=30)
        if out.returncode != 0:
            return []
        return json.loads(out.stdout)
    except Exception:
        return []


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=96, help="输出边长（像素），默认 96")
    ap.add_argument("--ring", type=int, default=None, help="色环宽度，默认按尺寸自动（约 1/12）")
    ap.add_argument("--hero", type=int, default=320, help="详情页大图边长，默认 320")
    args = ap.parse_args()

    try:
        from PIL import Image, ImageDraw, ImageOps
    except ImportError:
        sys.exit("缺 Pillow：请用项目自带的 python 运行（它自带 Pillow）")

    if not SRC.exists():
        SRC.mkdir(parents=True, exist_ok=True)
        print(f"还没有照片。把 <点位id>.jpg 放进：{SRC}")
        print("点位 id 见 miniprogram/data/places.js，例如：wanlou.jpg / maozedong.jpg")
        return

    files = [p for p in SRC.iterdir() if p.suffix.lower() in EXTS]
    if not files:
        print(f"{SRC} 里没有图片。放 <点位id>.jpg 再跑一次。")
        return

    colors = {}
    for p in load_places():
        colors[p["id"]] = (p.get("color") or "").strip()

    # places.js 里没有 color 字段，用分类配色表兜底
    CATEGORY_COLOR = {
        "scenic": "#2c6b63",
        "oldtown": "#8b6f47",
        "red": "#b0392e",
        "school": "#3a6ea5",
        "food": "#d98324",
    }
    category_of = {p["id"]: p["category"] for p in load_places()}

    size = args.size
    ring = args.ring if args.ring is not None else max(4, size // 12)
    inner = size - ring * 2
    OUT.mkdir(parents=True, exist_ok=True)

    total = 0
    used = 0
    skipped = []
    for f in sorted(files):
        pid = f.stem
        if pid not in category_of:
            skipped.append(f"{f.name}（places.js 里没有这个 id）")
            continue

        color = hex_to_rgb(CATEGORY_COLOR.get(category_of[pid], "#b0392e"))
        img = Image.open(f).convert("RGB")
        img = ImageOps.fit(img, (inner, inner), method=Image.LANCZOS, centering=(0.5, 0.5))

        # 圆形遮罩
        mask = Image.new("L", (inner, inner), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, inner - 1, inner - 1), fill=255)

        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(canvas)
        draw.ellipse((0, 0, size - 1, size - 1), fill=color + (255,))
        canvas.paste(img, (ring, ring), mask)

        dst = OUT / f"{pid}.png"
        # 量化到 64 色调色板：照片在 96px 下几乎看不出差别，体积能小 3-4 倍
        canvas.convert("P", palette=Image.ADAPTIVE, colors=64).save(dst, "PNG", optimize=True)

        # 详情页大图（方形 JPG，压缩后很小）
        HERO_OUT.mkdir(parents=True, exist_ok=True)
        hero = Image.open(f).convert("RGB")
        hero = ImageOps.fit(hero, (args.hero, args.hero), method=Image.LANCZOS, centering=(0.5, 0.5))
        hero_path = HERO_OUT / f"{pid}.jpg"
        hero.save(hero_path, "JPEG", quality=68, optimize=True, progressive=True)

        kb = dst.stat().st_size / 1024 + hero_path.stat().st_size / 1024
        total += kb
        used += 1
        print(f"  {pid:<16} {kb:5.1f} KB")

    # 生成 id -> 图片路径 的映射，地图和详情页都读它
    mapping = {p.stem: f"photos/{p.stem}.png" for p in sorted(OUT.glob("*.png"))}
    heroes = {p.stem: f"photos/hero/{p.stem}.jpg" for p in sorted(HERO_OUT.glob("*.jpg"))}
    lines = "".join(f"  {k}: '{v}',\n" for k, v in mapping.items())
    hero_lines = "".join(f"  {k}: '{v}',\n" for k, v in heroes.items())
    js = (
        "/**\n"
        " * 点位实景图（由 scripts/make_photo_markers.py 生成，勿手改）\n"
        " * PHOTOS：96px 圆形 marker 图；HEROES：详情页大图\n"
        " */\n"
        "const PHOTOS = {\n" + lines + "};\n\n"
        "const HEROES = {\n" + hero_lines + "};\n\n"
        "module.exports = { PHOTOS, HEROES };\n"
    )
    PHOTOS_JS = ROOT / "miniprogram" / "data" / "photos.js"
    PHOTOS_JS.write_text(js, encoding="utf-8")
    print(f"\n映射已写入 {PHOTOS_JS}（{len(mapping)} 个点位）")

    print(f"\n完成：{used} 张，总大小 {total:.0f} KB → {OUT}")
    if skipped:
        print("跳过：")
        for s in skipped:
            print("  -", s)
    print(f"\n主包目前约 110 KB（上限 2 MB），加进去后约 {110 + total:.0f} KB")


if __name__ == "__main__":
    main()
