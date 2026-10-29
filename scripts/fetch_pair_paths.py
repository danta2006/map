# -*- coding: utf-8 -*-
"""
给「我的行程」里任意两点补真实路径（不再画直线）
- 直线 ≤ 1.5km 用步行路径；更远用驾车路径（路上更接近游客实际走法）
- 抽稀后写入 miniprogram/data/pairPaths.js

用法：
  $env:AMAP_KEY = "..."
  python scripts/fetch_pair_paths.py
"""
import io
import json
import math
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLACES = ROOT / "miniprogram" / "data" / "places.js"
REAL_LEGS = ROOT / "miniprogram" / "data" / "realLegs.js"
OUT = ROOT / "miniprogram" / "data" / "pairPaths.js"
NODE = os.environ.get("NODE_BIN") or "node"
KEY = os.environ.get("AMAP_KEY", "").strip()
SLEEP = 0.32
WALK_LIMIT = 1500          # 直线距离小于这个就用步行路径
TOL = 0.00030              # 抽稀容差（约 33 米）
MAX_POINTS = 60            # 每条最多保留点数


def load_js(module_path, export_name):
    js = "console.log(JSON.stringify(require(String.raw`" + str(module_path) + "`)." + export_name + "))"
    out = subprocess.run([NODE, "-e", js], capture_output=True, text=True, encoding="utf-8")
    return json.loads(out.stdout)


def get(url, retry=3):
    for i in range(retry):
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(1.2 * (i + 1))
    return None


def parse_polyline(s):
    pts = []
    if not s:
        return pts
    for pair in s.split(";"):
        p = pair.split(",")
        if len(p) == 2:
            try:
                pts.append([float(p[0]), float(p[1])])
            except ValueError:
                pass
    return pts


def path_of(a, b, mode):
    url = ("https://restapi.amap.com/v3/direction/walking?" if mode == "walk"
           else "https://restapi.amap.com/v3/direction/driving?")
    url += urllib.parse.urlencode({
        "origin": f'{a["longitude"]},{a["latitude"]}',
        "destination": f'{b["longitude"]},{b["latitude"]}',
        "key": KEY,
    })
    d = get(url)
    if not d or d.get("status") != "1" or not d["route"]["paths"]:
        return []
    pts = []
    for st in d["route"]["paths"][0]["steps"]:
        pts.extend(parse_polyline(st.get("polyline")))
    return pts


def simplify(points, tol):
    """Douglas-Peucker"""
    if len(points) <= 2:
        return points
    lat0 = points[0][1]
    scale = math.cos(math.radians(lat0))

    def xy(p):
        return (p[0] * scale, p[1])

    def dist2(p, a, b):
        px, py = xy(p)
        ax, ay = xy(a)
        bx, by = xy(b)
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return (px - ax) ** 2 + (py - ay) ** 2
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        cx, cy = ax + t * dx, ay + t * dy
        return (px - cx) ** 2 + (py - cy) ** 2

    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    tol2 = tol * tol
    while stack:
        i, j = stack.pop()
        best, idx = -1.0, -1
        for k in range(i + 1, j):
            dd = dist2(points[k], points[i], points[j])
            if dd > best:
                best, idx = dd, k
        if idx != -1 and best > tol2:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [p for p, k in zip(points, keep) if k]


def thin(points, maxn):
    """点数太多时按等间隔再抽"""
    if len(points) <= maxn:
        return points
    step = (len(points) - 1) / (maxn - 1)
    return [points[int(round(i * step))] for i in range(maxn)]


def main():
    if not KEY:
        sys.exit("缺少高德 Key：先设置环境变量 AMAP_KEY")

    places = load_js(PLACES, "PLACES")
    real = load_js(REAL_LEGS, "REAL_PAIRS")
    pm = {p["id"]: p for p in places}

    out = {}
    done = 0
    fail = 0
    for key in sorted(real.keys()):
        a_id, b_id = key.split("|")
        a, b = pm.get(a_id), pm.get(b_id)
        if not a or not b:
            continue
        dx = (b["longitude"] - a["longitude"]) * 111320 * math.cos(math.radians(a["latitude"]))
        dy = (b["latitude"] - a["latitude"]) * 111320
        dist = math.hypot(dx, dy)
        mode = "walk" if dist <= WALK_LIMIT else "drive"
        pts = path_of(a, b, mode)
        if not pts:
            fail += 1
        else:
            pts = thin(simplify(pts, TOL), MAX_POINTS)
            out[key] = [[round(x, 5), round(y, 5)] for x, y in pts]
        done += 1
        if done % 20 == 0:
            print(f"  进度 {done}/{len(real)}，失败 {fail}", flush=True)
        time.sleep(SLEEP)

    lines = []
    for k in sorted(out):
        seg = ", ".join(f"[{x}, {y}]" for x, y in out[k])
        lines.append(f"  '{k}': [{seg}],")

    js = (
        "/**\n"
        " * 任意两点之间的真实路径（由 scripts/fetch_pair_paths.py 生成，勿手改）\n"
        " * key 同 realLegs.js；value = [[经度, 纬度], ...]（已抽稀，最多 60 点）\n"
        " */\n"
        "const PAIR_PATHS = {\n" + "\n".join(lines) + "\n};\n\n"
        "module.exports = { PAIR_PATHS };\n"
    )
    OUT.write_text(js, encoding="utf-8")
    avg = sum(len(v) for v in out.values()) / max(1, len(out))
    print(f"\n完成：{len(out)} 条路径（失败 {fail}），平均 {avg:.0f} 点/条，{OUT.stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
