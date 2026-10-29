# -*- coding: utf-8 -*-
"""
给点位生成拼音索引（全拼 + 首字母），供搜索用
输出：miniprogram/data/pinyin.js

用法：python scripts/build_pinyin.py
依赖：pip install pypinyin
"""
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLACES = ROOT / "miniprogram" / "data" / "places.js"
OUT = ROOT / "miniprogram" / "data" / "pinyin.js"
NODE = os.environ.get("NODE_BIN") or "node"


def load_places():
    js = "console.log(JSON.stringify(require(String.raw`" + str(PLACES) + "`).PLACES))"
    out = subprocess.run([NODE, "-e", js], capture_output=True, text=True, encoding="utf-8")
    return json.loads(out.stdout)


def main():
    try:
        from pypinyin import lazy_pinyin, Style
    except ImportError:
        sys.exit("缺 pypinyin：pip install pypinyin")

    places = load_places()
    rows = []

    for p in places:
        name = p["name"]
        # 去掉括号里的补充说明，比如「火宫殿（坡子街总店）」→「火宫殿」
        main = re.split(r"[（(【\[]", name)[0].strip() or name
        full = "".join(lazy_pinyin(main, errors=lambda x: list(x.lower())))
        full = re.sub(r"[^a-z0-9]", "", full)
        initials = "".join(
            lazy_pinyin(main, style=Style.FIRST_LETTER, errors=lambda x: list(x.lower()))
        )
        initials = re.sub(r"[^a-z0-9]", "", initials)
        # 整个名字（含括号）也来一份，搜「海信广场」这类能中
        full_all = re.sub(r"[^a-z0-9]", "", "".join(lazy_pinyin(name, errors=lambda x: list(x.lower()))))
        rows.append({"id": p["id"], "py": full, "pyi": initials, "pyAll": full_all})

    lines = []
    for r in rows:
        lines.append(f"  {r['id']}: {{ py: '{r['py']}', pyi: '{r['pyi']}', pyAll: '{r['pyAll']}' }},")

    js = (
        "/**\n"
        " * 点位拼音索引（由 scripts/build_pinyin.py 生成，勿手改）\n"
        " * py: 全拼（去括号部分） / pyi: 首字母 / pyAll: 含括号的全拼\n"
        " */\n"
        "const PINYIN = {\n" + "\n".join(lines) + "\n};\n\n"
        "module.exports = { PINYIN };\n"
    )
    OUT.write_text(js, encoding="utf-8")
    print(f"完成：{len(rows)} 个点位 → {OUT}")
    for r in rows[:5]:
        print("  ", r)


if __name__ == "__main__":
    main()
