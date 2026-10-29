// 一次性：把小程序里的 data/*.js 导成后台可编辑的 JSON（admin/data/*.json）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram', 'data');
const DATA = path.join(__dirname, 'data');

const places = require(path.join(MP, 'places.js'));
const routes = require(path.join(MP, 'routes.js'));
const cities = require(path.join(MP, 'cities.js'));

fs.mkdirSync(DATA, { recursive: true });

function save(name, obj) {
  fs.writeFileSync(path.join(DATA, name + '.json'), JSON.stringify(obj, null, 2), 'utf8');
  const size = fs.statSync(path.join(DATA, name + '.json')).size;
  console.log(`  ${name}.json  ${(size / 1024).toFixed(1)} KB`);
}

save('categories', { categories: places.CATEGORIES, radius: places.CATEGORY_RADIUS });
save('places', { places: places.PLACES });
save('routes', { routes: routes.ROUTES });
save('cities', { cities: cities.CITIES });
console.log('\n已导出到 admin/data/');
