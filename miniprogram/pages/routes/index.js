const app = getApp();
const { PLACES } = require('../../data/places');
const { CITIES } = require('../../data/cities');
const travel = require('../../utils/travel');

const PLACE_MAP = {};
PLACES.forEach((p) => {
  PLACE_MAP[p.id] = p;
});

const CITY_TABS = [{ id: 'all', name: '全部' }].concat(CITIES.map((c) => ({ id: c.id, name: c.name })));
const ROUTE_COLOR = '#b0392e';

function byLikes(a, b) {
  if ((b.likes || 0) !== (a.likes || 0)) return (b.likes || 0) - (a.likes || 0);
  return (b.createdAt || 0) - (a.createdAt || 0);
}

Page({
  data: {
    statusBarHeight: 20,
    menuRight: 96,
    center: { latitude: 27.85, longitude: 112.93 },
    scale: 12.5,
    cityTabs: CITY_TABS,
    activeCity: 'all',
    routes: [],
    loading: true,
    error: '',
    activeId: '',
    active: null,
    markers: [],
    polyline: [],
    stopCard: null
  },

  onLoad() {
    // 右上角胶囊：上传按钮要避开，别叠在一起
    const sys = wx.getSystemInfoSync();
    let menuRight = 96;
    try {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.left) menuRight = Math.max(48, Math.round(sys.windowWidth - menu.left + 8));
    } catch (e) { /* 老基础库用默认值 */ }
    this.setData({ statusBarHeight: app.globalData.statusBarHeight || 20, menuRight });
    this.mapCtx = wx.createMapContext('route-map', this);
    this.loadRoutes();
  },

  onShow() {
    // 从上传页返回时刷新列表
    if (this.loadedOnce) this.loadRoutes();
  },

  /** 拉社区路线（云开发） */
  async loadRoutes() {
    this.loadedOnce = true;
    if (!wx.cloud || !app.globalData.cloudReady) {
      this.setData({ loading: false, error: '云开发未配置，社区路线暂时不可用' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'userRoutes',
        data: {
          action: 'list',
          city: this.data.activeCity === 'all' ? '' : this.data.activeCity
        }
      });
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.error || '加载失败');
      const routes = (r.routes || []).slice().sort(byLikes);
      const still = routes.some((x) => x.id === this.data.activeId);
      this.setData({ routes, loading: false });
      if (still) this.setRoute(this.data.activeId);
      else if (routes.length) this.setRoute(routes[0].id);
      else this.clearMap();
    } catch (e) {
      this.setData({ loading: false, error: String((e && e.message) || e).slice(0, 80) });
    }
  },

  onCityTab(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeCity) return;
    this.setData({ activeCity: id, activeId: '', active: null, stopCard: null });
    this.loadRoutes();
  },

  clearMap() {
    this.setData({ activeId: '', active: null, markers: [], polyline: [], stopCard: null });
  },

  onUpload() {
    wx.navigateTo({ url: '/pages/route-upload/index' });
  },

  /** 选中一条社区路线：画编号点 + 沿路折线 */
  setRoute(id) {
    const route = this.data.routes.find((r) => r.id === id);
    if (!route) return;

    const stops = (route.stops || []).map((s) => {
      const p = PLACE_MAP[s.id];
      return {
        id: s.id,
        name: (p && p.name) || s.name,
        emoji: (p && p.emoji) || s.emoji || '📍',
        city: (p && p.city) || s.city,
        latitude: s.latitude,
        longitude: s.longitude
      };
    });
    this.visibleStops = stops;

    const markers = stops.map((p, i) => ({
      id: i,
      latitude: p.latitude,
      longitude: p.longitude,
      iconPath: `/assets/marker/num-${i + 1}.png`,
      width: 30,
      height: 38,
      anchor: { x: 0.5, y: 1 },
      zIndex: 20,
      callout: {
        content: p.name,
        color: '#1d1c19',
        fontSize: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e5ddce',
        bgColor: '#fffdf8',
        padding: 6,
        display: 'BYCLICK',
        textAlign: 'center'
      }
    }));

    // 沿真实道路的折线（同城点对走 pairPaths，跨城退化成直线）
    const linePoints = [];
    let meters = 0;
    for (let i = 1; i < stops.length; i++) {
      const a = PLACE_MAP[stops[i - 1].id];
      const b = PLACE_MAP[stops[i].id];
      if (!a || !b) continue;
      const leg = travel.buildLeg(a.id, b.id);
      meters += leg.distance || 0;
      const pts = travel.legPoints(leg, a, b) || [];
      pts.forEach((pt) => {
        const last = linePoints[linePoints.length - 1];
        if (!last || last.latitude !== pt.latitude || last.longitude !== pt.longitude) {
          linePoints.push({ latitude: pt.latitude, longitude: pt.longitude });
        }
      });
    }
    if (linePoints.length < 2) {
      stops.forEach((p) => linePoints.push({ latitude: p.latitude, longitude: p.longitude }));
    }

    const points = stops.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
    this.setData({
      activeId: id,
      active: {
        ...route,
        stops,
        distanceText: (meters / 1000).toFixed(1) + ' km'
      },
      markers,
      polyline: [
        { points: linePoints, color: '#FFFFFFCC', width: 14 },
        { points: linePoints, color: ROUTE_COLOR, width: 9 }
      ],
      stopCard: null
    });

    setTimeout(() => {
      if (this.mapCtx && points.length) {
        this.mapCtx.includePoints({ points, padding: [180, 80, 320, 80] });
      }
    }, 300);
  },

  onRouteTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeId) return;
    this.setRoute(id);
  },

  /** 点赞 / 取消点赞（云端去重，按 openid） */
  async onLike(e) {
    const id = e.currentTarget.dataset.id;
    if (!wx.cloud) return;
    try {
      const res = await wx.cloud.callFunction({ name: 'userRoutes', data: { action: 'like', routeId: id } });
      const r = (res && res.result) || {};
      if (!r.ok) throw new Error(r.error || '点赞失败');
      const routes = this.data.routes
        .map((x) => (x.id === id ? { ...x, likes: r.likes, liked: r.liked } : x))
        .sort(byLikes);
      this.setData({ routes });
      if (this.data.activeId === id && this.data.active) {
        this.setData({ active: { ...this.data.active, likes: r.likes, liked: r.liked } });
      }
    } catch (err) {
      wx.showToast({ title: String((err && err.message) || err).slice(0, 20), icon: 'none' });
    }
  },

  onMarkerTap(e) {
    this.openStopCard(e.detail.markerId);
  },

  onStopTap(e) {
    this.openStopCard(Number(e.currentTarget.dataset.index));
  },

  openStopCard(index) {
    const stop = (this.visibleStops || [])[index];
    if (!stop) return;
    this.lastMarkerTapAt = Date.now();
    this.setData({ stopCard: { index: index + 1, total: this.visibleStops.length, ...stop } });
  },

  closeStopCard() {
    this.setData({ stopCard: null });
  },

  onCardDetail() {
    const card = this.data.stopCard;
    if (!card) return;
    wx.navigateTo({ url: `/pages/detail/index?id=${card.id}` });
  },

  onMapTap() {
    if (Date.now() - (this.lastMarkerTapAt || 0) < 200) return;
    if (this.data.stopCard) this.setData({ stopCard: null });
  }
});
