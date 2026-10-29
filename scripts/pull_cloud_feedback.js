// 从微信云开发拉取反馈，写进 admin/data/feedback.json
// 需要环境变量：WX_APPID / WX_APPSECRET / CLOUD_ENV
const fs = require('fs');
const path = require('path');

const APPID = process.env.WX_APPID || '';
const SECRET = process.env.WX_APPSECRET || '';
const ENV = process.env.CLOUD_ENV || '';
const OUT = path.join(__dirname, '..', 'admin', 'data', 'feedback.json');

if (!APPID || !SECRET || !ENV) {
  console.error('缺少环境变量：WX_APPID / WX_APPSECRET / CLOUD_ENV');
  process.exit(1);
}

async function getToken() {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${APPID}&secret=${SECRET}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.access_token) throw new Error('拿 access_token 失败：' + JSON.stringify(json));
  return json.access_token;
}

async function query(token, queryStr) {
  const res = await fetch(`https://api.weixin.qq.com/tcb/databasequery?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env: ENV, query: queryStr })
  });
  const json = await res.json();
  if (json.errcode) throw new Error('查询失败：' + JSON.stringify(json));
  return json;
}

(async () => {
  const token = await getToken();
  const res = await query(
    token,
    'db.collection("feedback").orderBy("at", "desc").limit(200).get()'
  );
  const list = (res.data || []).map((it) => {
    let doc = {};
    try {
      doc = typeof it === 'string' ? JSON.parse(it) : it;
    } catch (e) {
      doc = {};
    }
    return {
      id: doc._id || doc.id || '',
      at: doc.at || 0,
      text: doc.text || '',
      contact: doc.contact || '',
      placeId: doc.placeId || '',
      placeName: doc.placeName || '',
      page: doc.page || '',
      status: doc.status || 'new',
      openid: doc.openid || doc._openid || ''
    };
  });

  // 合并：云端的为准，但本地已有、云端没同步到的条目保留（避免覆盖后台手动记录）
  let local = [];
  try {
    local = JSON.parse(fs.readFileSync(OUT, 'utf8')).feedback || [];
  } catch (e) {
    local = [];
  }
  const cloudIds = new Set(list.map((x) => x.id));
  const merged = list.concat(local.filter((x) => x.id && x.id !== 'fb_demo_1' && !cloudIds.has(x.id)));
  merged.sort((a, b) => (b.at || 0) - (a.at || 0));
  const capped = merged.slice(0, 2000);
  fs.writeFileSync(OUT, JSON.stringify({ feedback: capped }, null, 2), 'utf8');
  console.log(`已拉取 ${list.length} 条云端反馈，合并后共 ${capped.length} 条 → admin/data/feedback.json（该文件不入库）`);
})().catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
