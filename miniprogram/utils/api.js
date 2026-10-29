/**
 * 反馈 / 后台接口
 *
 * 三级降级：
 *   1. 配置了云开发环境（config.CLOUD_ENV）→ 写云数据库 feedback 集合（真机也能用）
 *   2. 否则试本地内容后台 http://127.0.0.1:8787（开发者工具里可用）
 *   3. 都不行 → 存本机 storage 兜底（演示/离线）
 */
const config = require('../config');

function http(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.ADMIN_API + path,
      method: method || 'GET',
      data: data || {},
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

/** 写到云数据库 feedback 集合 */
function cloudAdd(payload) {
  return new Promise((resolve, reject) => {
    wx.cloud
      .database()
      .collection('feedback')
      .add({
        data: Object.assign({}, payload, {
          at: Date.now(),
          status: 'new'
        })
      })
      .then((res) => resolve({ ok: true, via: 'cloud', id: res._id }))
      .catch((err) => reject(err));
  });
}

function storeLocal(payload) {
  const KEY = 'local_feedback_v1';
  const list = wx.getStorageSync(KEY) || [];
  list.unshift(Object.assign({ at: Date.now() }, payload));
  wx.setStorageSync(KEY, list.slice(0, 50));
}

/**
 * 提交反馈
 * @returns {Promise<{via:'cloud'|'admin'|'local'}>}
 */
function reportFeedback(payload) {
  if (cloudReady()) {
    return cloudAdd(payload)
      .catch(() => http('/api/feedback', 'POST', payload).then((r) => ({ via: 'admin', ...r })))
      .catch(() => {
        storeLocal(payload);
        return { via: 'local' };
      });
  }
  return http('/api/feedback', 'POST', payload)
    .then((r) => ({ via: 'admin', ...r }))
    .catch(() => {
      storeLocal(payload);
      return { via: 'local' };
    });
}

module.exports = { reportFeedback, http, cloudReady, storeLocal };
