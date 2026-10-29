# 内容后台（本地）

一个**零依赖**的本地管理后台：改点位文案、调路线站点顺序、改城市默认视野，然后一键导出成小程序的数据文件。

## 启动

```powershell
node admin/server.js
```

浏览器打开 **http://127.0.0.1:8787**

- 改了内容点「保存」，会写到 `admin/data/*.json`
- 再点右上「导出到小程序」，会生成 `miniprogram/data/places.js`、`routes.js`、`cities.js`
- 导出后用微信开发者工具重新编译就能看到

## 目录

```
admin/
├── server.js        # 无依赖 HTTP 服务（API + 静态页面）
├── export.js        # JSON → miniprogram/data/*.js
├── init-data.js     # 一次性：把现有 data/*.js 反向导成 JSON
├── data/            # 唯一数据源（可直接改，也可以走界面）
│   ├── places.json
│   ├── routes.json
│   ├── cities.json
│   └── categories.json
└── public/          # 管理界面（原生 HTML/JS/CSS）
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/data` | 一次拿全部数据（places/routes/cities/categories） |
| POST | `/api/save` | body: `{ name, data }`，写 `admin/data/<name>.json` |
| POST | `/api/export` | 生成小程序数据文件，返回每个文件条目数 |
| GET | `/api/health` | 健康检查 |

## 能改什么

| 页面 | 可改 |
|---|---|
| 精选路线 | 名称、城市、颜色、简介、站点顺序（每行一个点位 id） |
| 点位 | 名称、emoji、分类、一句话、标签、简介、备注、地址、开放时间、建议时长、经纬度 |
| 城市 | 默认中心经纬度、默认缩放 |

## 注意

1. **路线改了站点顺序后，交通段（legs）/折线（path）不会自动重算**。要重算就跑：
   ```powershell
   $env:AMAP_KEY = "..."
   python scripts/fetch_legs.py
   python scripts/fetch_route_paths.py
   node _tmp/apply_paths.js
   ```
   （这一步需要高德 Key；没有 Key 时保持原顺序就不会有问题）
2. 后台是**本地内容管理工具**，不是线上运行时接口：小程序端仍然读打包进去的静态数据，这样演示最稳、也不受域名备案限制。
   要改成真·线上后端（云开发/HTTPS 接口），见 README 的「后续计划」。
3. `admin/data/*.json` 是唯一数据源；`miniprogram/data/*.js` 是导出产物，别手改后者（会被覆盖）。
4. `realLegs.js`、`pairPaths.js`、`pinyin.js`、`photos.js` 不归后台管，由各自的脚本生成。
