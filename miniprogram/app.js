App({
  globalData: {
    statusBarHeight: 20,
    windowWidth: 375
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
  }
});
