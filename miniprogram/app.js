const config = require('./config');

App({
  globalData: {
    statusBarHeight: 20,
    windowWidth: 375,
    cloudReady: false,
    cloudEnv: ''
  },

  onLaunch() {
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
  }
});
