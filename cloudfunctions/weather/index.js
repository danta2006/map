// 云函数：天气代理
// 原因：小程序真机/体验版受 request 合法域名限制（api.open-meteo.com 是国外域名，加不了白名单），
//       所以天气一律走云函数。云函数默认超时只有 3s，而腾讯云访问 open-meteo 经常 >3s，
//       因此这里优先用国内免费天气源（t.weather.itboy.net，无需 key、延迟低），
//       失败再退回 open-meteo（限时 1.8s）。
const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 长株潭三城中心 → 中国天气网城市代码
const CITIES = [
  { id: 'xiangtan', code: '101250201', lat: 27.847, lng: 112.9415 },
  { id: 'changsha', code: '101250101', lat: 28.19, lng: 112.98 },
  { id: 'zhuzhou', code: '101250301', lat: 27.83, lng: 113.13 }
];

function getJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const lib = /^https:/.test(url) ? https : http;
    const req = lib.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error('http-' + res.statusCode));
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 512 * 1024) req.destroy(new Error('too-large'));
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('bad-json'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout || 2500, () => req.destroy(new Error('timeout')));
  });
}

function nearestCity(lat, lng) {
  let best = null;
  let bestKm = Infinity;
  CITIES.forEach((c) => {
    const dy = (lat - c.lat) * 111;
    const dx = (lng - c.lng) * 111 * Math.cos((lat * Math.PI) / 180);
    const km = Math.sqrt(dx * dx + dy * dy);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  });
  return bestKm <= 80 ? best : null;
}

// 天气描述文字 → WMO code（客户端按 code 出形态/emoji）
function codeOf(text) {
  const t = String(text || '');
  if (/雷/.test(t)) return 95;
  if (/雨夹雪|冻雨/.test(t)) return 66;
  if (/雪/.test(t)) return t.indexOf('大') >= 0 || t.indexOf('暴') >= 0 ? 75 : 71;
  if (/雾|霾/.test(t)) return 45;
  if (/暴雨/.test(t)) return 82;
  if (/大雨/.test(t)) return 65;
  if (/中雨/.test(t)) return 63;
  if (/雨/.test(t)) return 61;
  if (/阴/.test(t)) return 3;
  if (/多云/.test(t)) return 2;
  if (/晴/.test(t)) return 0;
  return 2;
}

function popOf(text) {
  const t = String(text || '');
  if (/雷/.test(t)) return 70;
  if (/暴雨|大雨/.test(t)) return 80;
  if (/中雨|雨夹雪|冻雨/.test(t)) return 60;
  if (/小雨|阵雨|雨/.test(t)) return 45;
  if (/雪/.test(t)) return 55;
  return 0;
}

function num(str) {
  const v = parseInt(String(str || '').replace(/[^\d-]/g, ''), 10);
  return isFinite(v) ? v : 0;
}

/** 国内源：t.weather.itboy.net → 客户端需要的 daily 结构 */
async function viaDomestic(city) {
  const url = `http://t.weather.itboy.net/api/weather/city/${city.code}`;
  const data = await getJson(url, 2400);
  const list = data && data.data && data.data.forecast;
  if (!list || !list.length) throw new Error('bad-domestic-payload');
  const days = list.slice(0, 3);
  return {
    time: days.map((d) => d.ymd),
    weather_code: days.map((d) => codeOf(d.type)),
    temperature_2m_max: days.map((d) => num(d.high)),
    temperature_2m_min: days.map((d) => num(d.low)),
    precipitation_probability_max: days.map((d) => popOf(d.type))
  };
}

/** 国外源：open-meteo（兜底，延迟高） */
async function viaOpenMeteo(lat, lng) {
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&forecast_days=3&timezone=Asia%2FShanghai';
  const data = await getJson(url, 1800);
  const daily = data && data.daily;
  if (!daily || !daily.time) throw new Error('bad-payload');
  return daily;
}

exports.main = async (event) => {
  const lat = Number(event && event.lat);
  const lng = Number(event && event.lng);
  if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: 'bad-coords' };

  const city = nearestCity(lat, lng);
  let domesticError = '';
  if (city) {
    try {
      const daily = await viaDomestic(city);
      return { ok: true, source: 'domestic', city: city.id, daily };
    } catch (e) {
      domesticError = String((e && e.message) || e);
    }
  }

  try {
    const daily = await viaOpenMeteo(lat, lng);
    return { ok: true, source: 'open-meteo', domesticError, daily };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
};
