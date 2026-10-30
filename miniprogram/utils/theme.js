/**
 * 主题 / 夜间模式
 * - 默认 auto：19:00–06:00 自动进入夜间（整个小程序底色变深）
 * - 手动：day 固定白天 / night 固定夜间（在地图页天气卡里切换，存本地）
 * 页面用法：根节点写 <view class="page {{theme}}">，onShow 里调 theme.apply(this)
 */

const MODE_KEY = 'theme_mode';
const NIGHT_START = 19; // 19 点天黑
const NIGHT_END = 6; // 6 点天亮
const MODES = ['auto', 'day', 'night'];

const COLORS = {
  light: { paper: '#fbf8f2', card: '#fffdf8' },
  dark: { paper: '#14120e', card: '#211d17' }
};

function getMode() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return 'auto';
  try {
    const m = wx.getStorageSync(MODE_KEY);
    return MODES.indexOf(m) >= 0 ? m : 'auto';
  } catch (e) {
    return 'auto';
  }
}

function setMode(mode) {
  const next = MODES.indexOf(mode) >= 0 ? mode : 'auto';
  if (typeof wx !== 'undefined' && wx.setStorageSync) {
    try {
      wx.setStorageSync(MODE_KEY, next);
    } catch (e) {
      // 存不进去就只对当前页面生效
    }
  }
  return next;
}

/** 现在是不是夜里（按设备本地时间，项目只面向国内，时区一致） */
function isNight(date) {
  const d = date || new Date();
  const h = d.getHours();
  return h >= NIGHT_START || h < NIGHT_END;
}

/** 'auto'|'day'|'night' → 'light'|'dark' */
function themeOf(mode) {
  if (mode === 'night') return 'dark';
  if (mode === 'day') return 'light';
  return isNight() ? 'dark' : 'light';
}

function currentTheme() {
  return themeOf(getMode());
}

function modeLabel(mode) {
  if (mode === 'day') return '白天';
  if (mode === 'night') return '夜间';
  return '自动';
}

/**
 * 把主题同步到页面
 * @param {object} page 页面实例
 * @param {{nav?:boolean}} [opts] nav=true 时同步原生导航栏颜色（自绘导航的页面不用）
 * @returns {string} 'light' | 'dark'
 */
function apply(page, opts) {
  const mode = getMode();
  const theme = themeOf(mode);
  const color = COLORS[theme];

  if (page && page.setData && page.data && page.data.theme !== theme) {
    page.setData({ theme, themeMode: mode });
  }

  if (typeof wx !== 'undefined') {
    try {
      if (wx.setBackgroundColor) {
        wx.setBackgroundColor({
          backgroundColor: color.paper,
          backgroundColorTop: color.paper,
          backgroundColorBottom: color.paper
        });
      }
    } catch (e) {}

    if (opts && opts.nav) {
      try {
        if (wx.setNavigationBarColor) {
          wx.setNavigationBarColor({
            frontColor: theme === 'dark' ? '#ffffff' : '#000000',
            backgroundColor: theme === 'dark' ? color.paper : '#fbf8f2',
            animation: { duration: 200, timingFunc: 'easeIn' }
          });
        }
      } catch (e) {}
    }
  }

  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.theme = theme;
  } catch (e) {}

  return theme;
}

module.exports = {
  MODE_KEY,
  MODES,
  getMode,
  setMode,
  isNight,
  themeOf,
  currentTheme,
  modeLabel,
  apply,
  COLORS
};