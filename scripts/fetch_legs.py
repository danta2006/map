# -*- coding: utf-8 -*-
"""给每条路线相邻两站拉真实交通方式（高德路线规划），输出 _tmp/legs.json"""
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

ROUTES = [
    {"id": "oldtown", "city": "xiangtan", "name": "老城湘江线",
     "stops": ["wanlou", "wenmiao", "guanxiangmen", "shibazong", "yaowan", "yangmeizhou"]},
    {"id": "shaoshan", "city": "xiangtan", "name": "红色韶山线",
     "stops": ["tongxiang", "maozedong", "dishuidong"]},
    {"id": "campus", "city": "xiangtan", "name": "学府新城线",
     "stops": ["hnust", "xtu", "hnie"]},
    {"id": "hexi", "city": "changsha", "name": "河西文化线",
     "stops": ["yuelushuyuan", "yuelushan", "hnu", "juzizhou"]},
    {"id": "wuyi", "city": "changsha", "name": "五一商圈小吃线",
     "stops": ["taipingjie", "huogongdian", "huangxinglu", "wenheyou", "dufujiangge"]},
    {"id": "shennong", "city": "zhuzhou", "name": "神农城线",
     "stops": ["shennongta", "shennonghu", "yandiguangchang"]},
    {"id": "shifeng", "city": "zhuzhou", "name": "石峰公园线",
     "stops": ["qiujin", "shifeng"]},
]


def places():
    js = "console.log(JSON.stringify(require(String.raw`" + str(ROOT / "miniprogram" / "data" / "places.js") + "`).PLACES))"
    out = subprocess.run([str(NODE), "-e", js], capture_output=True, text=True, encoding="utf-8")
    return {p["id"]: p for p in json.loads(out.stdout)}


def haversine(a, b):
    R = 6371000
    lat1, lng1 = math.radians(a[1]), math.radians(a[0])
    lat2, lng2 = math.radians(b[1]), math.radians(b[0])
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def walking(o, d):
    u = ("https://restapi.amap.com/v3/direction/walking?"
         + urllib.parse.urlencode({"origin": o, "destination": d, "key": KEY}))
    data = get(u)
    if data.get("status") != "1" or not data["route"]["paths"]:
        return None
    p = data["route"]["paths"][0]
    meters = int(p["distance"])
    minutes = max(1, round(int(p["duration"]) / 60))
    return {"mode": "walk", "distance": meters, "minutes": minutes,
            "text": f"步行 {meters/1000:.1f} 公里，约 {minutes} 分钟"}


def transit(o, d, city):
    u = ("https://restapi.amap.com/v3/direction/transit/integrated?"
         + urllib.parse.urlencode({"origin": o, "destination": d, "city": CITY_CODE[city], "key": KEY}))
    data = get(u)
    if data.get("status") != "1" or not data["route"]["transits"]:
        return None
    best = min(data["route"]["transits"], key=lambda t: int(t["duration"]))
    lines = []
    for seg in best["segments"]:
        bus = seg.get("bus", {})
        if bus.get("buslines"):
            lines.append(bus["buslines"][0]["name"].split("(")[0])
    minutes = max(1, round(int(best["duration"]) / 60))
    meters = int(best["distance"])
    walk = int(best.get("walking_distance") or 0)
    line_txt = " → ".join(lines) if lines else "公交"
    extra = f"，步行 {walk} 米" if walk > 200 else ""
    return {"mode": "transit", "distance": meters, "minutes": minutes, "lines": lines,
            "text": f"{line_txt}，约 {minutes} 分钟{extra}"}


def main():
    if not KEY:
        import sys as _sys
        _sys.exit("缺少高德 Key：先设置环境变量 AMAP_KEY（去 https://lbs.amap.com/ 免费申请 Web 服务 key）")
    pm = places()
    result = {}
    for r in ROUTES:
        legs = []
        for a, b in zip(r["stops"], r["stops"][1:]):
            pa, pb = pm[a], pm[b]
            o = f'{pa["longitude"]},{pa["latitude"]}'
            d = f'{pb["longitude"]},{pb["latitude"]}'
            dist = haversine((pa["longitude"], pa["latitude"]), (pb["longitude"], pb["latitude"]))
            w = walking(o, d)
            t = transit(o, d, r["city"])

            # 选择规则：能走就走；走不动看公交；都不合适就建议打车
            if w and w["minutes"] <= 45 and w["distance"] <= max(2500, dist * 1.8):
                leg = w
            elif t and t["minutes"] <= 60:
                leg = t
            else:
                taxi_min = max(3, round(dist / 1000 / 25 * 60))
                leg = {"mode": "taxi", "distance": int(dist), "minutes": taxi_min,
                       "text": f"打车约 {dist/1000:.1f} 公里，{taxi_min} 分钟（公交不划算）"}
            leg["from"] = a
            leg["to"] = b
            legs.append(leg)
            print(f'{r["name"]}: {pa["name"]} → {pb["name"]} | {leg["text"]}')
        result[r["id"]] = legs
    out = ROOT / "_tmp" / "legs.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n✅ 写入 {out}")


if __name__ == "__main__":
    main()
