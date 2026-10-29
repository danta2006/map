# 内容后台（本地）

一个**零依赖**的本地管理后台：改点位文案、调路线站点顺序、增删点位/路线、看用户反馈，然后一键导出成小程序的数据文件。

## 启动

```powershell
$env:AMAP_KEY = "你的高德 Key"   # 可选：要用「重算交通/路径」按钮才需要
node admin/server.js
```

浏览器打开 **http://127.0.0.1:8787**

## 功能

| 页签 | 能做什么 |
|---|---|
| 精选路线 | 改名称/城市/颜色/简介/站点顺序；**＋ 新增路线**；**删除路线** |
| 点位 | 改文案/地址/开放时间/分类/经纬度；**＋ 新增点位**；**删除点位**；搜名称或 id |
| 城市 | 默认中心经纬度、默认缩放 |
| **用户反馈** | 小程序里提交的反馈在这里，可标「已处理 / 还原」、刷新 |

右上角按钮：

| 按钮 | 作用 |
|---|---|
| **重算交通/路径** | 调 `fetch_legs.py`（路线交通）/ `fetch_pair_paths.py`（两点路径）/ `fetch_photos.py`（照片），需要启动时设置 `AMAP_KEY` |
| **导出到小程序** | 生成 `miniprogram/data/{places,routes,cities}.js` |

## 数据流

```
admin/data/*.json   ← 唯一数据源（界面保存 / 手改都行）
        │
        ├─ 导出 → miniprogram/data/{places,routes,cities}.js → 开发者工具编译
        └─ 重算 → 调 scripts/*.py（高德接口）→ 写 data/realLegs.js / pairPaths.js / photos
```

## 新增一个点位 / 一条路线的正确姿势

1. 后台「＋ 新增点位」填 id（英文唯一）、城市、分类 → 保存
2. 到「点位」里把名称、文案、经纬度补齐 → 保存
3. 「＋ 新增路线」填 id、城市、站点 id 顺序（逗号分隔）→ 保存
4. 点「**重算交通/路径**」→ 选 `legs`（路线交通）→ 等几分钟
5. 点「**导出到小程序**」→ 开发者工具里编译看效果

> 新增的点位没有实景图，气泡会退化成分类型彩色 pin，不影响功能。

## 用户反馈

**小程序端**：详情页底部「发现信息有误？点这里反馈 ›」→ 填描述/联系方式 → 提交。

**后台端**：「用户反馈」页签实时看到（本地演示时）：

```
2026/10/29 22:28   万楼 · detail
开放时间写错了，实际是 09:00-17:30
联系方式：微信：xiaoming
[标记已处理]
```

接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/feedback` | 小程序提交，body `{text, contact, placeId, placeName, page}` |
| GET | `/api/feedback` | 后台列表 |
| POST | `/api/save` | `{name, data}`，name 支持 `feedback` 时就是改状态 |

### 限制（要说清楚）

- 这是**本机 127.0.0.1 服务**：开发者工具里能提交；**真机 / 体验版连不上**，会退化成"存本地 + toast 提示"
- 想在真机收集，要走**微信云开发**（不需要域名备案），方案见下

## 接微信云开发（真机收集反馈的推荐方案）

1. 开发者工具里点「云开发」→ 开通（个人主体可用，有免费额度）→ 记下环境 ID
2. 建集合 `feedback`，权限设为「仅创建者可写、所有人可读」或「仅管理端可读写」
3. 小程序里加：
   ```js
   wx.cloud.init({ env: '你的环境ID' });
   wx.cloud.database().collection('feedback').add({ data: { ...payload, at: Date.now() } });
   ```
   （替换 `miniprogram/utils/api.js` 里的 HTTP 提交，失败兜底逻辑保留）
4. 后台看反馈：云开发控制台「数据库 → feedback」直接看；或用云开发 HTTP API 把数据同步到本地 `admin/data/feedback.json`，这个后台的「用户反馈」页签就能继续用
5. 需要云函数做校验/频率限制时再加 `cloudfunctions/submitFeedback`

## 目录

```
admin/
├── server.js        # HTTP 服务（API + 静态页面 + 重算脚本）
├── export.js        # JSON → miniprogram/data/*.js
├── init-data.js     # 一次性：把现有 data/*.js 反向导成 JSON
├── data/            # 唯一数据源
│   ├── places.json / routes.json / cities.json / categories.json
│   └── feedback.json
└── public/          # 管理界面（原生 HTML/JS/CSS）
```

## 注意

1. 路线改了站点顺序 / 新增点位后，交通段和折线不会自动重算，点「重算交通/路径」或手动跑脚本
2. 后台是**本地内容管理工具**，小程序端读打包进去的静态数据（演示最稳、不用备案域名）
3. `miniprogram/data/*.js` 是导出产物，别手改；`realLegs.js`、`pairPaths.js`、`pinyin.js`、`photos.js` 由各自脚本生成
