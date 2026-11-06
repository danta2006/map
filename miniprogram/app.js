const config = require('./config');
const points = require('./utils/points');

App({
  globalData: {
    statusBarHeight: 20,
    windowWidth: 375,
    cloudReady: false,
    cloudEnv: ''
  },

  onLaunch(options) {
    try {
      const info = wx.getWindowInfo();
      this.globalData.statusBarHeight = info.statusBarHeight || 20;
      this.globalData.windowWidth = info.windowWidth || 375;
    } catch (e) {
      // 老版本基础库没有 getWindowInfo，用 systemInfo 兜底
      const sys = wx.getSystemInfoSync();
      this.globalData.statusBarHeight = sys.statusBarHeight || 20;
      this.globalData.windowWidth = sys.windowWidth || 375;
    }

    // 云开发：配置了环境 ID 才初始化
    if (config.CLOUD_ENV && wx.cloud) {
      try {
        wx.cloud.init({ env: config.CLOUD_ENV, traceUser: true });
        this.globalData.cloudReady = true;
        this.globalData.cloudEnv = config.CLOUD_ENV;
      } catch (e) {
        console.warn('wx.cloud.init 失败', e);
      }
    }

    this.captureInvite(options);
  },

  /** 从分享路径里带过来的邀请码（?inviter=u_xxx） */
  onShow(options) {
    this.captureInvite(options);
  },

  captureInvite(options) {
    const q = (options && options.query) || {};
    if (!q.inviter) return;
    const r = points.setInviter(q.inviter);
    if (r && r.ok) {
      wx.showToast({ title: '已接受好友邀请，完成首条路线双方得分', icon: 'none' });
    }
  }
});