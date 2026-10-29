/**
 * 反馈 / 后台接口
 *
 * 三级降级：
 *   1. 配置了云开发环境（config.CLOUD_ENV）→ 调 feedback 云函数写云数据库
 *      （服务端做字段清洗和限条数，不依赖客户端自觉，也不依赖集合权限配置）
 *   2. 否则试本地内容后台 http://127.0.0.1:8787（开发者工具里可用，需 X-Admin-Token）
 *   3. 都不行 → 存本机 storage 兜底（演示/离线）
 */
const config = require('../config');

/** 反馈字段截断上限（和 feedback 云函数保持一致） */
const LIMITS = { text: 500, contact: 100, placeId: 60, placeName: 60, page: 20 };

function clamp(payload) {
  const out = {};
  Object.keys(LIMITS).forEach((k) => {
    out[k] = String(payload[k] == null ? '' : payload[k]).slice(0, LIMITS[k]);
  });
  return out;
}

let adminToken = '';

/** 先拿本地后台令牌（wx.request 不受浏览器 CORS 限制，仅开发环境可达） */
function bootAdminToken() {
  if (adminToken) return Promise.resolve();
  return new Promise((resolve) => {
    wx.request({
      url: config.ADMIN_API + '/boot.json',
      method: 'GET',
      timeout: 2000,
      success: (res) => {
        adminToken = (res.data && res.data.token) || '';
        resolve();
      },
      fail: () => resolve()
    });
  });
}

function http(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.ADMIN_API + path,
      method: method || 'GET',
      data: data || {},
      header: adminToken ? { 'X-Admin-Token': adminToken } : {},
      timeout: 4000,
      success: (res) => {
        if (res.statusCode === 200) resolve(res.data || {});
        else reject(new Error('HTTP ' + res.statusCode));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络失败'))
    });
  });
}

function cloudReady() {
  const app = getApp();
  return !!(app && app.globalData && app.globalData.cloudReady && wx.cloud);
}

/** 走 feedback 云函数写入（服务端校验），不再从客户端直接写库 */
function cloudAdd(payload) {
  return wx.cloud
    .callFunction({ name: 'feedback', data: clamp(payload) })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.error || '反馈提交失败');
      return { ok: true, via: 'cloud', id: r.id };
    });
}

function storeLocal(payload) {
  const KEY = 'local_feedback_v1';
  const list = wx.getStorageSync(KEY) || [];
  list.unshift(Object.assign({ at: Date.now() }, clamp(payload)));
  wx.setStorageSync(KEY, list.slice(0, 50));
}

/** 本地后台兜底：先取令牌再 POST */
function adminAdd(payload) {
  return bootAdminToken().then(() =>
    http('/api/feedback', 'POST', clamp(payload)).then((r) => ({ via: 'admin', ...r }))
  );
}

/**
 * 提交反馈
 * @returns {Promise<{via:'cloud'|'admin'|'local'}>}
 */
function reportFeedback(payload) {
  if (cloudReady()) {
    return cloudAdd(payload).catch(() => adminAdd(payload).catch(() => {
      storeLocal(payload);
      return { via: 'local' };
    }));
  }
  return adminAdd(payload).catch(() => {
    storeLocal(payload);
    return { via: 'local' };
  });
}

module.exports = { reportFeedback, http, cloudReady, storeLocal, adminAdd };
