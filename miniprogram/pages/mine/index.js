const theme = require('../../utils/theme');
const points = require('../../utils/points');

const RULES = points.RULES;

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const day = points.today(ts);
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (day === points.today()) return '今天 ' + hm;
  if (day === points.today(Date.now() - 86400000)) return '昨天 ' + hm;
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
}

Page({
  data: {
    theme: 'light',
    themeMode: 'auto',
    total: 0,
    todayGain: 0,
    nick: '',
    uidText: '',
    stats: { routes: 0, checkins: 0, feedbacks: 0, invites: 0, shares: 0, sharedToday: false },
    rules: RULES,
    log: [],
    logCount: 0,
    cardPath: '',
    cloud: false
  },

  onLoad() {
    theme.apply(this, { nav: true });
  },

  onShow() {
    theme.apply(this, { nav: true });
    this.refresh();
    this.pullCloud();
  },

  /** 汇总 + 明细 */
  refresh() {
    const s = points.summary();
    const app = getApp();
    this.setData({
      total: s.total,
      todayGain: s.todayGain,
      nick: s.nick,
      uidText: s.uid.slice(-6).toUpperCase(),
      stats: s.stats,
      log: s.log.map((e) => ({
        id: e.id,
        type: e.type,
        note: e.note,
        amount: e.amount,
        timeText: fmtTime(e.at)
      })),
      logCount: s.log.length,
      cloud: !!(app && app.globalData && app.globalData.cloudReady)
    });
  },

  /** 云端奖励（邀请分），失败就算了，不打扰用户 */
  pullCloud() {
    const app = getApp();
    if (!app || !app.globalData || !app.globalData.cloudReady) return;
    points
      .pullCloudAwards()
      .then((r) => {
        if (r && r.added) {
          this.refresh();
          wx.showToast({ title: '邀请奖励 +' + r.added * 25, icon: 'none' });
        }
      })
      .catch(() => {});
  },

  onNickBlur(e) {
    const v = (e.detail && e.detail.value) || '';
    points.setNick(v);
    this.setData({ nick: points.getNick() });
  },

  /** 生成漫游记忆卡（canvas 2d） */
  onMakeCard() {
    if (this.data.cardPath) {
      this.preview();
      return;
    }
    const s = points.summary();
    wx.showLoading({ title: '生成中' });
    this.drawCard(s)
      .then((path) => {
        wx.hideLoading();
        if (path) {
          this.setData({ cardPath: path });
          wx.showToast({ title: '记忆卡已生成', icon: 'success' });
        } else {
          wx.showToast({ title: '当前环境生成不了图片，可直接分享', icon: 'none' });
        }
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '生成失败，可直接分享', icon: 'none' });
      });
  },

  drawCard(s) {
    return new Promise((resolve) => {
      if (typeof wx === 'undefined' || !wx.createSelectorQuery) {
        resolve('');
        return;
      }
      wx.createSelectorQuery()
        .in(this)
        .select('#card')
        .fields({ node: true, size: true })
        .exec((res) => {
          const item = res && res[0];
          if (!item || !item.node) {
            resolve('');
            return;
          }
          const canvas = item.node;
          const w = item.width || 300;
          const h = item.height || 450;
          const dpr = 2;
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          const ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);

          // 背景
          const g = ctx.createLinearGradient(0, 0, w, h);
          g.addColorStop(0, '#fbf8f2');
          g.addColorStop(0.55, '#f6efe2');
          g.addColorStop(1, '#efe6d4');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);

          // 顶部色带
          ctx.fillStyle = '#b0392e';
          ctx.fillRect(0, 0, w, 8);

          ctx.fillStyle = '#8b8373';
          ctx.font = '13px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('长株潭 · 标点地图', 24, 44);

          ctx.fillStyle = '#1d1c19';
          ctx.font = 'bold 24px sans-serif';
          ctx.fillText((s.nick || '旅行者') + ' 的漫游记忆', 24, 82);

          // 大数字
          ctx.fillStyle = '#b0392e';
          ctx.font = 'bold 64px sans-serif';
          ctx.fillText(String(s.total), 24, 176);
          ctx.fillStyle = '#1d1c19';
          ctx.font = '14px sans-serif';
          ctx.fillText('累计积分', 24, 200);

          // 数据
          ctx.fillStyle = '#3f3c35';
          ctx.font = '15px sans-serif';
          const rows = [
            ['打卡点位', s.stats.checkins + ' 个'],
            ['完成路线', s.stats.routes + ' 条'],
            ['同行好友', s.stats.invites + ' 人'],
            ['反馈纠错', s.stats.feedbacks + ' 条']
          ];
          rows.forEach((r, i) => {
            const y = 250 + i * 44;
            ctx.fillStyle = '#736d61';
            ctx.fillText(r[0], 24, y);
            ctx.fillStyle = '#1d1c19';
            ctx.textAlign = 'right';
            ctx.fillText(r[1], w - 24, y);
            ctx.textAlign = 'left';
            ctx.strokeStyle = '#e5ddce';
            ctx.beginPath();
            ctx.moveTo(24, y + 12);
            ctx.lineTo(w - 24, y + 12);
            ctx.stroke();
          });

          ctx.fillStyle = '#8b8373';
          ctx.font = '12px sans-serif';
          ctx.fillText(points.today() + ' 生成 · 扫码或打开小程序看我的行程', 24, h - 24);

          setTimeout(() => {
            wx.canvasToTempFilePath({
              canvas,
              success: (r) => resolve(r.tempFilePath || ''),
              fail: () => resolve('')
            });
          }, 60);
        });
    });
  },

  preview() {
    const path = this.data.cardPath;
    if (!path) return;
    wx.previewImage({ urls: [path] });
  },

  /** 分享：记忆卡 +10（每天一次）；邀请走 inviter 参数 */
  onShareAppMessage(res) {
    const kind = (res && res.target && res.target.dataset && res.target.dataset.kind) || 'card';
    if (kind === 'invite') {
      const s = points.summary();
      return {
        title: '和我一起逛长株潭，走完第一条路线送 25 积分',
        path: '/pages/map/index?inviter=' + s.uid
      };
    }
    const r = points.share();
    if (r.ok) {
      this.refresh();
      wx.showToast({ title: '分享成功 +' + r.amount, icon: 'none' });
    }
    return {
      title: '我的长株潭漫游记忆 · 累计 ' + this.data.total + ' 积分',
      path: '/pages/map/index',
      imageUrl: this.data.cardPath || ''
    };
  },

  onShareTimeline() {
    return {
      title: '长株潭标点地图 · 我的漫游记忆',
      query: 'inviter=' + points.summary().uid
    };
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/map/index' });
  }
});