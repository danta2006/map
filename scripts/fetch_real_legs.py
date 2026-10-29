# -*- coding: utf-8 -*-
"""
预计算「我的行程」里任意两点之间的真实交通时间（同城、距离够近的点对）
- walk   : 直线 ≤ 3.0 km，走高德步行规划
- taxi   : 直线 ≤ 8.0 km，走高德驾车规划（打车时长≈驾车时长+1分钟等待，前端再加）
- transit: 直线 ≤ 8.0 km 且 ≥ 1.2 km，走高德公交规划（取最快方案）

输出：miniprogram/data/realLegs.js
  { "a|b": { walk: [米, 分钟], taxi: [米, 分钟], transit: [米, 分钟] } }
（键按 id 排序，双向通用）

用法（需要高德 Key）：
  $env:AMAP_KEY = "..."
  python scripts/fetch_real_legs.py
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
OUT = ROOT / "miniprogram" / "data" / "realLegs.js"
NODE = os.environ.get("NODE_BIN") or "node"
KEY = os.environ.get("AMAP_KEY", "").strip()
CITY_CODE = {"xiangtan": "430300", "changsha": "430100", "zhuzhou": "430200"}

WALK_LIMIT = 3000
TAXI_LIMIT = 8000
TRANSIT_MIN = 1200
TRANSIT_LIMIT = 8000
SLEEP = 0.32


def load_places():
    js = "console.log(JSON.stringify(require(String.raw`" + str(PLACES) + "`).PLACES))"
    out = subprocess.run([NODE, "-e", js], capture_output=True, text=True, encoding="utf-8")
    return json.loads(out.stdout)


def haversine(a, b):
    R = 6371000
    lat1, lng1 = math.radians(a["latitude"]), math.radians(a["longitude"])
    lat2, lng2 = math.radians(b["latitude"]), math.radians(b["longitude"])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def get(url, retry=3):
    for i in range(retry):
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            time.sleep(1.2 * (i + 1))
    return None


def walking(a, b):
    u = ("https://restapi.amap.com/v3/direction/walking?" + urllib.parse.urlencode({
        "origin": f'{a["longitude"]},{a["latitude"]}',
        "destination": f'{b["longitude"]},{b["latitude"]}',
        "key": KEY,
    }))
    d = get(u)
    if not d or d.get("status") != "1" or not d["route"]["paths"]:
        return None
    p = d["route"]["paths"][0]
    return [int(p["distance"]), max(1, round(int(p["duration"]) / 60))]


def driving(a, b):
    u = ("https://restapi.amap.com/v3/direction/driving?" + urllib.parse.urlencode({
        "origin": f'{a["longitude"]},{a["latitude"]}',
        "destination": f'{b["longitude"]},{b["latitude"]}',
        "key": KEY,
    }))
    d = get(u)
    if not d or d.get("status") != "1" or not d["route"]["paths"]:
        return None
    p = d["route"]["paths"][0]
    meters = int(p["distance"])
    minutes = max(1, round(int(p["duration"]) / 60))
    return [meters, minutes]


def transit(a, b, city):
    u = ("https://restapi.amap.com/v3/direction/transit/integrated?" + urllib.parse.urlencode({
        "origin": f'{a["longitude"]},{a["latitude"]}',
        "destination": f'{b["longitude"]},{b["latitude"]}',
        "city": CITY_CODE[city],
        "key": KEY,
    }))
    d = get(u)
    if not d or d.get("status") != "1" or not d["route"]["transits"]:
        return None
    best = min(d["route"]["transits"], key=lambda t: int(t["duration"]))
    meters = int(best["distance"])
    minutes = max(1, round(int(best["duration"]) / 60))
    return [meters, minutes]


def main():
    if not KEY:
        sys.exit("缺少高德 Key：先设置环境变量 AMAP_KEY")

    places = load_places()
    by_city = {}
    for p in places:
        by_city.setdefault(p["city"], []).append(p)

    out = {}
    total_pairs = 0
    calls = 0

    for city, items in by_city.items():
        n = len(items)
        for i in range(n):
            for j in range(i + 1, n):
                a, b = items[i], items[j]
                dist = haversine(a, b)
                if dist > TAXI_LIMIT:
                    continue
                key = "|".join(sorted([a["id"], b["id"]]))
                rec = out.get(key, {})
                total_pairs += 1

                if dist <= WALK_LIMIT and "walk" not in rec:
                    v = walking(a, b)
                    calls += 1
                    if v:
                        rec["walk"] = v
                    time.sleep(SLEEP)

                if "taxi" not in rec:
                    v = driving(a, b)
                    calls += 1
                    if v:
                        rec["taxi"] = v
                    time.sleep(SLEEP)

                if TRANSIT_MIN <= dist <= TRANSIT_LIMIT and "transit" not in rec:
                    v = transit(a, b, city)
                    calls += 1
                    if v:
                        rec["transit"] = v
                    time.sleep(SLEEP)

                if rec:
                    out[key] = rec
                if calls % 20 == 0:
                    print(f"  进度：{calls} 次请求 / {len(out)} 对已缓存", flush=True)

    lines = []
    for k in sorted(out):
        rec = out[k]
        parts = []
        for mode in ("walk", "taxi", "transit"):
            if mode in rec:
                parts.append(f"{mode}: [{rec[mode][0]}, {rec[mode][1]}]")
        lines.append(f"  '{k}': {{ {', '.join(parts)} }},")

    js = (
        "/**\n"
        " * 两点之间的真实交通时间（由 scripts/fetch_real_legs.py 生成，勿手改）\n"
        " * key = 两个点位 id 排序后用 | 连接；value = { walk/taxi/transit: [米, 分钟] }\n"
        " */\n"
        "const REAL_PAIRS = {\n" + "\n".join(lines) + "\n};\n\n"
        "module.exports = { REAL_PAIRS };\n"
    )
    OUT.write_text(js, encoding="utf-8")
    print(f"\n完成：{len(out)} 对点、{calls} 次请求 → {OUT}（{OUT.stat().st_size/1024:.0f} KB）")


if __name__ == "__main__":
    main()
