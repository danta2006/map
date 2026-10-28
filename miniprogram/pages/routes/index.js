const app = getApp();
const { PLACES } = require('../../data/places');
const { ROUTES } = require('../../data/routes');
const { CITIES, CITY_MAP } = require('../../data/cities');
const { distance } = require('../../utils/geo');

const PLACE_MAP = {};
PLACES.forEach((p) => {
  PLACE_MAP[p.id] = p;
});

Page({
  data: {
    statusBarHeight: 20,
    cities: [],
    activeCity: 'xiangtan',
    cityName: '湘潭',
    showCityPicker: false,
    cityRoutes: [],
    activeId: '',
    active: null,
    center: { latitude: 27.852, longitude: 112.915 },
    scale: 12.5,
    markers: [],
    polyline: [],
    totalKm: '0.0',
    tab: 'stops', // stops = 站点；legs = 交通
    legs: [],
    stopCard: null,
    legCard: null
  },

  onLoad(options) {
    const cities = CITIES.map((c) => ({
      ...c,
      count: ROUTES.filter((r) => r.city === c.id).length
    }));
    this.setData({ statusBarHeight: app.globalData.statusBarHeight, cities });
    this.mapCtx = wx.createMapContext('route-map', this);
    this.visibleStops = [];

    const cityId = options && CITY_MAP[options.city] ? options.city : 'xiangtan';
    this.switchCity(cityId);
  },

  /** 切城市：只显示这个城市的路线 */
  switchCity(cityId) {
    const city = CITY_MAP[cityId];
    if (!city) return;
    const list = ROUTES.filter((r) => r.city === cityId);
    this.setData({
      activeCity: cityId,
      cityName: city.name,
      cityRoutes: list,
      showCityPicker: false,
      center: { ...city.center },
      scale: city.scale
    });
    if (list.length) this.setRoute(list[0].id);
  },

  /** 切路线 */
  setRoute(id) {
    const route = this.data.cityRoutes.find((r) => r.id === id);
    if (!route) return;

    const stops = route.stops.map((sid) => PLACE_MAP[sid]).filter(Boolean);
    this.visibleStops = stops;
    this.rawLegs = route.legs || [];
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

    const points = stops.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));

    // 折线优先用沿道路的真实路径（routes.js 里的 path），没有才退化成直线
    const linePoints =
      route.path && route.path.length > 1
        ? route.path.map((pt) => ({ latitude: pt[1], longitude: pt[0] }))
        : points;

    // 里程用交通段的实测距离累加，比两点直线准
    const realMeters = (route.legs || []).reduce((sum, l) => sum + (l.distance || 0), 0);
    let meters = realMeters;
    if (!meters) {
      for (let i = 1; i < stops.length; i++) {
        meters += distance(
          stops[i - 1].latitude, stops[i - 1].longitude,
          stops[i].latitude, stops[i].longitude
        );
      }
    }

    const legs = (route.legs || []).map((l, i) => ({
      index: i + 1,
      from: (PLACE_MAP[l.from] || {}).name || l.from,
      to: (PLACE_MAP[l.to] || {}).name || l.to,
      fromId: l.from,
      toId: l.to,
      mode: l.mode,
      modeText: { walk: '步行', transit: '公交/地铁', taxi: '打车' }[l.mode] || '步行',
      text: l.text
    }));

    wx.setNavigationBarTitle({ title: route.name });

    this.setData({
      activeId: id,
      active: { ...route, stops },
      markers,
      polyline: [
        { points: linePoints, color: '#FFFFFFCC', width: 14 },
        { points: linePoints, color: route.color, width: 9 }
      ],
      totalKm: (meters / 1000).toFixed(1),
      tab: 'stops',
      legs,
      stopCard: null,
      legCard: null
    });

    setTimeout(() => {
      this.mapCtx.includePoints({ points, padding: [200, 80, 300, 80] });
    }, 300);
  },

  onRouteTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeId) return;
    this.setRoute(id);
  },

  switchTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab });
    this.setCard(null);
  },

  toggleCityPicker() {
    // 打开城市面板时先收起卡片，避免面板和卡片叠在一起
    this.setData({ showCityPicker: !this.data.showCityPicker });
    if (!this.data.showCityPicker) this.setCard(null);
  },

  /** 统一管理卡片：同一时间只允许一张（交通段卡片 / 地点卡片） */
  setCard(kind, payload) {
    if (kind === 'leg') {
      this.setData({ legCard: payload, stopCard: null });
    } else if (kind === 'stop') {
      this.setData({ stopCard: payload, legCard: null });
    } else {
      this.setData({ legCard: null, stopCard: null });
    }
  },

  onCityTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeCity) {
      this.setData({ showCityPicker: false });
      return;
    }
    this.switchCity(id);
  },

  onMarkerTap(e) {
    this.openStopCard(e.detail.markerId);
  },

  /** 点到地图自带 POI（2.3.0+）：如果这个 POI 在路线附近，也算点了路线 */
  onPoiTap(e) {
    const d = e.detail || {};
    if (d.latitude == null || d.longitude == null) return;
    const near = this.nearestLeg(d.latitude, d.longitude);
    if (near.index >= 0 && near.meters <= this.tapToleranceMeters(d.latitude)) {
      this.openLegCard(near.index);
    }
  },

  /** 记录真实缩放级别（只存实例变量，不 setData，避免地图抖动） */
  onViewChange(e) {
    if (e && e.scale) this.currentScale = e.scale;
    if (e && e.centerLocation) this.currentCenter = e.centerLocation;
  },

  /**
   * 点地图上的路线（3.1.0+ 的 bindpolylinetap）
   * 事件只给点击处的经纬度，按"离哪一段路径最近"判断是哪一段
   */
  onPolylineTap(e) {
    const detail = e.detail || {};
    const lng = detail.longitude;
    const lat = detail.latitude;
    if (lng == null || lat == null) return;

    const near = this.nearestLeg(lat, lng);
    if (near.index >= 0 && near.meters <= this.tapToleranceMeters(lat) * 1.5) {
      this.openLegCard(near.index);
    }
  },

  /** 点路线 → 显示这一段交通卡片 */
  openLegCard(index) {
    const leg = this.data.legs[index];
    if (!leg) return;
    this.lastMapTapAt = Date.now();
    this.setCard('leg', leg);
  },

  closeLegCard() {
    this.setCard(null);
  },

  /** 点地点 → 显示这个点前后两段的路线 */
  openStopCard(index) {
    const stop = this.visibleStops[index];
    if (!stop) return;
    const legs = this.data.legs;
    this.lastMarkerTapAt = Date.now();
    this.setCard('stop', {
      index: index + 1,
      total: this.visibleStops.length,
      name: stop.name,
      id: stop.id,
      prev: legs[index - 1] || null,
      next: legs[index] || null
    });
  },

  closeStopCard() {
    this.setCard(null);
  },

  onCardDetail() {
    const card = this.data.stopCard;
    if (!card) return;
    wx.navigateTo({ url: `/pages/detail/index?id=${card.id}` });
  },

  /** 找离某个坐标最近的一段路线（点到"线段"的垂距，不是点到顶点） */
  nearestLeg(lat, lng) {
    const raw = this.rawLegs || [];
    const cosLat = Math.cos((lat * Math.PI) / 180);
    let best = -1;
    let bestM = Infinity;

    raw.forEach((leg, i) => {
      const path = leg.path || [];
      for (let k = 1; k < path.length; k++) {
        const ax = path[k - 1][0];
        const ay = path[k - 1][1];
        const bx = path[k][0];
        const by = path[k][1];

        // 局部平面坐标（经度乘 cos 纬度，近似等距）
        const px = (lng - ax) * cosLat;
        const py = lat - ay;
        const dx = (bx - ax) * cosLat;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;

        let t = len2 ? (px * dx + py * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));

        const cx = px - t * dx;
        const cy = py - t * dy;
        const meters = Math.sqrt(cx * cx + cy * cy) * 111320;
        if (meters < bestM) {
          bestM = meters;
          best = i;
        }
      }
    });

    return { index: best, meters: bestM };
  },

  /** 当前缩放级别下，一个手指头大概覆盖多少米（用于"点在线附近"的判定） */
  tapToleranceMeters(lat) {
    const scale = this.currentScale || this.data.scale || 13;
    const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, scale);
    return Math.max(60, Math.min(500, metersPerPx * 55));
  },

  onMapTap(e) {
    // 点 marker 也会触发地图 tap，加个时间窗，否则卡片刚弹出就被关掉
    if (Date.now() - (this.lastMarkerTapAt || 0) < 200) return;

    // 地图 tap 从 2.9.0 起会带经纬度：点在路线附近的也算"点了路线"
    const d = (e && e.detail) || {};
    if (d.latitude != null && d.longitude != null) {
      const near = this.nearestLeg(d.latitude, d.longitude);
      if (near.index >= 0 && near.meters <= this.tapToleranceMeters(d.latitude)) {
        this.openLegCard(near.index);
        return;
      }
    }

    if (Date.now() - (this.lastMapTapAt || 0) < 200) return;
    if (this.data.stopCard || this.data.legCard) this.setCard(null);
  },

  onStopTap(e) {
    this.openStopCard(Number(e.currentTarget.dataset.index));
  }
});
