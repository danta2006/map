// 清洗 realLegs.js：剔除明显不合理的高德返回值（绕路、公交方案离谱等）
const fs = require('fs');

const FILE = 'C:/微信小程序/miniprogram/data/realLegs.js';
const { REAL_PAIRS } = require(FILE);

const RULES = {
  // [最小米/分钟, 最大米/分钟]
  walk: [40, 130],
  taxi: [180, 1500],
  transit: [90, 1200]
};

const out = {};
let dropped = 0;
const detail = [];

for (const key of Object.keys(REAL_PAIRS)) {
  const src = REAL_PAIRS[key];
  const rec = {};
  for (const mode of ['walk', 'taxi', 'transit']) {
    const v = src[mode];
    if (!v) continue;
    const [meters, minutes] = v;
    const speed = meters / Math.max(1, minutes);
    const [lo, hi] = RULES[mode];
    let ok = meters > 80 && speed >= lo && speed <= hi;
    // 公交：1 公里内骑车更快，直接不要；超过 90 分钟的不合理
    if (mode === 'transit' && (meters < 1000 || minutes > 90)) ok = false;
    // 打车：1 公里内如果耗时超过 10 分钟，多半是绕路，丢掉
    if (mode === 'taxi' && meters < 1000 && minutes > 10) ok = false;
    if (ok) rec[mode] = v;
    else {
      dropped++;
      detail.push(`${key} ${mode} ${meters}m/${minutes}min -> 丢弃`);
    }
  }
  if (Object.keys(rec).length) out[key] = rec;
}

const lines = Object.keys(out)
  .sort()
  .map((k) => {
    const r = out[k];
    const parts = [];
    for (const m of ['walk', 'taxi', 'transit']) if (r[m]) parts.push(`${m}: [${r[m][0]}, ${r[m][1]}]`);
    return `  '${k}': { ${parts.join(', ')} },`;
  });

fs.writeFileSync(
  FILE,
  `/**\n * 两点之间的真实交通时间（由 scripts/fetch_real_legs.py 抓取 + 清洗，勿手改）\n * key = 两个点位 id 排序后用 | 连接；value = { walk/taxi/transit: [米, 分钟] }\n * 已剔除明显不合理的值（公交 1 公里内 / 打车近距离绕路 / 速度异常）\n */\nconst REAL_PAIRS = {\n${lines.join('\n')}\n};\n\nmodule.exports = { REAL_PAIRS };\n`,
  'utf8'
);

console.log('清洗前点对:', Object.keys(REAL_PAIRS).length, '→ 清洗后:', Object.keys(out).length, '| 剔除数值:', dropped);
console.log(detail.slice(0, 12).join('\n'));
