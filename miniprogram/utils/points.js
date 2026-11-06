/**
 * 积分系统（v0.10.0）
 *
 * 规则（和产品需求一一对应）：
 *   1. 完成一条漫游路线（按点位打卡完成）  +30，同一条路线只算一次
 *   2. 点位停留打卡（定位核验）            +8 / 个，同一个点位每天上限 1 次
 *   3. 提交真实游玩反馈 / 点位纠错         +15 / 条
 *   4. 邀请好友注册并完成首次漫游路线      +25 / 人
 *   5. 生成并分享漫游记忆卡（成功分享）    +10，每天上限 1 次
 *
 * 数据全部存本机（points_v1）：真机不联网也能累计、演示时能讲清楚；
 * 邀请奖励需要「对方也打开小程序」，所以额外走云函数 points 记账（可选，没开云开发时只提示）。
 */

const { ROUTES } = require('../data/routes');

const KEY = 'points_v1';
const UID_KEY = 'points_uid_v1';
const MAX_LOG = 200;

const RULES = [
  {
    key: 'route',
    name: '完成一条漫游路线',
    amount: 30,
    unit: '条',
    desc: '把一条精选路线上的点位逐个打卡完，+30 分；同一条路线只算一次'
  },
  {
    key: 'checkin',
    name: '点位停留打卡',
    amount: 8,
    unit: '个',
    desc: '定位核验通过 +8 分；同一个点位每天只算 1 次（明天再来还能拿）'
  },
  {
    key: 'feedback',
    name: '提交真实反馈 / 纠错',
    amount: 15,
    unit: '条',
    desc: '在地点详情页提交反馈或纠错内容，+15 分'
  },
  {
    key: 'invite',
    name: '邀请好友',
    amount: 25,
    unit: '人',
    desc: '好友通过你的邀请卡注册，并完成第一条漫游路线，你 +25 分/人'
  },
  {
    key: 'share',
    name: '分享漫游记忆卡',
    amount: 10,
    unit: '次',
    desc: '生成并分享你的漫游记忆卡，+10 分；每天上限 1 次'
  }
];

const RULE_MAP = {};
RULES.forEach((r) => {
  RULE_MAP[r.key] = r;
});

function uid() {
  let id = '';
  try {
    id = wx.getStorageSync(UID_KEY) || '';
  } catch (e) {
    id = '';
  }
  if (!id) {
    id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    try {
      wx.setStorageSync(UID_KEY, id);
    } catch (e) {
      // storage 不可用时退化成临时 id，不影响本次会话
    }
  }
  return id;
}

function blank() {
  return {
    total: 0,
    log: [],
    seen: { route: {}, checkin: {}, share: {} },
    nick: '',
    invitedBy: '',
    invites: [],
    routeDoneNotified: false,
    updatedAt: 0
  };
}

function normalize(raw) {
  const base = blank();
  if (!raw || typeof raw !== 'object') return base;
  const state = {
    total: Math.max(0, Number(raw.total) || 0),
    log: Array.isArray(raw.log) ? raw.log.slice(0, MAX_LOG) : [],
    seen: {
      route: (raw.seen && raw.seen.route) || {},
      checkin: (raw.seen && raw.seen.checkin) || {},
      share: (raw.seen && raw.seen.share) || {}
    },
    nick: String(raw.nick || '').slice(0, 12),
    invitedBy: String(raw.invitedBy || ''),
    invites: Array.isArray(raw.invites) ? raw.invites.slice(0, 50) : [],
    routeDoneNotified: !!raw.routeDoneNotified,
    updatedAt: Number(raw.updatedAt) || 0
  };
  return state;
}

function load() {
  let raw = null;
  try {
    raw = wx.getStorageSync(KEY);
  } catch (e) {
    raw = null;
  }
  return normalize(raw);
}

function save(state) {
  state.updatedAt = Date.now();
  if (state.log.length > MAX_LOG) state.log = state.log.slice(0, MAX_LOG);
  try {
    wx.setStorageSync(KEY, state);
  } catch (e) {
    // 存储写不进去也不阻断页面
  }
  return state;
}

/** 本地日期 YYYY-MM-DD（不用 toISOString，避免时区把「今天」算错） */
function today(ts) {
  const d = new Date(ts == null ? Date.now() : ts);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

/**
 * 记一笔积分
 * @param {string} type 规则 key
 * @param {{key?:string, note?:string, amount?:number}} opts
 * @returns {{ok:boolean, amount:number, total:number, reason?:string}}
 */
function award(type, opts) {
  const rule = RULE_MAP[type];
  if (!rule) return { ok: false, amount: 0, total: load().total, reason: 'unknown-type' };
  const o = opts || {};
  const state = load();
  const key = o.key || '';
  const bucket = state.seen[type];

  if (bucket && key) {
    if (bucket[key]) return { ok: false, amount: 0, total: state.total, reason: 'dup' };
    bucket[key] = true;
  }

  const amount = typeof o.amount === 'number' ? o.amount : rule.amount;
  const entry = {
    id: 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type,
    amount,
    note: String(o.note || rule.name).slice(0, 40),
    at: Date.now()
  };
  state.log.unshift(entry);
  state.total += amount;
  save(state);
  return { ok: true, amount, total: state.total, entry };
}

/** 点位打卡：同一点位每天一次 */
function checkin(placeId, placeName) {
  if (!placeId) return { ok: false, amount: 0, total: load().total, reason: 'no-id' };
  return award('checkin', {
    key: today() + '|' + placeId,
    note: (placeName ? placeName + ' ' : '') + '停留打卡'
  });
}

/** 反馈 / 纠错：每提交一条算一条 */
function feedback(placeName) {
  return award('feedback', {
    key: 'fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    note: (placeName ? placeName + ' ' : '') + '反馈纠错'
  });
}

/** 分享记忆卡：每天一次 */
function share() {
  return award('share', { key: today(), note: '分享漫游记忆卡' });
}

/** 路线完成：同一条路线只算一次 */
function route(routeId, routeName) {
  if (!routeId) return { ok: false, amount: 0, total: load().total, reason: 'no-id' };
  return award('route', { key: routeId, note: '完成路线 · ' + (routeName || routeId) });
}

/** 读所有打卡记录（detail 页的 key 是 checkin_<点位id>） */
function checkedIds() {
  const out = {};
  try {
    const info = wx.getStorageInfoSync();
    (info.keys || []).forEach((k) => {
      if (k.indexOf('checkin_') === 0) out[k.slice(8)] = true;
    });
    // 有的基础库 getStorageInfoSync 拿不到全部 key，兜底再按点位读一遍
    if (!Object.keys(out).length) {
      const { PLACES } = require('../data/places');
      PLACES.forEach((p) => {
        if (wx.getStorageSync('checkin_' + p.id)) out[p.id] = true;
      });
    }
  } catch (e) {
    // 读不到就当没有打卡
  }
  return out;
}

/**
 * 扫一遍精选路线，返回刚完成的路线名（调用方负责提示）
 * 只认「路线上的点位都已打卡」，不看顺序。
 */
function scanRoutes() {
  const done = checkedIds();
  const list = ROUTES || [];
  const fresh = [];
  list.forEach((r) => {
    const stops = r.stops || [];
    if (stops.length < 2) return;
    const all = stops.every((id) => done[id]);
    if (!all) return;
    const res = route(r.id, r.name);
    if (res.ok) fresh.push({ id: r.id, name: r.name, amount: res.amount });
  });
  return fresh;
}

/** 个人页要用的汇总 */
function summary() {
  const state = load();
  const d = today();
  const todayGain = state.log
    .filter((e) => today(e.at) === d)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const countBy = (type) => state.log.filter((e) => e.type === type).length;
  return {
    total: state.total,
    todayGain,
    log: state.log.slice(0, 30),
    nick: state.nick,
    uid: uid(),
    invites: state.invites,
    stats: {
      routes: countBy('route'),
      checkins: countBy('checkin'),
      feedbacks: countBy('feedback'),
      invites: countBy('invite'),
      shares: countBy('share'),
      sharedToday: !!state.seen.share[d]
    },
    seen: state.seen
  };
}

function setNick(nick) {
  const state = load();
  state.nick = String(nick || '').trim().slice(0, 12);
  save(state);
  return state.nick;
}

function getNick() {
  return load().nick;
}

/** 被邀请：记下邀请人 uid，完成首条路线后通知云端给邀请人加分 */
function setInviter(inviterUid) {
  const code = String(inviterUid || '').trim();
  if (!code || code === uid()) return { ok: false, reason: 'self' };
  const state = load();
  if (state.invitedBy) return { ok: false, reason: 'already' };
  state.invitedBy = code;
  save(state);
  callCloud('bindInviter', { inviterUid: code }).catch(() => {});
  return { ok: true, inviterUid: code };
}

function callCloud(action, data) {
  return new Promise((resolve, reject) => {
    let app = null;
    try {
      app = getApp();
    } catch (e) {
      app = null;
    }
    const ready = !!(app && app.globalData && app.globalData.cloudReady && wx.cloud && wx.cloud.callFunction);
    if (!ready) {
      reject(new Error('cloud-not-ready'));
      return;
    }
    wx.cloud
      .callFunction({ name: 'points', data: Object.assign({ action }, data || {}) })
      .then((res) => resolve((res && res.result) || {}))
      .catch(reject);
  });
}

/**
 * 完成首条路线后通知云端（只发一次），让邀请人拿到 +25
 * 返回 { ok, inviterAwarded, error }
 */
function notifyRouteDone() {
  const state = load();
  if (state.routeDoneNotified) return Promise.resolve({ ok: true, skipped: true });
  return callCloud('routeDone', { nick: state.nick })
    .then((r) => {
      if (r && r.ok) {
        const s = load();
        s.routeDoneNotified = true;
        save(s);
      }
      return r || { ok: false };
    })
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
}

/** 拉取云端奖励（主要是邀请奖励），按 key 去重后并进本地明细 */
function pullCloudAwards() {
  return callCloud('profile', { nick: load().nick })
    .then((r) => {
      const awards = (r && r.awards) || [];
      if (!awards.length) return { ok: true, added: 0 };
      const state = load();
      const has = {};
      state.log.forEach((e) => {
        if (e.key) has[e.key] = true;
      });
      let added = 0;
      awards.forEach((a) => {
        const key = 'cloud_' + a.key;
        if (has[key]) return;
        if (state.seen[a.type] && state.seen[a.type][a.key]) return;
        const amount = Number(a.amount) || 0;
        if (!amount) return;
        state.log.unshift({
          id: key,
          key,
          type: a.type || 'invite',
          amount,
          note: a.note || '邀请奖励',
          at: Number(a.at) || Date.now()
        });
        state.total += amount;
        if (a.type === 'invite') state.invites.push({ at: Number(a.at) || Date.now(), note: a.note || '好友完成首条路线' });
        added += 1;
      });
      if (added) save(state);
      return { ok: true, added, total: state.total };
    })
    .catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
}

module.exports = {
  RULES,
  RULE_MAP,
  KEY,
  today,
  uid,
  load,
  award,
  checkin,
  feedback,
  share,
  route,
  scanRoutes,
  checkedIds,
  summary,
  setNick,
  getNick,
  setInviter,
  notifyRouteDone,
  pullCloudAwards,
  callCloud
};