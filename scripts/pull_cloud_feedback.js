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
      openid: doc._openid || ''
    };
  });

  const store = { feedback: list };
  fs.writeFileSync(OUT, JSON.stringify(store, null, 2), 'utf8');
  console.log(`已拉取 ${list.length} 条反馈 → admin/data/feedback.json`);
})().catch((e) => {
  console.error(String(e && e.message ? e.message : e));
  process.exit(1);
});
