// 把 admin/data/*.json 生成回小程序用的 JS 数据文件
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');
const MP = path.join(ROOT, 'miniprogram', 'data');

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8'));
}

// 字符串一律走 JSON.stringify：引号、\r、\n、U+2028 等全部安全转义，
// 杜绝把 admin/data 里的内容当代码拼进生成的 JS（数据→代码注入）
const q = (s) => JSON.stringify(String(s == null ? '' : s));

// 数值必须先过 Number + isFinite：字符串型"数字"（可能夹带代码片段）直接报错，不写文件
function num(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`非法数字（${label || '?'}）：${JSON.stringify(v)}`);
  return n;
}

// 对象 key 只认合法标识符
function ident(k, label) {
  const s = String(k == null ? '' : k);
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s)) throw new Error(`非法标识符（${label || '?'}）：${JSON.stringify(s)}`);
  return s;
}

const arr = (a) => '[' + (Array.isArray(a) ? a : []).map(q).join(', ') + ']';

function writePlaces() {
  const { categories, radius } = read('categories');
  const { places } = read('places');

  const catLines = categories
    .map((c) => {
      const parts = [`key: ${q(c.key)}`, `name: ${q(c.name)}`, `color: ${q(c.color)}`];
      if (c.emoji) parts.push(`emoji: ${q(c.emoji)}`);
      return `  { ${parts.join(', ')} }`;
    })
    .join(',\n');
  const radLines = categories.map((c) => `  ${ident(c.key, '分类 key')}: ${num(radius[c.key], '打卡半径 ' + c.key)}`).join(',\n');

  const blocks = places.map((p, i) => {
    const fields = [
      ['id', q(p.id)],
      ['name', q(p.name)],
      ['city', q(p.city)],
      ['category', q(p.category)],
      ['emoji', q(p.emoji)],
      ['tags', arr(p.tags || [])],
      ['latitude', String(num(p.latitude, p.id + '.latitude'))],
      ['longitude', String(num(p.longitude, p.id + '.longitude'))],
      ['summary', q(p.summary)],
      ['intro', q(p.intro)],
      ['note', q(p.note || '')],
      ['address', q(p.address)],
      ['openTime', q(p.openTime)],
      ['durationMin', String(num(p.durationMin, p.id + '.durationMin'))]
    ];
    const body = fields.map(([k, v], j) => `    ${k}: ${v}${j < fields.length - 1 ? ',' : ''}`).join('\n');
    return `  {\n${body}\n  }${i === places.length - 1 ? '' : ','}`;
  });

  const js = `/**
 * 点位数据（由 admin 后台导出，勿手改；改数据请用 \`node admin/server.js\`）
 */
const CATEGORIES = [
${catLines}
];

const CATEGORY_MAP = {};
CATEGORIES.forEach((c) => {
  CATEGORY_MAP[c.key] = c;
});

// 打卡半径（米）：单个点位可用 radius 字段覆盖
const CATEGORY_RADIUS = {
${radLines}
};

const PLACES = [
${blocks.join('\n')}
];

module.exports = { CATEGORIES, PLACES, CATEGORY_MAP, CATEGORY_RADIUS };
`;
  fs.writeFileSync(path.join(MP, 'places.js'), js, 'utf8');
  return { file: 'miniprogram/data/places.js', items: places.length };
}

function writeRoutes() {
  const { routes } = read('routes');

  const blocks = routes.map((r, i) => {
    const legLines = (r.legs || [])
      .map((l) => {
        const pathStr = (l.path || []).map((pt) => `[${num(pt[0], 'leg.path 经度')}, ${num(pt[1], 'leg.path 纬度')}]`).join(', ');
        return `      { from: ${q(l.from)}, to: ${q(l.to)}, mode: ${q(l.mode)}, distance: ${num(l.distance, r.id + '.distance')}, minutes: ${num(l.minutes, r.id + '.minutes')}, text: ${q(l.text)}${l.path ? `, path: [${pathStr}]` : ''} }`;
      })
      .join(',\n');
    const pathLines = [];
    const rp = r.path || [];
    for (let k = 0; k < rp.length; k += 6) {
      pathLines.push('      ' + rp.slice(k, k + 6).map((pt) => `[${num(pt[0], 'route.path 经度')}, ${num(pt[1], 'route.path 纬度')}]`).join(', '));
    }
    return `  {
    id: ${q(r.id)},
    city: ${q(r.city)},
    name: ${q(r.name)},
    desc: ${q(r.desc)},
    color: ${q(r.color)},
    stops: ${arr(r.stops)},
    legs: [
${legLines}
    ],
    path: [
${pathLines.join(',\n')}
    ]
  }${i === routes.length - 1 ? '' : ','}`;
  });

  const js = `/**
 * 精选路线（由 admin 后台导出，勿手改）
 * - stops：点位 id 顺序
 * - legs：相邻两站交通（高德路线规划）
 * - path：沿道路的真实折线
 */
const ROUTES = [
${blocks.join('\n')}
];

module.exports = { ROUTES };
`;
  fs.writeFileSync(path.join(MP, 'routes.js'), js, 'utf8');
  return { file: 'miniprogram/data/routes.js', items: routes.length };
}

function writeCities() {
  const { cities } = read('cities');
  const lines = cities
    .map(
      (c) =>
        `  { id: ${q(c.id)}, name: ${q(c.name)}, center: { latitude: ${num(c.center.latitude, c.id + '.latitude')}, longitude: ${num(c.center.longitude, c.id + '.longitude')} }, scale: ${num(c.scale, c.id + '.scale')} }`
    )
    .join(',\n');
  const js = `/**
 * 城市列表：小程序目前支持长株潭三城
 * center/scale 是每个城市打开时的默认视野
 */
const CITIES = [
${lines}
];

const CITY_MAP = {};
CITIES.forEach((c) => {
  CITY_MAP[c.id] = c;
});

module.exports = { CITIES, CITY_MAP };
`;
  fs.writeFileSync(path.join(MP, 'cities.js'), js, 'utf8');
  return { file: 'miniprogram/data/cities.js', items: cities.length };
}

function exportAll() {
  const results = [writePlaces(), writeRoutes(), writeCities()];
  return results;
}

module.exports = { exportAll, q, num, ident };

if (require.main === module) {
  console.log('导出：');
  exportAll().forEach((r) => console.log(`  ✅ ${r.file}（${r.items} 条）`));
}
