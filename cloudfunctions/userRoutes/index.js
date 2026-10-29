// 云函数：社区路线（用户上传 + 点赞 + 列表）
// 集合：user_routes（路线）、route_likes（点赞去重）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MAX_STOPS = 20;
const MAX_TITLE = 30;
const MAX_DESC = 200;
const MAX_PER_USER = 10;

async function ensureCollections() {
  for (const name of ['user_routes', 'route_likes']) {
    try {
      await db.createCollection(name);
    } catch (e) {
      // 已存在会报错，忽略
    }
  }
}

function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanStops(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, MAX_STOPS)) {
    if (!s || !s.id) continue;
    const lat = Number(s.latitude);
    const lng = Number(s.longitude);
    if (!isFinite(lat) || !isFinite(lng)) continue;
    out.push({
      id: String(s.id).slice(0, 60),
      name: cleanText(s.name, 30),
      emoji: cleanText(s.emoji, 4),
      city: cleanText(s.city, 12),
      latitude: lat,
      longitude: lng
    });
  }
  return out;
}

async function list(event, openid) {
  const city = String(event.city || '');
  const where = {};
  if (['xiangtan', 'changsha', 'zhuzhou'].includes(city)) where.city = city;
  else if (city === 'mixed') where.city = 'mixed';

  const res = await db
    .collection('user_routes')
    .where(where)
    .orderBy('likes', 'desc')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();

  const ids = res.data.map((r) => r._id);
  const liked = {};
  if (ids.length && openid) {
    const l = await db
      .collection('route_likes')
      .where({ openid, routeId: _.in(ids) })
      .limit(50)
      .get();
    l.data.forEach((x) => {
      liked[x.routeId] = true;
    });
  }

  const routes = res.data.map((r) => ({
    id: r._id,
    title: r.title,
    desc: r.desc || '',
    city: r.city || 'mixed',
    nickname: r.nickname || '旅行者',
    count: (r.stops || []).length,
    likes: r.likes || 0,
    createdAt: r.createdAt || 0,
    stops: r.stops || [],
    liked: !!liked[r._id]
  }));

  return { ok: true, routes };
}

async function submit(event, openid) {
  if (!openid) return { ok: false, error: '没有拿到身份，请在小程序里提交' };

  const stops = cleanStops(event.stops);
  if (stops.length < 2) return { ok: false, error: '至少要有 2 个点才能存成路线' };
  if (stops.length > MAX_STOPS) return { ok: false, error: `最多 ${MAX_STOPS} 个点` };

  const mine = await db.collection('user_routes').where({ openid }).count();
  if (mine.total >= MAX_PER_USER) return { ok: false, error: `每人最多上传 ${MAX_PER_USER} 条` };

  const title = cleanText(event.title, MAX_TITLE) || '我的路线';
  const desc = cleanText(event.desc, MAX_DESC);
  const nickname = cleanText(event.nickname, 20) || '旅行者';

  const cities = [...new Set(stops.map((s) => s.city).filter(Boolean))];
  const city = cities.length === 1 ? cities[0] : 'mixed';

  const doc = {
    title,
    desc,
    nickname,
    city,
    stops,
    likes: 0,
    createdAt: Date.now(),
    openid
  };
  const res = await db.collection('user_routes').add({ data: doc });
  return { ok: true, id: res._id };
}

async function like(event, openid) {
  if (!openid) return { ok: false, error: '没有拿到身份，请在小程序里点赞' };
  const routeId = String(event.routeId || '');
  if (!routeId) return { ok: false, error: '缺少路线 id' };

  const route = await db.collection('user_routes').doc(routeId).get();
  if (!route.data) return { ok: false, error: '路线不存在' };

  const hit = await db.collection('route_likes').where({ routeId, openid }).limit(1).get();
  let liked;
  if (hit.data.length) {
    await db.collection('route_likes').doc(hit.data[0]._id).remove();
    await db.collection('user_routes').doc(routeId).update({ data: { likes: _.inc(-1) } });
    liked = false;
  } else {
    await db.collection('route_likes').add({ data: { routeId, openid, createdAt: Date.now() } });
    await db.collection('user_routes').doc(routeId).update({ data: { likes: _.inc(1) } });
    liked = true;
  }

  const after = await db.collection('user_routes').doc(routeId).get();
  return { ok: true, liked, likes: Math.max(0, (after.data && after.data.likes) || 0) };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  await ensureCollections();

  const action = String((event && event.action) || 'list');
  try {
    if (action === 'list') return await list(event || {}, OPENID);
    if (action === 'submit') return await submit(event || {}, OPENID);
    if (action === 'like') return await like(event || {}, OPENID);
    return { ok: false, error: '未知操作：' + action };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};
