/**
 * 我的行程：多天行程（今天 / 明天 / 任意日期）+ 自选点位 + 排序 + 每段交通方式
 *
 * storage 结构（trip_v1，version 2）：
 *   {
 *     version: 2,
 *     activeId: 'd_2026-10-30',
 *     days: [
 *       { id: 'd_2026-10-30', date: '2026-10-30',
 *         ids: ['wanlou', ...], modes: { 'wanlou|wenmiao': 'taxi' } }
 *     ],
 *     updatedAt: 1730000000000
 *   }
 *
 * 旧版（只有一天）的 { ids, modes } 会在 normalize 里自动迁移成「今天」这一天。
 * 其它页面大多只关心「当前这一天」，所以 getTrip() 仍然返回带 ids / modes 的对象。
 */

const { PLACES } = require('../data/places');
const { pairKey, MODE_MAP } = require('./travel');

const STORAGE_KEY = 'trip_v1';
const MAX_STOPS = 20; // 地图上 num-1..num-20 的标记图；超过这个数就没法编号了
const MAX_DAYS = 14; // 一次旅行 14 天够用了
const DAY_PREFIX = 'd_';

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const PLACE_MAP = {};
PLACES.forEach((p) => {
  PLACE_MAP[p.id] = p;
});

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function dateKey(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayStr() {
  return dateKey(new Date());
}

/** 'YYYY-MM-DD' → 本地 Date（不用 Date 解析字符串，避免 iOS/时区问题） */
function parseDate(str) {
  const parts = String(str || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function isValidDate(str) {
  const d = parseDate(str);
  return !!d && dateKey(d) === str;
}

function dayIdOf(dateStr) {
  return DAY_PREFIX + dateStr;
}

function emptyDay(dateStr) {
  return { id: dayIdOf(dateStr), date: dateStr, ids: [], modes: {} };
}

function emptyState() {
  const day = emptyDay(todayStr());
  return { version: 2, activeId: day.id, days: [day], updatedAt: 0 };
}

/** 清洗某一天：丢掉不存在的点位、去重、限制数量、校验交通方式 key */
function cleanDay(raw) {
  const date = raw && isValidDate(raw.date) ? raw.date : todayStr();
  const day = emptyDay(date);
  const seen = {};
  ((raw && raw.ids) || []).forEach((id) => {
    if (!PLACE_MAP[id] || seen[id]) return;
    if (day.ids.length >= MAX_STOPS) return;
    seen[id] = true;
    day.ids.push(id);
  });

  const modes = (raw && raw.modes) || {};
  Object.keys(modes).forEach((key) => {
    if (!MODE_MAP[modes[key]]) return;
    const ids = key.split('|');
    if (ids.length !== 2) return;
    // 只保留两个端点都还在这一天的交通方式
    if (!seen[ids[0]] || !seen[ids[1]]) return;
    day.modes[key] = modes[key];
  });

  return day;
}

/** 兼容旧版单日数据 + 清洗每一天 */
function normalize(raw) {
  const src = raw || {};
  const days = [];
  const byDate = {};

  if (Array.isArray(src.days) && src.days.length) {
    src.days.forEach((d) => {
      if (!d || !isValidDate(d.date)) return;
      if (byDate[d.date]) return; // 同一天只留一个
      const clean = cleanDay(d);
      byDate[d.date] = clean;
      days.push(clean);
    });
  } else if (Array.isArray(src.ids)) {
    // 旧版：只有一天，迁移成「今天」
    days.push(cleanDay({ date: todayStr(), ids: src.ids, modes: src.modes }));
  }

  if (!days.length) return emptyState();

  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const limited = days.slice(0, MAX_DAYS);

  let activeId = src.activeId || '';
  if (!limited.some((d) => d.id === activeId)) activeId = limited[0].id;

  return { version: 2, activeId, days: limited, updatedAt: Number(src.updatedAt) || 0 };
}

function read() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return emptyState();
  try {
    return normalize(wx.getStorageSync(STORAGE_KEY));
  } catch (e) {
    return emptyState();
  }
}

function write(state) {
  const next = normalize(state);
  next.updatedAt = Date.now();
  if (typeof wx !== 'undefined' && wx.setStorageSync) {
    try {
      wx.setStorageSync(STORAGE_KEY, next);
    } catch (e) {
      // 存储满了也不该让页面崩掉，静默降级成「这次有效」
    }
  }
  return next;
}

function activeDay(state) {
  const s = state || read();
  return s.days.filter((d) => d.id === s.activeId)[0] || s.days[0] || null;
}

function findDay(state, dayId) {
  const s = state || read();
  return s.days.filter((d) => d.id === dayId)[0] || null;
}

/** 某一年的第几天标题：今天 / 明天 / 后天 / 10月31日 */
function titleOf(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function dateTextView(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${WEEK[d.getDay()]}`;
}

function dayView(day, state) {
  return {
    id: day.id,
    date: day.date,
    title: titleOf(day.date),
    dateText: dateTextView(day.date),
    weekday: WEEK[(parseDate(day.date) || new Date()).getDay()],
    count: day.ids.length,
    active: day.id === (state || read()).activeId,
    isToday: day.date === todayStr()
  };
}

/** 行程页顶部的日期条 */
function daysView() {
  const state = read();
  return state.days.map((d) => dayView(d, state));
}

/**
 * 兼容旧接口：只返回「当前这一天」的数据，另外带上 days / activeId
 * { ids, modes, activeId, day, days }
 */
function getTrip() {
  const state = read();
  const day = activeDay(state);
  return {
    ids: day ? day.ids.slice() : [],
    modes: day ? Object.assign({}, day.modes) : {},
    activeId: state.activeId,
    day: day ? { id: day.id, date: day.date, title: titleOf(day.date) } : null,
    days: state.days.map((d) => dayView(d, state))
  };
}

function count(dayId) {
  const state = read();
  const day = dayId ? findDay(state, dayId) : activeDay(state);
  return day ? day.ids.length : 0;
}

function countOf(dayId) {
  return count(dayId);
}

function has(id, dayId) {
  const state = read();
  const day = dayId ? findDay(state, dayId) : activeDay(state);
  return !!day && day.ids.indexOf(id) >= 0;
}

/** 行程里所有点位（按顺序返回原始 place 对象） */
function places(dayId) {
  const state = read();
  const day = dayId ? findDay(state, dayId) : activeDay(state);
  if (!day) return [];
  return day.ids.map((id) => PLACE_MAP[id]).filter(Boolean);
}

function add(id, dayId) {
  const state = read();
  const day = dayId ? findDay(state, dayId) : activeDay(state);
  if (!PLACE_MAP[id]) return { trip: getTrip(), added: false, reason: 'unknown' };
  if (!day) return { trip: getTrip(), added: false, reason: 'unknown' };
  if (day.ids.indexOf(id) >= 0) return { trip: getTrip(), added: false, reason: 'exists' };
  if (day.ids.length >= MAX_STOPS) return { trip: getTrip(), added: false, reason: 'full' };
  day.ids.push(id);
  write(state);
  return { trip: getTrip(), added: true, reason: '', day: dayView(day, state) };
}

function remove(id, dayId) {
  const state = read();
  const day = dayId ? findDay(state, dayId) : activeDay(state);
  if (!day) return { trip: getTrip(), removed: false };
  const index = day.ids.indexOf(id);
  if (index < 0) return { trip: getTrip(), removed: false };
  day.ids.splice(index, 1);
  write(state);
  return { trip: getTrip(), removed: true, day: dayView(day, state) };
}

function toggle(id, dayId) {
  if (has(id, dayId)) return remove(id, dayId);
  return add(id, dayId);
}

/** 把点位挪到新位置（toIndex 是移动后的下标，允许越界由这里夹紧） */
function move(id, toIndex, dayId) {
  const state = read();
  const day = dayId ? findDay(state, dayId) : activeDay(state);
  if (!day) return getTrip();
  const from = day.ids.indexOf(id);
  if (from < 0) return getTrip();
  let to = Number(toIndex);
  if (isNaN(to)) return getTrip();
  to = Math.max(0, Math.min(day.ids.length - 1, to));
  if (to === from) return getTrip();
  day.ids.splice(from, 1);
  day.ids.splice(to, 0, id);
  write(state);
  return getTrip();
}

/** 记录某两个点之间选择哪种交通方式（默认当前这一天） */
function setMode(a, b, mode, dayId) {
  const state = read();
  const day = dayId ? findDay(state, dayId) : activeDay(state);
  if (!day || !MODE_MAP[mode]) return getTrip();
  if (day.ids.indexOf(a) < 0 || day.ids.indexOf(b) < 0) return getTrip();
  day.modes[pairKey(a, b)] = mode;
  write(state);
  return getTrip();
}

function modeOf(trip, a, b, fallback) {
  const saved = (trip && trip.modes ? trip.modes : {})[pairKey(a, b)];
  return MODE_MAP[saved] ? saved : fallback;
}

/** 清空当前这一天的点位（日期本身保留） */
function clear(dayId) {
  const state = read();
  const day = dayId ? findDay(state, dayId) : activeDay(state);
  if (!day) return getTrip();
  day.ids = [];
  day.modes = {};
  write(state);
  return getTrip();
}

// ---------- 多天：新增 / 删除 / 切换 ----------

/**
 * 加一天（按日期）。已经有这一天就切过去。
 * @param {string} date 'YYYY-MM-DD'
 */
function addDay(date, opts) {
  const dateStr = isValidDate(date) ? date : todayStr();
  const state = read();
  const exists = findDay(state, dayIdOf(dateStr));
  if (exists) {
    state.activeId = exists.id;
    write(state);
    return { day: dayView(exists, state), created: false, reason: 'exists' };
  }
  if (state.days.length >= MAX_DAYS) {
    return { day: null, created: false, reason: 'full' };
  }
  const day = emptyDay(dateStr);
  state.days.push(day);
  state.days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  state.activeId = opts && opts.keepActive ? state.activeId : day.id;
  write(state);
  return { day: dayView(day, state), created: true, reason: '' };
}

/** 删除某一天（最后一天不能删） */
function removeDay(dayId) {
  const state = read();
  if (state.days.length <= 1) return { removed: false, reason: 'last' };
  const index = state.days.findIndex ? state.days.findIndex((d) => d.id === dayId) : -1;
  let idx = index;
  if (idx < 0) {
    state.days.forEach((d, i) => {
      if (d.id === dayId) idx = i;
    });
  }
  if (idx < 0) return { removed: false, reason: 'unknown' };
  state.days.splice(idx, 1);
  if (state.activeId === dayId) state.activeId = state.days[0].id;
  write(state);
  return { removed: true, reason: '' };
}

function setActiveDay(dayId) {
  const state = read();
  const day = findDay(state, dayId);
  if (!day) return getTrip();
  state.activeId = day.id;
  write(state);
  return getTrip();
}

/** 当前这一天的短标签：今天 / 明天 / 10月31日 */
function activeLabel() {
  const day = activeDay(read());
  return day ? titleOf(day.date) : '今天';
}

function activeDate() {
  const day = activeDay(read());
  return day ? day.date : todayStr();
}

module.exports = {
  STORAGE_KEY,
  MAX_STOPS,
  MAX_DAYS,
  getTrip,
  count,
  countOf,
  has,
  places,
  add,
  remove,
  toggle,
  move,
  setMode,
  modeOf,
  clear,
  normalize,
  // 多天
  daysView,
  addDay,
  removeDay,
  setActiveDay,
  activeLabel,
  activeDate,
  todayStr,
  titleOf,
  dayIdOf
};