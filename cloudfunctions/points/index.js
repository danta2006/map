// 云函数：积分（跨设备只记账「邀请奖励」这类必须服务端确认的分）
//
// 集合：
//   points_profile  { openid, uid, nick, total, invitedBy, firstRouteAt, createdAt }
//   points_awards   { openid, key, type, amount, note, at }   key 在同一个 openid 下幂等
//
// action：
//   profile      { nick }                 → { ok, uid, total, awards:[...最近 50 条] }
//   bindInviter  { inviterUid }           → 记录邀请人（只记第一次）
//   routeDone    { nick }                 → 首次完成路线；有邀请人则给邀请人 +25
//   award        { type, key, amount, note } → 幂等记一笔（保留给以后的服务端校验）
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const INVITE_POINTS = 25;

function clean(s, max) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

async function ensure() {
  for (const name of ['points_profile', 'points_awards']) {
    try {
      await db.createCollection(name);
    } catch (e) {
      // 已存在会报错，忽略
    }
  }
}

async function getProfile(openid) {
  const hit = await db.collection('points_profile').where({ openid }).limit(1).get();
  if (hit.data.length) return hit.data[0];
  const doc = {
    openid,
    uid: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    nick: '',
    total: 0,
    invitedBy: '',
    firstRouteAt: 0,
    createdAt: Date.now()
  };
  const res = await db.collection('points_profile').add({ data: doc });
  doc._id = res._id;
  return doc;
}

async function addAward(openid, type, key, amount, note) {
  const hit = await db.collection('points_awards').where({ openid, key }).limit(1).get();
  if (hit.data.length) return { ok: true, dup: true };
  await db.collection('points_awards').add({
    data: { openid, key, type, amount, note: clean(note, 40), at: Date.now() }
  });
  await db
    .collection('points_profile')
    .where({ openid })
    .update({ data: { total: db.command.inc(amount) } });
  return { ok: true, amount };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const e = event || {};
  if (!OPENID) return { ok: false, error: '没有拿到身份，请在小程序里操作' };
  await ensure();

  const action = String(e.action || 'profile');
  try {
    if (action === 'profile') {
      const p = await getProfile(OPENID);
      const nick = clean(e.nick, 12);
      if (nick && nick !== p.nick) {
        await db.collection('points_profile').doc(p._id).update({ data: { nick } });
      }
      const awards = await db
        .collection('points_awards')
        .where({ openid: OPENID })
        .orderBy('at', 'desc')
        .limit(50)
        .get();
      return { ok: true, uid: p.uid, total: p.total, awards: awards.data || [] };
    }

    if (action === 'bindInviter') {
      const inviterUid = clean(e.inviterUid, 40);
      if (!inviterUid) return { ok: false, error: '缺少邀请码' };
      const p = await getProfile(OPENID);
      if (p.uid === inviterUid) return { ok: false, error: '不能邀请自己' };
      if (p.invitedBy) return { ok: true, dup: true };
      const inviter = await db.collection('points_profile').where({ uid: inviterUid }).limit(1).get();
      if (!inviter.data.length) return { ok: false, error: '邀请人不存在' };
      await db.collection('points_profile').doc(p._id).update({ data: { invitedBy: inviterUid } });
      return { ok: true };
    }

    if (action === 'routeDone') {
      const p = await getProfile(OPENID);
      if (p.firstRouteAt) return { ok: true, dup: true };
      await db.collection('points_profile').doc(p._id).update({ data: { firstRouteAt: Date.now() } });
      if (!p.invitedBy) return { ok: true, inviterAwarded: false };
      const inviter = await db.collection('points_profile').where({ uid: p.invitedBy }).limit(1).get();
      if (!inviter.data.length) return { ok: true, inviterAwarded: false };
      const inviterDoc = inviter.data[0];
      const r = await addAward(inviterDoc.openid, 'invite', 'invite:' + OPENID, INVITE_POINTS, '好友完成首条漫游路线');
      return { ok: true, inviterAwarded: !r.dup };
    }

    if (action === 'award') {
      const type = clean(e.type, 20) || 'misc';
      const key = clean(e.key, 80);
      const amount = Math.max(0, Math.min(100, Number(e.amount) || 0));
      if (!key || !amount) return { ok: false, error: '缺少流水号或分值' };
      return await addAward(OPENID, type, key, amount, e.note);
    }

    return { ok: false, error: '未知操作：' + action };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
};