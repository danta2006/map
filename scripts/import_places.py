# -*- coding: utf-8 -*-
"""
把《长株潭点位采集表-v3.xlsx》导入成小程序数据：miniprogram/data/places.js

表格结构（v3，坐标已由脚本自动填好）：
  ① 选点  —— 第 1 行表头：A 编号 / B 城市 / C 名称 / D 分类 / E 经度 / F 纬度 / G 地址 / H 保留 / I 备注
  ② 文案  —— 第 1 行表头：A 编号 / B 名称 / C 一句话 / D 简介 / E 备注或补充 / F 建议时长 / G 开放时间

用法：
    python scripts/import_places.py --xlsx docs/长株潭点位采集表-v3.xlsx --city xiangtan --check
    python scripts/import_places.py --xlsx docs/长株潭点位采集表-v3.xlsx --city xiangtan

规则：
- 只导入「保留 = 是」的行；「否」跳过，「待定」跳过并提醒
- 坐标用表里的 E/F（已由高德接口填好）；经度必须 112.x、纬度 27.x/28.x（长株潭）
- 导入某个城市时，只替换这个城市的点位，其它城市原样保留
- 已有点位按名称匹配，保留 id / emoji / 标签
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_XLSX = ROOT / "docs" / "长株潭点位采集表-v3.xlsx"
DEFAULT_OUT = ROOT / "miniprogram" / "data" / "places.js"

CAT_CN2KEY = {"景点": "scenic", "古镇街区": "oldtown", "红色": "red", "学府": "school", "美食": "food"}
CAT_EMOJI = {"scenic": "🏯", "oldtown": "🏮", "red": "🚩", "school": "🎓", "food": "🍜"}
CITY_CN2ID = {"湘潭": "xiangtan", "长沙": "changsha", "株洲": "zhuzhou"}
CITY_NAMES = {"湘潭", "长沙", "株洲"}
LNG_RANGE = (111.8, 114.3)
LAT_RANGE = (25.9, 28.7)

# ① 选点
C1 = {"no": 1, "city": 2, "name": 3, "cat": 4, "lng": 5, "lat": 6, "address": 7, "keep": 8, "why": 9}
# ② 文案
C2 = {"no": 1, "name": 2, "summary": 3, "intro": 4, "note": 5, "duration": 6, "open": 7}


def load_existing():
    js = "console.log(JSON.stringify(require(String.raw`" + str(DEFAULT_OUT) + "`).PLACES))"
    try:
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=30)
        if out.returncode != 0:
            return []
        return json.loads(out.stdout)
    except Exception:
        return []


def to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("，", ",").replace(" ", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def js_str(s):
    s = "" if s is None else str(s)
    s = s.replace("\\", "\\\\").replace("'", "\\'").replace("\r", "").replace("\n", "\\n")
    return "'" + s + "'"


def pick_sheet(wb, prefix):
    for name in wb.sheetnames:
        if name.replace(" ", "").startswith(prefix):
            return wb[name]
    return None


def build_row_js(p, has_next):
    def num(v):
        return f"{v:.6f}".rstrip("0").rstrip(".")

    fields = [
        ("id", js_str(p["id"])),
        ("name", js_str(p["name"])),
        ("city", js_str(p["city"])),
        ("category", js_str(p["category"])),
        ("emoji", js_str(p["emoji"])),
        ("tags", "[" + ", ".join(js_str(t) for t in p["tags"]) + "]"),
        ("latitude", num(p["latitude"])),
        ("longitude", num(p["longitude"])),
        ("summary", js_str(p["summary"])),
        ("intro", js_str(p["intro"])),
        ("note", js_str(p["note"])),
        ("address", js_str(p["address"])),
        ("openTime", js_str(p["openTime"])),
        ("durationMin", str(int(p["durationMin"]))),
    ]
    body = "\n".join(f"    {k}: {v}{',' if i < len(fields) - 1 else ''}" for i, (k, v) in enumerate(fields))
    return "  {\n" + body + "\n  }" + ("," if has_next else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", default=str(DEFAULT_XLSX))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--city", required=True, help="要导入哪个城市：xiangtan / changsha / zhuzhou")
    ap.add_argument("--check", action="store_true", help="只校验，不写文件")
    args = ap.parse_args()

    if args.city not in ("xiangtan", "changsha", "zhuzhou"):
        sys.exit(f"未知城市 {args.city}，只支持 xiangtan / changsha / zhuzhou")

    xlsx = Path(args.xlsx)
    if not xlsx.exists():
        sys.exit(f"找不到表格：{xlsx}")
    wb = load_workbook(xlsx, data_only=True)

    ws1 = pick_sheet(wb, "①")
    ws2 = pick_sheet(wb, "②")
    if ws1 is None:
        sys.exit(f"表格里没找到「① 选点」，现有 sheet：{wb.sheetnames}")
    if str(ws1.cell(row=1, column=2).value).strip() != "城市":
        sys.exit("表格不是 v3 格式（第 1 行 B 列应该是「城市」）")

    # ② 文案 按编号建索引
    copy = {}
    if ws2 is not None:
        for row in range(2, ws2.max_row + 1):
            no = str(ws2.cell(row=row, column=C2["no"]).value or "").strip()
            if not no:
                continue
            copy["no:" + no] = {
                "summary": ws2.cell(row=row, column=C2["summary"]).value,
                "intro": ws2.cell(row=row, column=C2["intro"]).value,
                "note": ws2.cell(row=row, column=C2["note"]).value,
                "duration": ws2.cell(row=row, column=C2["duration"]).value,
                "open": ws2.cell(row=row, column=C2["open"]).value,
            }

    existing = load_existing()
    by_name = {p["name"]: p for p in existing}
    places, errors, warns = [], [], []
    skipped_pending = 0
    skipped_no = 0

    for row in range(2, ws1.max_row + 1):
        city_cn = str(ws1.cell(row=row, column=C1["city"]).value or "").strip()
        name = str(ws1.cell(row=row, column=C1["name"]).value or "").strip()
        if not name and not city_cn:
            continue
        if city_cn != CITY_CN2ID.get(args.city) and CITY_CN2ID.get(city_cn) != args.city:
            continue  # 不是这次要导入的城市
        keep = str(ws1.cell(row=row, column=C1["keep"]).value or "").strip()
        if keep == "否":
            skipped_no += 1
            continue
        if keep != "是":
            skipped_pending += 1
            continue

        cat_cn = str(ws1.cell(row=row, column=C1["cat"]).value or "").strip()
        if cat_cn not in CAT_CN2KEY:
            errors.append(f"第 {row} 行「{name}」：分类「{cat_cn}」不认识")
            continue
        if not name:
            errors.append(f"第 {row} 行：名称为空")
            continue

        lng = to_float(ws1.cell(row=row, column=C1["lng"]).value)
        lat = to_float(ws1.cell(row=row, column=C1["lat"]).value)
        if lng is None or lat is None:
            errors.append(f"第 {row} 行「{name}」：经纬度为空（重新跑 scripts/make_form.py 自动填）")
            continue
        if LAT_RANGE[0] < lng < LAT_RANGE[1] and LNG_RANGE[0] < lat < LNG_RANGE[1]:
            errors.append(f"第 {row} 行「{name}」：经纬度填反了（E 是经度 112.x，F 是纬度 27/28.x）")
            continue
        if not (LNG_RANGE[0] < lng < LNG_RANGE[1]) or not (LAT_RANGE[0] < lat < LAT_RANGE[1]):
            errors.append(f"第 {row} 行「{name}」：坐标不在长株潭范围（经度 {lng}，纬度 {lat}）")
            continue

        no = str(ws1.cell(row=row, column=C1["no"]).value or "").strip()
        c = copy.get("no:" + no, {}) if no else {}
        old = by_name.get(name, {})
        category = CAT_CN2KEY[cat_cn]

        summary = str(c.get("summary") or old.get("summary") or "").strip()
        intro = str(c.get("intro") or old.get("intro") or "").strip()
        note = str(c.get("note") or old.get("note") or "").strip()
        address = str(ws1.cell(row=row, column=C1["address"]).value or old.get("address") or "").strip()
        duration = to_float(c.get("duration")) or old.get("durationMin") or 60
        open_time = str(c.get("open") or old.get("openTime") or "").strip() or "全天"

        if not summary:
            warns.append(f"第 {row} 行「{name}」：一句话为空，先用名称顶上")
        if len(summary) > 30:
            warns.append(f"第 {row} 行「{name}」：一句话 {len(summary)} 字，超过 30 字装不下")
        if not intro:
            warns.append(f"第 {row} 行「{name}」：简介为空")

        places.append({
            "id": old.get("id") or f"p{no or row:0>3}",
            "name": name,
            "city": args.city,
            "category": category,
            "emoji": old.get("emoji") or CAT_EMOJI[category],
            "tags": old.get("tags", []),
            "latitude": lat,
            "longitude": lng,
            "summary": summary or name,
            "intro": intro or f"{name}的介绍待补充。",
            "note": note,
            "address": address or "长株潭",
            "openTime": open_time,
            "durationMin": duration,
        })

    # 保留其它城市的点位
    others = [p for p in existing if p.get("city") and p["city"] != args.city]
    places.extend(others)

    seen = set()
    for p in places:
        if p["name"] in seen:
            errors.append(f"名称重复：「{p['name']}」出现了两次")
        seen.add(p["name"])
    ids = set()
    for p in places:
        if p["id"] in ids:
            p["id"] += "b"
        ids.add(p["id"])

    city_cn = {"xiangtan": "湘潭", "changsha": "长沙", "zhuzhou": "株洲"}[args.city]
    print(f"读取：{xlsx}")
    print(f"导入城市：{city_cn} | 保留=是 {len(places) - len(others)} 行，保留=否 {skipped_no} 行，待定跳过 {skipped_pending} 行")
    print(f"合并后总点位：{len(places)} 个")
    if errors:
        print(f"\n❌ 错误 {len(errors)} 条（这些行不会导入）：")
        for e in errors:
            print("  -", e)
    if warns:
        print(f"\n⚠️ 提醒 {len(warns)} 条：")
        for w in warns[:12]:
            print("  -", w)
        if len(warns) > 12:
            print(f"  … 还有 {len(warns) - 12} 条")
    if errors:
        print("\n先修完错误再导入。")
        sys.exit(1)

    if args.check:
        print("\n✅ 校验通过（--check 模式，没有写文件）")
        return

    js_path = Path(args.out)
    text = js_path.read_text(encoding="utf-8")
    start = text.index("const PLACES = [")
    end = text.index("\n];", start) + len("\n];")
    body = "const PLACES = [\n" + "\n".join(
        build_row_js(p, i < len(places) - 1) for i, p in enumerate(places)
    ) + "\n];"
    js_path.write_text(text[:start] + body + text[end:], encoding="utf-8")
    print(f"\n✅ 已写入 {js_path}（{len(places)} 个点位）")


if __name__ == "__main__":
    main()
