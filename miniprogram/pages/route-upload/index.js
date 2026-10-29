const { PLACES } = require('../../data/places');
const trip = require('../../utils/trip');

const PLACE_MAP = {};
PLACES.forEach((p) => {
  PLACE_MAP[p.id] = p;
});
const MAX_STOPS = 20;

Page({
  data: {
    statusBarHeight: 20,
    stops: [],
    title: '',
    nickname: '',
    desc: '',
    submitting: false,
    maxStops: MAX_STOPS,
    canSubmit: false,
    error: ''
  },

  onLoad() {
    const app = getApp();
    this.setData({ statusBarHeight: (app.globalData && app.globalData.statusBarHeight) || 20 });
    this.refresh();
  },

  onShow() {
    this.refresh();
  },

  /** 从「我的行程」读点位，没行程就没得传 */
  refresh() {
    const data = trip.getTrip();
    const stops = (data.ids || []).map((id) => PLACE_MAP[id]).filter(Boolean);
    const title = this.data.title || (stops.length ? `${stops[0].name}出发 · ${stops.length} 个点` : '');
    this.setData({ stops, title, canSubmit: stops.length >= 2 });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onNickInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  onDescInput(e) {
    this.setData({ desc: e.detail.value });
  },

  async onSubmit() {
    const { stops, title, nickname, desc, submitting } = this.data;
    if (submitting) return;
    if (stops.length < 2) {
      wx.showToast({ title: '先去「我的行程」加至少 2 个点', icon: 'none' });
      return;
    }
    if (!wx.cloud) {
      wx.showToast({ title: '当前基础库不支持云开发', icon: 'none' });
      return;
    }
    const t = String(title || '').trim();
    if (t.length < 2) {
      wx.showToast({ title: '起个标题吧（至少 2 个字）', icon: 'none' });
      return;
    }

    this.setData({ submitting: true, error: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'userRoutes',
        data: {
          action: 'submit',
          title: t,
          nickname: String(nickname || '').trim(),
          desc: String(desc || '').trim(),
          stops: stops.map((s) => ({
            id: s.id,
            name: s.name,
            emoji: s.emoji,
            city: s.city,
            latitude: s.latitude,
            longitude: s.longitude
          }))
        }
      });
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.error || '上传失败');
      wx.showToast({ title: '已发布到社区', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 900);
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 60);
      this.setData({ error: msg });
      wx.showToast({ title: msg, icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onOpenTrip() {
    wx.reLaunch({ url: '/pages/trip/index' });
  }
});
