# -*- coding: utf-8 -*-
"""
给每条路线画沿道路的真实路径（高德路线规划返回的 polyline）

- 步行段：walking 接口 steps[].polyline
- 公交段：transit 接口最优方案的 步行 steps + 公交 buslines[].polyline
- 打车段：driving 接口 steps[].polyline

输出 _tmp/route_paths.json：{ routeId: [[lng,lat], ...] }，已经做过抽稀
然后由 _tmp/apply_paths.js 写进 miniprogram/data/routes.js
"""
import os
import json
import math
import shutil
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get("NODE_BIN") or shutil.which("node") or "node"
KEY = os.environ.get("AMAP_KEY", "").strip()
CITY_CODE = {"xiangtan": "430300", "changsha": "430100", "zhuzhou": "430200"}


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def parse_polyline(s):
    out = []
    if not s:
        return out
    for pair in s.split(";"):
        p = pair.split(",")
        if len(p) == 2:
            try:
                out.append([float(p[0]), float(p[1])])
            except ValueError:
                pass
    return out


def walk_path(o, d):
    u = ("https://restapi.amap.com/v3/direction/walking?"
         + urllib.parse.urlencode({"origin": o, "destination": d, "key": KEY}))
    data = get(u)
    if data.get("status") != "1" or not data["route"]["paths"]:
        return []
    path = []
    for st in data["route"]["paths"][0]["steps"]:
        path.extend(parse_polyline(st.get("polyline")))
    return path


def drive_path(o, d):
    u = ("https://restapi.amap.com/v3/direction/driving?"
         + urllib.parse.urlencode({"origin": o, "destination": d, "key": KEY}))
    data = get(u)
    if data.get("status") != "1" or not data["route"]["paths"]:
        return []
    path = []
    for st in data["route"]["paths"][0]["steps"]:
        path.extend(parse_polyline(st.get("polyline")))
    return path


def transit_path(o, d, city):
    u = ("https://restapi.amap.com/v3/direction/transit/integrated?"
         + urllib.parse.urlencode({"origin": o, "destination": d, "city": CITY_CODE[city], "key": KEY}))
    data = get(u)
    if data.get("status") != "1" or not data["route"]["transits"]:
        return []
    best = min(data["route"]["transits"], key=lambda t: int(t["duration"]))
    path = []
    for seg in best["segments"]:
        for st in (seg.get("walking") or {}).get("steps", []):
            path.extend(parse_polyline(st.get("polyline")))
        bus = seg.get("bus") or {}
        for line in bus.get("buslines", [])[:1]:
            path.extend(parse_polyline(line.get("polyline")))
    return path


def simplify(points, tol=0.00016):
    """Douglas-Peucker 抽稀（大约 15-20 米精度），点太少就原样返回"""
    if len(points) <= 2:
        return points
    lat0 = points[0][1]

    def xy(p):
        return (p[0] * math.cos(math.radians(lat0)), p[1])

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


def main():
    if not KEY:
        import sys as _sys
        _sys.exit("缺少高德 Key：先设置环境变量 AMAP_KEY（去 https://lbs.amap.com/ 免费申请 Web 服务 key）")
    js = "console.log(JSON.stringify(require(String.raw`" + str(ROOT / "miniprogram" / "data" / "routes.js") + "`).ROUTES))"
    routes = json.loads(subprocess.run([str(NODE), "-e", js], capture_output=True, text=True, encoding="utf-8").stdout)
    pj = "console.log(JSON.stringify(require(String.raw`" + str(ROOT / "miniprogram" / "data" / "places.js") + "`).PLACES))"
    pm = {p["id"]: p for p in json.loads(subprocess.run([str(NODE), "-e", pj], capture_output=True, text=True, encoding="utf-8").stdout)}

    out = {}
    out_legs = {}
    for r in routes:
        path = []
        leg_paths = []
        for leg in r["legs"]:
            a, b = pm[leg["from"]], pm[leg["to"]]
            o = f'{a["longitude"]},{a["latitude"]}'
            d = f'{b["longitude"]},{b["latitude"]}'
            mode = leg.get("mode", "walk")
            if mode == "walk":
                seg = walk_path(o, d)
                if not seg:
                    seg = drive_path(o, d)
            elif mode == "transit":
                seg = transit_path(o, d, r["city"])
                if not seg:
                    seg = walk_path(o, d)
            else:
                seg = drive_path(o, d)
            if not seg:
                seg = [[a["longitude"], a["latitude"]], [b["longitude"], b["latitude"]]]
            # 拼起来，去掉和上一段重复的首点
            if path and seg and abs(path[-1][0] - seg[0][0]) < 1e-7 and abs(path[-1][1] - seg[0][1]) < 1e-7:
                seg = seg[1:]
            path.extend(seg)
            leg_paths.append(simplify(seg))
        path = simplify(path)
        out_legs[r["id"]] = [[[round(x, 6), round(y, 6)] for x, y in lp] for lp in leg_paths]
        out[r["id"]] = [[round(x, 6), round(y, 6)] for x, y in path]
        print(f'{r["city"]:8s} {r["name"]:10s} 路径点 {len(path):3d} 个')

    p = ROOT / "_tmp" / "route_paths.json"
    p.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    p2 = ROOT / "_tmp" / "leg_paths.json"
    p2.write_text(json.dumps(out_legs, ensure_ascii=False), encoding="utf-8")
    print(f"\n✅ 写入 {p}（总点数 {sum(len(v) for v in out.values())}，约 {p.stat().st_size/1024:.0f} KB）")


if __name__ == "__main__":
    main()
