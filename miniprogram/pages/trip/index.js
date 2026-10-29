const app = getApp();
const { PLACES, CATEGORY_MAP } = require('../../data/places');
const { CITY_MAP } = require('../../data/cities');
const { formatDistance } = require('../../utils/geo');
const trip = require('../../utils/trip');
const travel = require('../../utils/travel');

const MARKER_SIZE = { width: 30, height: 38 };
const LEG_MARKER_SIZE = { width: 22, height: 22 };
const LEG_MARKER_BASE = 100; // 交通图标 marker 的 id 从 100 开始，点位是 0..n-1

const PLACE_MAP = {};
PLACES.forEach((p) => {
  PLACE_MAP[p.id] = p;
});

Page({
  data: {
    statusBarHeight: 20,
    center: { latitude: 27.852, longitude: 112.915 },
    scale: 12.5,
    stops: [],
    rows: [],
    legs: [],
    markers: [],
    polyline: [],
    summary: null,
    empty: true,
    // 排序面板：hidden=只留一条底栏；half=半屏；full=铺满
    panel: 'half',
    panelH: 400,
    panelY: 400,
    draggingPanel: false,
    dragHint: '',
    draggingId: '',
    activeId: '',
    scrollTo: '',
    // 点路线弹出的分段卡片
    legCard: null,
    cardBottom: 0
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.winH = sys.windowHeight;
    this.rpx = sys.windowWidth / 750;

    // 顶部栏（返回键 + 标题 + 分段统计）的高度，和地图页保持一致
    this.topGap = (app.globalData.statusBarHeight || 20) + 52;
    this.panelTop = this.topGap;
    this.panelH = this.winH - this.topGap;
    const halfH = Math.max(260, Math.min(this.panelH, Math.round(this.winH * 0.42)));
    this.halfH = halfH;

    this.setData({
      statusBarHeight: app.globalData.statusBarHeight,
      panelH: this.panelH,
      panelY: this.panelH
    });

    this.mapCtx = wx.createMapContext('trip-map', this);
    this.refresh({ fit: true });
    this.loaded = true;
  },

  onShow() {
    // 从地图页/详情页返回时，点位可能变了
    if (!this.loaded) return;
    this.refresh({ fit: true });
  },

  /** 面板三种状态对应的纵向位移（px） */
  panelYFor(state) {
    if (state === 'full') return 0;
    if (state === 'hidden') return this.panelH;
    return Math.max(0, this.panelH - this.halfH);
  },

  /** 重新从 storage 读取行程，算出站点、路段、地图标记、折线和统计 */
  refresh(options) {
    const opts = options || {};
    const data = trip.getTrip();
    const stops = [];

    data.ids.forEach((id) => {
      const p = PLACE_MAP[id];
      if (!p) return;
      const category = CATEGORY_MAP[p.category] || {};
      const city = CITY_MAP[p.city] || {};
      stops.push({
        id,
        index: stops.length,
        name: p.name,
        emoji: p.emoji,
        latitude: p.latitude,
        longitude: p.longitude,
        categoryName: category.name || '',
        color: category.color || '#2c6b63',
        cityName: city.name || '',
        durationMin: p.durationMin || 60,
        address: p.address || '',
        // 这个点有没有打过卡（打卡记录存在 storage 里）
        checked: !!wx.getStorageSync('checkin_' + p.id)
      });
    });

    // 相邻两站之间的交通信息（legs[i] = stops[i] → stops[i+1]）
    const legs = [];
    for (let i = 1; i < stops.length; i++) {
      const leg = travel.buildLeg(stops[i - 1].id, stops[i].id);
      if (!leg) continue;
      const modeKey = trip.modeOf(data, leg.fromId, leg.toId, leg.modeKey);
      const mode = travel.pickMode(leg, modeKey);
      legs[i - 1] = Object.assign({}, leg, {
        index: i - 1,
        modeKey: mode.key,
        modeName: mode.name,
        modeColor: mode.color,
        modeMinutes: mode.minutes,
        modeText: `约 ${travel.formatMinutes(mode.minutes)}`,
        transitWeak: !!(leg.modes[1] && leg.modes[1].weak)
      });
    }

    // 面板列表：站点和交通段交替
    const rows = [];
    stops.forEach((stop, i) => {
      rows.push({
        type: 'stop',
        key: 'stop-' + stop.id,
        stopIndex: i,
        rowId: 'stop-row-' + i,
        data: stop
      });
      if (legs[i]) {
        rows.push({
          type: 'leg',
          key: 'leg-' + legs[i].key,
          legIndex: i,
          data: legs[i]
        });
      }
    });

    // 统计：游玩时长 = 各点建议时长；在途 = 选定交通方式的时长；里程 = 各段道路里程
    const visitMin = stops.reduce((sum, s) => sum + s.durationMin, 0);
    const travelMin = legs.reduce((sum, l) => sum + (l ? l.modeMinutes : 0), 0);
    const meters = legs.reduce((sum, l) => sum + (l ? l.distance : 0), 0);
    const doneCount = stops.filter((s) => s.checked).length;
    const progress = stops.length
      ? { done: doneCount, total: stops.length, percent: Math.round((doneCount / stops.length) * 100) }
      : null;

    const summary = stops.length
      ? {
          count: stops.length,
          done: doneCount,
          progressText: `已打卡 ${doneCount}/${stops.length}`,
          visitText: travel.formatMinutes(visitMin),
          travelText: travel.formatMinutes(travelMin),
          totalText: travel.formatMinutes(visitMin + travelMin),
          distanceText: formatDistance(meters),
          legCount: legs.length
        }
      : null;

    // 地图：编号图钉 + 交通方式小图标（段数太多就不放，避免挤成一团）
    const markers = stops.map((s, i) => ({
      id: i,
      latitude: s.latitude,
      longitude: s.longitude,
      iconPath: `/assets/marker/num-${i + 1}.png`,
      width: MARKER_SIZE.width,
      height: MARKER_SIZE.height,
      anchor: { x: 0.5, y: 1 },
      zIndex: 20,
      callout: {
        content: `${i + 1}. ${s.name}`,
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

    if (legs.length && legs.length <= 10) {
      legs.forEach((leg, i) => {
        const mid = travel.legMidpoint(leg, stops[i], stops[i + 1]);
        if (!mid) return;
        const labelText = leg.crossCity
          ? `跨城 ${leg.distanceText}`
          : `${leg.modeMinutes} 分`;
        markers.push({
          id: LEG_MARKER_BASE + i,
          latitude: mid.latitude,
          longitude: mid.longitude,
          // 透明 1px 图标：只显示下面的文字标签，不再画小圆点
          iconPath: '/assets/marker/blank.png',
          width: 1,
          height: 1,
          anchor: { x: 0.5, y: 0.5 },
          zIndex: 10,
          label: {
            content: labelText,
            color: '#1d1c19',
            fontSize: 9,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: '#e5ddce',
            bgColor: '#fffdf8',
            padding: 3,
            textAlign: 'center',
            anchorX: 0,
            anchorY: -6
          }
        });
      });
    }

    // 折线：按选中的交通方式上色，先白描边再彩色，和精选路线页一个做法
    const polyline = [];
    legs.forEach((leg, i) => {
      if (!leg || leg.crossCity) return; // 跨城不画线，用中点标签说明
      const points = travel.legPoints(leg, stops[i], stops[i + 1]);
      if (!points || points.length < 2) return;
      polyline.push({ points, color: '#FFFFFFCC', width: 13 });
      polyline.push({ points, color: leg.modeColor, width: 8 });
    });

    // 面板状态：空行程收起来；第一次有数据默认半屏
    let panel = this.data.panel;
    if (!stops.length) panel = 'hidden';
    else if (!this.ready) panel = 'hidden'; // 首次进来先收着，别一上来就挡住地图

    // 排序用的「整块」：一个站点 + 它后面那段交通，整块一起拖
    const blocks = stops.map((stop, i) => ({
      key: 'block-' + stop.id,
      index: i,
      rowId: 'stop-row-' + i,
      stop,
      leg: legs[i] || null,
      offset: 0
    }));

    const next = {
      stops,
      rows,
      blocks,
      legs,
      markers,
      polyline,
      summary,
      progress,
      empty: stops.length === 0,
      panel,
      panelY: this.panelYFor(panel)
    };

    // 操作后把列表滚动到刚动过的那一行
    if (opts.focusId) {
      const index = stops.map((s) => s.id).indexOf(opts.focusId);
      if (index >= 0) {
        next.activeId = opts.focusId;
        next.scrollTo = 'stop-row-' + index;
      }
    }

    if (stops.length === 1) {
      next.center = { latitude: stops[0].latitude, longitude: stops[0].longitude };
      next.scale = 15;
    }

    this.ready = true;
    this.setData(next, () => {
      if (opts.fit !== false && stops.length) setTimeout(() => this.fitView(), 200);
    });
  },

  /** 让所有点位落进地图可视区（扣掉顶部栏和底部面板占的高度） */
  fitView() {
    const stops = this.data.stops;
    if (!stops.length) return;
    this.mapCtx = this.mapCtx || wx.createMapContext('trip-map', this);
    if (stops.length === 1) {
      this.setData({
        center: { latitude: stops[0].latitude, longitude: stops[0].longitude },
        scale: 15
      });
      return;
    }
    const panel = this.data.panel;
    const covered = panel === 'hidden' ? 0 : (panel === 'full' ? this.panelH : this.halfH);
    this.mapCtx.includePoints({
      points: stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
      padding: [this.topGap + 70, 60, covered + 70, 60]
    });
  },

  setPanel(state) {
    this.setData({ panel: state, panelY: this.panelYFor(state), draggingPanel: false });
    setTimeout(() => this.fitView(), 320);
  },

  /** 顶部/底栏的「隐藏排序 / 显示排序」按钮 */
  togglePanel() {
    if (this.data.empty) return;
    this.setPanel(this.data.panel === 'hidden' ? 'half' : 'hidden');
  },

  /** 点面板把手：半屏 ↔ 全屏 */
  onPanelTap() {
    if (Math.abs(this.grabMoved || 0) > 10) {
      this.grabMoved = 0;
      return;
    }
    this.setPanel(this.data.panel === 'full' ? 'half' : 'full');
  },

  onGrabStart(e) {
    this.grabStartY = e.touches[0].clientY;
    this.grabStartOffset = this.data.panelY;
    this.grabMoved = 0;
    this.setData({ draggingPanel: true });
  },

  onGrabMove(e) {
    if (!this.grabStartY) return;
    const dy = e.touches[0].clientY - this.grabStartY;
    this.grabMoved = dy;
    const y = Math.max(0, Math.min(this.panelH, this.grabStartOffset + dy));
    this.setData({ panelY: y });
  },

  onGrabEnd() {
    if (!this.grabStartY) return;
    this.grabStartY = 0;
    const y = this.data.panelY;
    const candidates = ['full', 'half', 'hidden'].map((state) => ({
      state,
      y: this.panelYFor(state)
    }));
    candidates.sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y));
    this.setPanel(candidates[0].state);
  },

  /** 点地图上的编号图钉 */
  onMarkerTap(e) {
    const id = e.detail.markerId;
    if (id >= LEG_MARKER_BASE) {
      // 点两站之间的「30 分」时间图标 = 点这一段路线
      this.openLegCard(id - LEG_MARKER_BASE);
      return;
    }
    this.focusStop(id);
  },

  onCalloutTap(e) {
    const id = e.detail.markerId;
    if (id === undefined || id === null) return;
    if (id >= LEG_MARKER_BASE) return;
    this.focusStop(id);
  },

  /** 选中某个站点：高亮列表行、滚到那一行、面板至少半屏 */
  focusStop(index) {
    const stop = this.data.stops[index];
    if (!stop) return;
    this.lastMarkerTapAt = Date.now();
    this.setData({ activeId: stop.id, scrollTo: 'stop-row-' + index });
    if (this.data.panel === 'hidden') this.setPanel('half');
  },

  onMapTap(e) {
    if (this.data.legCard) {
      this.closeLegCard();
      return;
    }
    // 点在路线附近也算点路线（微信的折线点击要正好戳中，比较难触发）
    const d = (e && e.detail) || {};
    if (d.latitude != null && d.longitude != null && Date.now() - (this.lastMarkerTapAt || 0) > 250) {
      const near = this.nearestLeg(d.latitude, d.longitude);
      if (near.index >= 0 && near.meters <= this.tapToleranceMeters(d.latitude)) {
        this.openLegCard(near.index);
        return;
      }
    }
    if (Date.now() - (this.lastMarkerTapAt || 0) < 250) return;
    if (this.data.activeId) this.setData({ activeId: '' });
  },

  /** 点列表里的站点：和点图钉一样，选中 + 居中 */
  onStopTap(e) {
    const index = Number(e.currentTarget.dataset.stop);
    if (isNaN(index)) return;
    const stop = this.data.stops[index];
    if (!stop) return;
    this.setData({
      activeId: stop.id,
      center: { latitude: stop.latitude, longitude: stop.longitude }
    });
  },

  onMoveStop(e) {
    const index = Number(e.currentTarget.dataset.stop);
    const dir = Number(e.currentTarget.dataset.dir);
    const stop = this.data.stops[index];
    if (!stop || !dir) return;
    const to = index + dir;
    if (to < 0 || to >= this.data.stops.length) return;
    trip.move(stop.id, to);
    this.refresh({ fit: false, focusId: stop.id });
  },

  onRemoveStop(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    trip.remove(id);
    this.refresh({ fit: true });
    wx.showToast({ title: '已移出行程', icon: 'none' });
  },

  onClear() {
    if (!this.data.stops.length) return;
    wx.showModal({
      title: '清空行程？',
      content: '点位和排序都会被清掉，重新选一遍就好。',
      confirmText: '清空',
      cancelText: '再想想',
      success: (r) => {
        if (!r.confirm) return;
        trip.clear();
        this.refresh({ fit: false });
      }
    });
  },

  /** 找离坐标最近的一段路线（点到折线顶点的最近距离） */
  nearestLeg(lat, lng) {
    const legs = this.data.legs || [];
    const stops = this.data.stops || [];
    let best = -1;
    let bestDist = Infinity;

    legs.forEach((leg, i) => {
      const path = leg.path || [];
      const a = stops[i];
      const b = stops[i + 1];
      const pts = path.length > 1
        ? path.map((pt) => ({ latitude: pt[1], longitude: pt[0] }))
        : a && b
          ? [{ latitude: a.latitude, longitude: a.longitude }, { latitude: b.latitude, longitude: b.longitude }]
          : [];
      pts.forEach((pt) => {
        const dy = (pt.latitude - lat) * 111320;
        const dx = (pt.longitude - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      });
    });

    return { index: best, meters: bestDist };
  },

  /** 当前缩放下"手指头能碰到"的容差（米） */
  tapToleranceMeters(lat) {
    const scale = this.viewScale || this.data.scale || 13;
    const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, scale);
    return Math.max(60, Math.min(400, metersPerPx * 45));
  },

  /** 记录真实缩放（只存实例，不 setData，避免地图抖） */
  onViewChange(e) {
    if (e && e.scale) this.viewScale = e.scale;
    else if (this.mapCtx && this.mapCtx.getScale) {
      this.mapCtx.getScale({
        success: (r) => {
          if (r && r.scale) this.viewScale = r.scale;
        },
        fail: () => {}
      });
    }
  },

  /** 点地图上的路线：找出离点击位置最近的一段，弹分段卡片 */
  onPolylineTap(e) {
    const d = (e && e.detail) || {};
    const lat = d.latitude;
    const lng = d.longitude;
    if (lat == null || lng == null) return;

    const near = this.nearestLeg(lat, lng);
    if (near.index >= 0 && near.meters <= this.tapToleranceMeters(lat) * 1.4) {
      this.openLegCard(near.index);
    }
  },

  /** 弹出某一段的卡片（三种方式可点选切换） */
  openLegCard(index) {
    const leg = (this.data.legs || [])[index];
    const stops = this.data.stops || [];
    if (!leg || !stops[index] || !stops[index + 1]) return;

    const card = {
      index,
      from: stops[index].id,
      to: stops[index + 1].id,
      fromName: stops[index].name,
      toName: stops[index + 1].name,
      distanceText: leg.distanceText,
      estimated: !!(leg.estimated || leg.modes.every((m) => !m.real)),
      modes: leg.modes.map((m) => ({
        key: m.key,
        name: m.name,
        minutes: m.minutes,
        active: m.key === leg.modeKey,
        real: !!m.real
      }))
    };

    this.setData({
      legCard: card,
      cardBottom: Math.max(80, this.winH - this.data.panelY + 12)
    });
  },

  closeLegCard() {
    this.setData({ legCard: null });
  },

  /** 卡片里点某种交通方式：改这段的方式并刷新地图折线 */
  onCardModeTap(e) {
    const ds = e.currentTarget.dataset;
    const card = this.data.legCard;
    if (!card || !ds.mode) return;
    trip.setMode(card.from, card.to, ds.mode);
    this.refresh({ fit: false });
    // refresh 后重新算卡片里的选中态
    setTimeout(() => {
      const leg = (this.data.legs || [])[card.index];
      if (!leg) return;
      const fresh = this.data.legCard;
      if (!fresh || fresh.index !== card.index) return;
      this.setData({
        legCard: Object.assign({}, fresh, {
          modes: leg.modes.map((m) => ({
            key: m.key,
            name: m.name,
            minutes: m.minutes,
            active: m.key === leg.modeKey,
            real: !!m.real
          }))
        })
      });
    }, 60);
  },

  /** 切换某一段的交通方式：地图上的线和时间会一起变 */
  onModeTap(e) {
    const ds = e.currentTarget.dataset;
    if (!ds.from || !ds.to || !ds.mode) return;
    trip.setMode(ds.from, ds.to, ds.mode);
    this.refresh({ fit: false });
  },

  // ---------- 拖动排序：长按整块卡片 → 整块跟手移动，松手落位 ----------
  onBlockTouchStart(e) {
    const block = Number(e.currentTarget.dataset.block);
    if (isNaN(block) || !this.data.stops[block]) return;
    this.dragBlock = block;
    this.dragTarget = block;
    this.dragStartY = e.touches[0].clientY;
    this.dragMoved = 0;
    this.draggingBlock = false;
    this.dragTimer = setTimeout(() => {
      if (Math.abs(this.dragMoved) > 10) return;
      if (this.data.stops.length < 2) return;
      // 长按 260ms 还没怎么移动 → 进入拖动
      this.draggingBlock = true;
      this.dragQueried = false;
      this.setData({ draggingId: this.data.stops[this.dragBlock].id, dragHint: '拖动中，松手落位' });
      try {
        wx.vibrateShort({ type: 'light', fail: () => {} });
      } catch (err) {}
      wx.createSelectorQuery()
        .in(this)
        .selectAll('.stop-block')
        .boundingClientRect((rects) => {
          this.blockRects = rects || [];
        })
        .exec();
    }, 260);
  },

  onBlockTouchMove(e) {
    if (this.dragBlock == null) return;
    const y = e.touches[0].clientY;
    const dy = y - this.dragStartY;
    this.dragMoved = dy;

    // 还没进入拖动：手指明显移动就当成滚动，取消长按
    if (!this.draggingBlock) {
      if (Math.abs(dy) > 10 && this.dragTimer) {
        clearTimeout(this.dragTimer);
        this.dragTimer = null;
        this.dragBlock = null;
      }
      return;
    }
    if (!this.blockRects || !this.blockRects.length) return;

    // 找手指最近的一块 → 目标位置
    let target = this.dragBlock;
    let best = Infinity;
    this.blockRects.forEach((r, i) => {
      const d = Math.abs(r.top + r.height / 2 - y);
      if (d < best) {
        best = d;
        target = i;
      }
    });
    this.dragTarget = target;

    const H = this.blockRects[this.dragBlock].height;
    const blocks = this.data.blocks.map((b, j) => {
      let offset = 0;
      if (j === this.dragBlock) offset = dy;
      else if (this.dragBlock < target && j > this.dragBlock && j <= target) offset = -H;
      else if (this.dragBlock > target && j >= target && j < this.dragBlock) offset = H;
      return Object.assign({}, b, { offset });
    });
    this.setData({ blocks });
  },

  onBlockTouchEnd() {
    if (this.dragTimer) {
      clearTimeout(this.dragTimer);
      this.dragTimer = null;
    }
    const from = this.dragBlock;
    const to = this.dragTarget;
    const wasDragging = this.draggingBlock;
    this.dragBlock = null;
    this.dragTarget = null;
    this.draggingBlock = false;
    this.blockRects = null;
    this.dragStartY = 0;
    if (!wasDragging) return;

    this.setData({ draggingId: '', dragHint: '' });
    const stop = from != null ? this.data.stops[from] : null;
    if (!stop || typeof to !== 'number' || to === from) {
      this.refresh({ fit: false });
      return;
    }
    trip.move(stop.id, to);
    this.refresh({ fit: false, focusId: stop.id });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    wx.reLaunch({ url: '/pages/map/index' });
  },

  /** 把当前行程发到社区（跳上传页） */
  onSaveRoute() {
    if ((this.data.stops || []).length < 2) {
      wx.showToast({ title: '至少 2 个点才能存成路线', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/route-upload/index' });
  },

  onGoMap() {
    this.onBack();
  },

  // ---------- 搜索加点：面板里搜到点位，点一下直接加入行程 ----------
  onSearchChange() {
    // 搜索结果行里已经 toggle 过 storage，这里只负责刷新地图和排序列表
    this.refresh({ fit: false });
  },

  /** 输入框获得焦点时把面板拉到全屏，避免键盘把结果挡住 */
  onSearchFocus() {
    if (this.data.panel !== 'full') this.setPanel('full');
  },

  /** 空行程时的「搜索点位」按钮：展开面板并聚焦搜索框 */
  onSearchEmpty() {
    this.setPanel('half');
    setTimeout(() => {
      const comp = this.selectComponent ? this.selectComponent('#placeSearch') : null;
      if (comp && comp.focus) comp.focus();
    }, 340);
  }
});