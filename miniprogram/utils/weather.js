/**
 * 天气：定位 → 未来 3 天预报（Open-Meteo，免费、无需 key）
 * 存本地 storage 做 2 小时缓存，断网/超时就用旧缓存，绝不挡主流程。
 *
 * 数据结构：
 *   day = { date:'2026-10-30', title:'今天', weekday:'周五', dateText:'10/30',
 *           code, kind:'rain', label:'小雨', emoji:'🌧', tMax:22, tMin:16, pop:60 }
 *   result = { days:[day], today:day, fromCache:bool, at, error:'' }
 */

const CACHE_KEY = 'weather_v1';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 小时
const CACHE_RADIUS = 8000; // 位置挪动超过 8km 就重新拉
const API = 'https://api.open-meteo.com/v1/forecast';
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// WMO weather code → 天气形态（地图上的「形态」只有这几类）
const CODE_TABLE = {
  0: ['clear', '晴', '☀️'],
  1: ['clear', '晴间多云', '🌤'],
  2: ['partly', '多云', '⛅'],
  3: ['overcast', '阴', '☁️'],
  45: ['fog', '雾', '🌫'],
  48: ['fog', '雾凇', '🌫'],
  51: ['rain', '毛毛雨', '🌦'],
  53: ['rain', '小雨', '🌦'],
  55: ['rain', '中雨', '🌧'],
  56: ['rain', '冻雨', '🌧'],
  57: ['rain', '冻雨', '🌧'],
  61: ['rain', '小雨', '🌧'],
  63: ['rain', '中雨', '🌧'],
  65: ['rain', '大雨', '🌧'],
  66: ['rain', '冻雨', '🌧'],
  67: ['rain', '冻雨', '🌧'],
  71: ['snow', '小雪', '🌨'],
  73: ['snow', '中雪', '🌨'],
  75: ['snow', '大雪', '❄️'],
  77: ['snow', '雪粒', '🌨'],
  80: ['rain', '阵雨', '🌦'],
  81: ['rain', '强阵雨', '🌧'],
  82: ['rain', '暴雨', '🌧'],
  85: ['snow', '阵雪', '🌨'],
  86: ['snow', '强阵雪', '❄️'],
  95: ['thunder', '雷阵雨', '⛈'],
  96: ['thunder', '雷阵雨伴冰雹', '⛈'],
  99: ['thunder', '雷阵雨伴冰雹', '⛈']
};

const UNKNOWN = ['partly', '多云', '⛅'];

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function dateKey(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' → 本地 Date（避免 iOS 对 "-" 解析成 UTC 的坑） */
function parseDate(str) {
  const parts = String(str || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function weekdayOf(str) {
  const d = parseDate(str);
  return d ? WEEK[d.getDay()] : '';
}

function monthDayOf(str) {
  const d = parseDate(str);
  return d ? `${d.getMonth() + 1}/${d.getDate()}` : '';
}

/** 'YYYY-MM-DD' 是今天 / 明天 / 后天，还是具体的几月几日 */
function relativeTitle(str) {
  const d = parseDate(str);
  if (!d) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** WMO code → { kind, label, emoji } */
function describe(code) {
  const row = CODE_TABLE[code] || UNKNOWN;
  return { kind: row[0], label: row[1], emoji: row[2] };
}

function buildDay(date, code, tMax, tMin, pop, index) {
  const desc = describe(code);
  return {
    date,
    index: index || 0,
    title: relativeTitle(date),
    weekday: weekdayOf(date),
    dateText: monthDayOf(date),
    code,
    kind: desc.kind,
    label: desc.label,
    emoji: desc.emoji,
    tMax: Math.round(Number(tMax)),
    tMin: Math.round(Number(tMin)),
    pop: Math.max(0, Math.min(100, Math.round(Number(pop) || 0)))
  };
}

function request(url, timeout) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.request) {
      reject(new Error('no-wx'));
      return;
    }
    wx.request({
      url,
      method: 'GET',
      timeout: timeout || 6000,
      success: (res) => {
        if (res && res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error('http-' + (res && res.statusCode)));
      },
      fail: (err) => reject(err || new Error('request-failed'))
    });
  });
}

function fetchDays(lat, lng) {
  const url =
    `${API}?latitude=${Number(lat).toFixed(4)}&longitude=${Number(lng).toFixed(4)}` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&forecast_days=3&timezone=Asia%2FShanghai';
  return request(url).then((data) => {
    const daily = data && data.daily;
    if (!daily || !daily.time || !daily.time.length) throw new Error('bad-payload');
    const days = daily.time.slice(0, 3).map((date, i) =>
      buildDay(
        date,
        daily.weather_code ? daily.weather_code[i] : 2,
        daily.temperature_2m_max ? daily.temperature_2m_max[i] : 0,
        daily.temperature_2m_min ? daily.temperature_2m_min[i] : 0,
        daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : 0,
        i
      )
    );
    return days;
  });
}

/** 读本地缓存：按城市存多份（切地区来回切不用重复请求） */
function readCache() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return [];
  try {
    const raw = wx.getStorageSync(CACHE_KEY);
    if (!raw) return [];
    // 兼容老版本：单个 { at, lat, lng, days }
    if (raw.days && raw.days.length) return [raw];
    if (raw.entries && raw.entries.length) {
      return raw.entries.filter((e) => e && e.days && e.days.length);
    }
    return [];
  } catch (e) {
    return [];
  }
}

/** 找离这个坐标最近的那条缓存（8km 内算同一座城市） */
function pickCache(entries, lat, lng) {
  let best = null;
  let bestGap = Infinity;
  (entries || []).forEach((e) => {
    const gap = meterGap(lat, lng, e.lat, e.lng);
    if (gap < bestGap) {
      bestGap = gap;
      best = e;
    }
  });
  return best && bestGap < CACHE_RADIUS ? best : null;
}

function writeCache(lat, lng, days) {
  if (typeof wx === 'undefined' || !wx.setStorageSync) return;
  try {
    const entries = readCache().filter((e) => meterGap(lat, lng, e.lat, e.lng) >= CACHE_RADIUS);
    entries.unshift({ at: Date.now(), lat: Number(lat), lng: Number(lng), days });
    // 三座城市各一份就够
    wx.setStorageSync(CACHE_KEY, { entries: entries.slice(0, 3) });
  } catch (e) {
    // 缓存写不进去不影响使用
  }
}

function applyTitles(days) {
  return days.map((d) => ({
    ...d,
    title: relativeTitle(d.date),
    weekday: weekdayOf(d.date),
    dateText: monthDayOf(d.date)
  }));
}

function makeResult(days, fromCache, at, error) {
  const list = applyTitles(days || []);
  return { days: list, today: list[0] || null, fromCache: !!fromCache, at: at || 0, error: error || '' };
}

function meterGap(lat1, lng1, lat2, lng2) {
  const dy = (lat1 - lat2) * 111320;
  const dx = (lng1 - lng2) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/**
 * 取未来 3 天天气（带缓存）。
 * @param {number} lat
 * @param {number} lng
 * @param {{force?:boolean}} [opts]
 * @returns {Promise<result>} 永远 resolve，失败时 error 有值、days 用旧缓存
 */
function load(lat, lng, opts) {
  const force = !!(opts && opts.force);
  const cached = pickCache(readCache(), lat, lng);
  const fresh = cached && Date.now() - cached.at < CACHE_TTL;

  if (cached && fresh && !force) {
    return Promise.resolve(makeResult(cached.days, true, cached.at, ''));
  }

  return fetchDays(lat, lng)
    .then((days) => {
      writeCache(lat, lng, days);
      return makeResult(days, false, Date.now(), '');
    })
    .catch((err) => {
      const msg = String((err && err.message) || 'error');
      // 只有「同一个地方」的旧缓存才拿来兜底，别把别的城市天气显示在当前位置
      if (cached) {
        return makeResult(cached.days, true, cached.at, msg);
      }
      return makeResult([], false, 0, msg);
    });
}

/** 不联网，直接拿最近的缓存（页面秒开用） */
function peek() {
  const entries = readCache();
  const cached = entries[0] || null;
  return cached ? makeResult(cached.days, true, cached.at, '') : null;
}

module.exports = {
  CACHE_KEY,
  load,
  peek,
  fetchDays,
  describe,
  relativeTitle,
  dateKey,
  weekdays: WEEK
};