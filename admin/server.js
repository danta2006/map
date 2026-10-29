// 标点地图 · 本地后台服务（无依赖，node admin/server.js 就能跑）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exportAll } = require('./export');

const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const DATA = path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');

const NAMES = ['places', 'routes', 'cities', 'categories'];

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8'));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 20 * 1024 * 1024) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  try {
    // ---------- API ----------
    if (url.pathname === '/api/data' && req.method === 'GET') {
      const out = {};
      NAMES.forEach((n) => {
        out[n] = readJson(n);
      });
      return send(res, 200, out);
    }

    if (url.pathname === '/api/save' && req.method === 'POST') {
      const payload = await body(req);
      const name = payload.name;
      if (!NAMES.includes(name)) return send(res, 400, { error: '未知数据名：' + name });
      if (!payload.data || typeof payload.data !== 'object') return send(res, 400, { error: 'data 为空' });
      const file = path.join(DATA, name + '.json');
      fs.writeFileSync(file, JSON.stringify(payload.data, null, 2), 'utf8');
      return send(res, 200, { ok: true, file: `admin/data/${name}.json`, bytes: fs.statSync(file).size });
    }

    if (url.pathname === '/api/export' && req.method === 'POST') {
      const results = exportAll();
      return send(res, 200, { ok: true, results });
    }

    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, port: PORT, data: NAMES });
    }

    // ---------- 静态文件 ----------
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const abs = path.join(PUBLIC, file.replace(/^\/+/, ''));
    if (!abs.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) return send(res, 404, { error: 'not found' });
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    send(res, 500, { error: String(e && e.message ? e.message : e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n标点地图后台已启动：http://${HOST}:${PORT}\n`);
  console.log('  数据目录：admin/data/*.json');
  console.log('  导出目标：miniprogram/data/{places,routes,cities}.js');
  console.log('  按 Ctrl+C 停止\n');
});
