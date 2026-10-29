const { reportFeedback } = require('../../utils/api');

const LOCAL_KEY = 'local_feedback_v1';
const MAX_LEN = 500;

Page({
  data: {
    placeId: '',
    placeName: '',
    text: '',
    contact: '',
    submitting: false,
    maxLen: MAX_LEN,
    savedLocal: false
  },

  onLoad(options) {
    const id = (options && options.id) || '';
    const name = decodeURIComponent((options && options.name) || '');
    this.setData({
      placeId: id,
      placeName: name,
      text: '',
      contact: wx.getStorageSync('feedback_contact') || ''
    });
    if (id) wx.setNavigationBarTitle({ title: '反馈问题' });
  },

  onTextInput(e) {
    this.setData({ text: e.detail.value });
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value });
  },

  /** 提交：先试本地后台，失败就存本地（演示/真机兜底） */
  onSubmit() {
    const text = (this.data.text || '').trim();
    if (text.length < 5) {
      wx.showToast({ title: '至少写 5 个字，方便我们定位问题', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;
    this.setData({ submitting: true });

    const payload = {
      text,
      contact: (this.data.contact || '').trim(),
      placeId: this.data.placeId,
      placeName: this.data.placeName,
      page: 'detail'
    };

    const done = (ok, msg) => {
      this.setData({ submitting: false, savedLocal: !ok });
      wx.showToast({ title: msg, icon: 'none' });
      setTimeout(() => {
        const pages = getCurrentPages();
        if (pages.length > 1) wx.navigateBack();
        else wx.reLaunch({ url: '/pages/map/index' });
      }, 1200);
    };

    reportFeedback(payload)
      .then((res) => {
        wx.setStorageSync('feedback_contact', payload.contact);
        const via = (res && res.via) || 'admin';
        if (via === 'cloud') done(true, '已提交到云端，谢谢反馈');
        else if (via === 'admin') done(true, '已提交，谢谢反馈');
        else done(false, '已记录在本地（未连后台）');
      })
      .catch(() => {
        // 真机/体验版连不到本地后台：先存本地，演示时也能说清楚
        const list = wx.getStorageSync(LOCAL_KEY) || [];
        list.unshift({ at: Date.now(), ...payload });
        wx.setStorageSync(LOCAL_KEY, list.slice(0, 50));
        wx.setStorageSync('feedback_contact', payload.contact);
        done(false, '已记录在本地（演示环境未连后台）');
      });
  }
});
