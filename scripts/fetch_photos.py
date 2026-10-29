# -*- coding: utf-8 -*-
"""
从高德「地点搜索」拉每个点位的实景照片，存到 assets/photos-src/<id>.jpg
（extensions=all 时返回 photos 字段）

用法：
    python scripts/fetch_photos.py            # 拉全部缺图的点位
    python scripts/fetch_photos.py --force    # 全部重拉
    python scripts/fetch_photos.py --only wanlou,maozedong
"""
import argparse
import os
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLACES = ROOT / "miniprogram" / "data" / "places.js"
SRC = ROOT / "assets" / "photos-src"
KEY = os.environ.get("AMAP_KEY", "").strip()
CITY_CODE = {"xiangtan": "430300", "changsha": "430100", "zhuzhou": "430200"}


def load_places():
    js = "console.log(JSON.stringify(require(String.raw`" + str(PLACES) + "`).PLACES))"
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8")
    return json.loads(out.stdout)


def http_json(url):
    with urllib.request.urlopen(url, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def search_poi(name, city):
    url = (
        "https://restapi.amap.com/v3/place/text?"
        + urllib.parse.urlencode(
            {"keywords": name, "city": CITY_CODE[city], "citylimit": "true",
             "extensions": "all", "offset": 10, "page": 1, "key": KEY}
        )
    )
    data = http_json(url)
    if data.get("status") != "1":
        return None, data.get("info") or "接口失败"
    pois = data.get("pois") or []
    best, best_score = None, 0
    for p in pois:
        pname = (p.get("name") or "").replace(" ", "")
        score = 0
        if pname == name:
            score = 4
        elif name in pname or pname in name:
            score = 3
        elif pname.startswith(name[:2]):
            score = 1
        if score == 0:
            continue
        if p.get("photos"):
            score += 1
        if score > best_score:
            best, best_score = p, score
    return best, "ok"


def download(url, dst):
    url = url.replace("http://", "https://", 1)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        data = r.read()
    if len(data) < 4000:
        return False
    dst.write_bytes(data)
    return True


def main():
    if not KEY:
        import sys as _sys
        _sys.exit("缺少高德 Key：先设置环境变量 AMAP_KEY（去 https://lbs.amap.com/ 免费申请 Web 服务 key）")
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="")
    args = ap.parse_args()

    SRC.mkdir(parents=True, exist_ok=True)
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    places = [p for p in load_places() if not only or p["id"] in only]

    ok, skip, fail = 0, 0, []
    for i, p in enumerate(places, 1):
        dst = SRC / f'{p["id"]}.jpg'
        if dst.exists() and not args.force:
            skip += 1
            continue

        poi, info = search_poi(p["name"], p["city"])
        if not poi:
            fail.append(f'{p["name"]}（{info}）')
            print(f'  ✗ {p["name"]}: {info}')
            time.sleep(0.35)
            continue

        photos = poi.get("photos") or []
        if not photos:
            fail.append(f'{p["name"]}（无照片）')
            print(f'  ✗ {p["name"]}: 该 POI 没有照片')
            time.sleep(0.35)
            continue

        got = False
        for ph in photos[:2]:
            try:
                if download(ph["url"], dst):
                    got = True
                    break
            except Exception as e:
                print(f'  ! {p["name"]} 下载失败: {e}')
        if got:
            ok += 1
            print(f'  ✓ {p["name"]:<18} {dst.stat().st_size/1024:5.0f} KB')
        else:
            fail.append(f'{p["name"]}（下载失败）')
        time.sleep(0.35)

    print(f"\n完成：新下载 {ok} 张，跳过已有 {skip} 张，失败 {len(fail)} 个")
    if fail:
        print("失败清单：")
        for f in fail:
            print("  -", f)
        print("\n可以手动补：把图片存成 assets/photos-src/<点位id>.jpg")


if __name__ == "__main__":
    main()
