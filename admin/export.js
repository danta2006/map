// 把 admin/data/*.json 生成回小程序用的 JS 数据文件
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(__dirname, 'data');
const MP = path.join(ROOT, 'miniprogram', 'data');

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8'));
}

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const arr = (a) => '[' + a.map(q).join(', ') + ']';

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
  const radLines = categories.map((c) => `  ${c.key}: ${radius[c.key]}`).join(',\n');

  const blocks = places.map((p, i) => {
    const fields = [
      ['id', q(p.id)],
      ['name', q(p.name)],
      ['city', q(p.city)],
      ['category', q(p.category)],
      ['emoji', q(p.emoji)],
      ['tags', arr(p.tags || [])],
      ['latitude', String(p.latitude)],
      ['longitude', String(p.longitude)],
      ['summary', q(p.summary)],
      ['intro', q(p.intro)],
      ['note', q(p.note || '')],
      ['address', q(p.address)],
      ['openTime', q(p.openTime)],
      ['durationMin', String(p.durationMin)]
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
        const pathStr = (l.path || []).map((pt) => `[${pt[0]}, ${pt[1]}]`).join(', ');
        return `      { from: ${q(l.from)}, to: ${q(l.to)}, mode: ${q(l.mode)}, distance: ${l.distance}, minutes: ${l.minutes}, text: ${q(l.text)}${l.path ? `, path: [${pathStr}]` : ''} }`;
      })
      .join(',\n');
    const pathLines = [];
    const rp = r.path || [];
    for (let k = 0; k < rp.length; k += 6) {
      pathLines.push('      ' + rp.slice(k, k + 6).map((pt) => `[${pt[0]}, ${pt[1]}]`).join(', '));
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
        `  { id: ${q(c.id)}, name: ${q(c.name)}, center: { latitude: ${c.center.latitude}, longitude: ${c.center.longitude} }, scale: ${c.scale} }`
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

module.exports = { exportAll };

if (require.main === module) {
  console.log('导出：');
  exportAll().forEach((r) => console.log(`  ✅ ${r.file}（${r.items} 条）`));
}
