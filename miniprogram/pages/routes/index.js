const app = getApp();
const { PLACES } = require('../../data/places');
const { CITIES } = require('../../data/cities');
const travel = require('../../utils/travel');
const trip = require('../../utils/trip');

const PLACE_MAP = {};
PLACES.forEach((p) => {
  PLACE_MAP[p.id] = p;
});

const CITY_TABS = [{ id: 'all', name: '全部' }]
  .concat(CITIES.map((c) => ({ id: c.id, name: c.name })))
  .concat([{ id: 'mixed', name: '跨城' }]);
const MODE_COLOR = { walk: '#2c6b63', transit: '#3a6ea5', taxi: '#8b6f47' };

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
    stopCard: null,
    // 路线详情（站点 / 交通方式）
    tab: 'legs',
    legs: [],
    totals: { walk: 0, transit: 0, taxi: 0 },
    chosenTotal: 0
  },

  onLoad() {
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
    if (this.loadedOnce) this.loadRoutes();
  },

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
        data: { action: 'list', city: this.data.activeCity === 'all' ? '' : this.data.activeCity }
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
    this.visibleStops = [];
    this.legObjs = [];
    this.modeState = [];
    this.setData({ activeId: '', active: null, markers: [], polyline: [], stopCard: null, legs: [] });
  },

  onUpload() {
    wx.navigateTo({ url: '/pages/route-upload/index' });
  },

  /** 选中路线：站点 + 每段三种交通方式 + 按方式着色的折线 */
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

    const legs = [];
    const modeState = [];
    let meters = 0;
    for (let i = 1; i < stops.length; i++) {
      const a = PLACE_MAP[stops[i - 1].id];
      const b = PLACE_MAP[stops[i].id];
      if (!a || !b) {
        legs.push(null);
        modeState.push('walk');
        continue;
      }
      const leg = travel.buildLeg(a.id, b.id);
      meters += leg.distance || 0;
      const modes = (leg.modes || []).map((m) => ({
        key: m.key,
        name: m.name,
        color: m.color,
        minutes: m.minutes,
        disabled: !!m.disabled,
        text: m.text
      }));
      const chosen = leg.modeKey || 'walk';
      modeState.push(chosen);
      legs.push({
        index: i,
        fromId: leg.fromId,
        toId: leg.toId,
        fromName: leg.fromName || stops[i - 1].name,
        toName: leg.toName || stops[i].name,
        distanceText: leg.distanceText,
        modes,
        chosen
      });
    }
    this.legObjs = legs;
    this.modeState = modeState;

    this.setData({
      activeId: id,
      active: { ...route, stops, distanceText: (meters / 1000).toFixed(1) + ' km' },
      tab: 'legs',
      stopCard: null
    });
    this.recalc();
    this.draw();
    setTimeout(() => {
      const points = stops.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
      if (this.mapCtx && points.length) {
        this.mapCtx.includePoints({ points, padding: [180, 80, 460, 80] });
      }
    }, 300);
  },

  /** 交通列表（带当前选择） */
  legRows() {
    return (this.legObjs || [])
      .map((leg, i) => (leg ? { ...leg, chosen: this.modeState[i] } : null))
      .filter(Boolean);
  },

  /** 三种方式全程合计 + 当前所选合计 */
  recalc() {
    const totals = { walk: 0, transit: 0, taxi: 0 };
    let chosenTotal = 0;
    (this.legObjs || []).forEach((leg, i) => {
      if (!leg) return;
      const chosen = this.modeState[i];
      leg.modes.forEach((m) => {
        if (!m.disabled && totals[m.key] != null) totals[m.key] += m.minutes || 0;
      });
      const hit = leg.modes.find((m) => m.key === chosen) || leg.modes.find((m) => !m.disabled);
      chosenTotal += (hit && hit.minutes) || 0;
      leg.chosen = chosen;
    });
    this.setData({ totals, chosenTotal, legs: this.legRows() });
  },

  /** 按每段所选方式着色画折线 */
  draw() {
    const stops = this.visibleStops || [];
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

    const underlays = [];
    const lines = [];
    (this.legObjs || []).forEach((leg, i) => {
      if (!leg) return;
      const a = PLACE_MAP[leg.fromId];
      const b = PLACE_MAP[leg.toId];
      if (!a || !b) return;
      const pts = travel.legPoints(leg, a, b) || [];
      if (pts.length < 2) return;
      underlays.push({ points: pts, color: '#FFFFFFCC', width: 15 });
      lines.push({ points: pts, color: MODE_COLOR[this.modeState[i]] || '#b0392e', width: 9 });
    });

    this.setData({ markers, polyline: underlays.concat(lines) });
  },

  /** 切某一段的交通方式 */
  onModeTap(e) {
    const data = e.currentTarget.dataset;
    const idx = Number(data.leg);
    const leg = (this.legObjs || []).find((x) => x && x.index === idx);
    if (!leg) return;
    const mode = leg.modes.find((m) => m.key === data.mode && !m.disabled);
    if (!mode) return;
    const pos = this.legObjs.indexOf(leg);
    this.modeState[pos] = mode.key;
    this.recalc();
    this.draw();
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
  },

  onCloseDetail() {
    this.setData({ activeId: '', active: null, stopCard: null });
    this.clearMap();
  },

  onRouteTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeId) return;
    this.setRoute(id);
  },

  /** 一键把这条路线加进「我的行程」（按当前选的交通方式） */
  onUseRoute() {
    const stops = this.visibleStops || [];
    if (stops.length < 2) return;
    wx.showModal({
      title: '用这条路线替换我的行程？',
      content: `会加入 ${stops.length} 个点，并保留你选的交通方式`,
      confirmText: '替换',
      success: (res) => {
        if (!res.confirm) return;
        trip.clear();
        stops.forEach((s) => trip.add(s.id));
        (this.legObjs || []).forEach((leg, i) => {
          if (leg) trip.setMode(leg.fromId, leg.toId, this.modeState[i]);
        });
        wx.navigateTo({ url: '/pages/trip/index' });
      }
    });
  },

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
