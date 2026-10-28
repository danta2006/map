/**
 * 上传前的静态检查：每个页面 WXML 里绑定的事件，JS 里必须真的定义了
 * 用法：node scripts/check_pages.js
 *
 * 起因：有一次改代码误删了 toggleCityPicker，WXML 还绑着它，
 * 点击"没反应"但控制台也不报错，很难查。这个脚本专门抓这种问题。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'miniprogram', 'app.json');

const app = JSON.parse(fs.readFileSync(APP, 'utf8'));
let failed = 0;

for (const page of app.pages) {
  const base = path.join(ROOT, 'miniprogram', page);
  const wxmlPath = base + '.wxml';
  const jsPath = base + '.js';

  if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) {
    console.error(`❌ ${page}: 缺 .wxml 或 .js`);
    failed++;
    continue;
  }

  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const js = fs.readFileSync(jsPath, 'utf8');

  // 1. 事件处理函数是否都定义了
  const handlers = [...new Set([...wxml.matchAll(/\b(?:bind|catch)[a-z]+="([A-Za-z_$][\w$]*)"/g)].map((m) => m[1]))];
  const missing = handlers.filter((h) => !new RegExp(`(^|[^\\w$.])${h}\\s*\\(`, 'm').test(js));

  // 2. 标签是否闭合
  const stack = [];
  for (const t of wxml.matchAll(/<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    if (t[0].startsWith('</')) {
      // <image></image> 这类自闭合标签不用配对
      if (['input', 'image', 'img'].includes(t[1])) continue;
      const last = stack.pop();
      if (last !== t[1]) stack.push(`不匹配: ${t[1]} vs ${last}`);
    } else if (!t[3] && !['input', 'image', 'img'].includes(t[1])) {
      stack.push(t[1]);
    }
  }

  if (missing.length || stack.length) {
    failed++;
    console.error(`❌ ${page}`);
    if (missing.length) console.error(`   未定义的事件处理函数: ${missing.join(', ')}`);
    if (stack.length) console.error(`   标签问题: ${stack.join(' | ')}`);
  } else {
    console.log(`✅ ${page}（${handlers.length} 个事件）`);
  }
}

if (failed) {
  console.error(`\n共 ${failed} 个页面有问题，先修好再上传。`);
  process.exit(1);
}
console.log('\n全部页面检查通过，可以上传。');
