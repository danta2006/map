/**
 * 后台接口（本地内容后台）
 *
 * 说明：这是本地演示用的 HTTP 服务（node admin/server.js）。
 * - 开发者工具里可以直接调（项目已关 urlCheck）
 * - 真机 / 体验版调不到本机 127.0.0.1，反馈会退化为"存本地 + 提示"
 * - 要真机收集，见 admin/README.md「接微信云开发」一节
 */
const BASE = 'http://127.0.0.1:8787';

function request(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
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

/** 提交一条反馈；失败时抛错，调用方自己兜底 */
function reportFeedback(payload) {
  return request('/api/feedback', 'POST', payload);
}

module.exports = { BASE, request, reportFeedback };
