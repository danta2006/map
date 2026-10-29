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
| **用户反馈** | 小程序里提交的反馈在这里，可标「已处理 / 还原」、刷新、**从云端同步** |
| **社区路线** | 云端用户上传的路线：查看 + 删除（违规内容清理） |

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

## 后台联网（已接）：管理云端数据

后台现在能直接读/改**云开发**里的数据（不需要浏览器另开云控制台）。

### 一次性配置

把 `admin/.env.local.example` 复制成 **`admin/.env.local`**，填上：

```ini
WX_APPID=wx8f72fd67cbda3aa9
WX_APPSECRET=<小程序后台 AppSecret>
CLOUD_ENV=cloud1-d5ghzdcqba4c291f8
AMAP_KEY=<高德 Key>
```

> `admin/.env.local` 已在 `.gitignore`，**不会提交到 GitHub**；AppSecret 只存在于这台电脑上。

改完重启：`node admin/server.js`

### 能做什么

| 页签 / 按钮 | 作用 |
|---|---|
| **社区路线**（页签） | 列出云端 `user_routes` 全部路线：标题、作者、城市、站数、点赞、时间；每条可**删除** |
| 用户反馈 → **从云端同步** | 把云数据库 `feedback` 拉到本地（会与本地记录合并，不覆盖） |
| `/api/cloud-routes` | 列表接口（GET） |
| `/api/cloud-route-delete` | 删除一条社区路线，并清掉它的点赞记录（POST `{id}`） |
| `/api/sync-cloud` | 拉取云端反馈（POST） |

### 安全注意

1. AppSecret 等同小程序后台密码：只放 `.env.local`，不要发群里、不要写进代码；
2. 如果 AppSecret 曾发到聊天/截图里，建议去小程序后台**重置一次**，然后更新 `.env.local`；
3. 这个后台仍然只监听 `127.0.0.1`——本机使用，不对外开放。

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

## 接微信云开发（真机收集反馈）

代码已经准备好了，只差开通 + 填环境 ID：

1. 开发者工具顶部点「**云开发**」→ 开通（按提示实名；选最便宜的套餐/免费额度）
2. 创建一个环境，例如 `xiangtan-map`，记下**环境 ID**（形如 `xiangtan-map-1gxxxxxx`）
3. 把环境 ID 填到 `miniprogram/config.js` 的 `CLOUD_ENV`
4. 部署两个云函数（开发者工具里右键 `cloudfunctions/initEnv`、`ping` → 上传并部署；或命令行）：
   ```powershell
   cli cloud functions deploy --env <环境ID> --names initEnv ping --project C:\微信小程序
   ```
5. 调用一次 `initEnv`（云开发控制台 → 云函数 → initEnv → 测试，event 填 `{}`），它会建好 `feedback` 集合
6. 小程序里提交反馈 → 云开发控制台「数据库 → feedback」就能看到；真机也能写

### 后台同步云反馈（可选，需要 AppSecret）

后台想直接看云上的反馈，需要小程序的 **AppSecret**（后台「开发管理 → 开发设置」里，别泄露）：

```powershell
$env:AMAP_KEY   = "高德 Key"
$env:WX_APPID   = "wx8f72fd67cbda3aa9"
$env:WX_APPSECRET = "你的 AppSecret"
$env:CLOUD_ENV  = "xiangtan-map-1gxxxxxx"
node admin/server.js
```

然后后台「用户反馈」页签点「**从云端同步**」，会把最近 200 条拉进 `admin/data/feedback.json`。

> AppSecret 只在这台机器上用；不要提交到 git、不要发给别人。

## 常见问题

### 开通云开发时报 `tcbDescribeUserPromotionalActivity 失败 ... ret:1000 system error`

这是微信云开发控制台在拉「优惠活动」时服务端报错，不是项目代码问题。按顺序试：

1. 关掉云开发窗口，重新点开发者工具工具栏的云朵图标 ☁（多数是微信侧抖动，重试就好）
2. 重启微信开发者工具（或退出登录后重新扫码）
3. 确认已在 mp 后台完成**实名认证**、绑定**微信支付**（开通页要拉支付/优惠信息）
4. 升级开发者工具到最新稳定版（本项目测试版本 2.02.2609240 Stable，偏旧）

**已开通（2026-10-29 深夜）**：环境 ID `cloud1-d5ghzdcqba4c291f8`（免费试用），云函数 `initEnv` / `ping` / `userRoutes` 已部署，`feedback`、`user_routes`、`route_likes` 集合已创建；小程序反馈与社区路线（上传/点赞）已实测可用。
后台要把云上反馈同步到本地列表，需要 AppSecret：按下面命令重启后台后，在「用户反馈」页签点「从云端同步」。

**之前的报错记录（已恢复，留作备查）**

- 完全退出开发者工具、重开、再点云开发 → 仍报 `tcb/DescribeEnvs` ret=1000
- 命令行 `cli cloud env list` 同样报错，`reqId`：`5807387f-1793285353` / `1e580919-1793285499` / `c81c887-1793285728`
- 说明是微信侧对该 appid 的上游异常（或主体/认证不满足云开发条件），不是本地缓存或项目代码问题
- 处理建议：先在云开发控制台「反馈」或微信开放社区提工单（贴上面 reqId + AppID + 报错截图），确认账号能开通再付费（最低 ¥19.9/月）

**实在开不了就先跳过**：`miniprogram/config.js` 里 `CLOUD_ENV` 留空时，反馈会走「本地后台 → 本地存储」两级降级，开发者工具里提交的反馈在后台「用户反馈」页签照样能看到，不影响答辩演示。

## 目录## 目录

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
