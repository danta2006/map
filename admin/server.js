// 标点地图 · 本地后台服务（无依赖，node admin/server.js 就能跑）
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { exportAll } = require('./export');

const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';
const DATA = path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const ROOT = path.join(__dirname, '..');

const NAMES = ['places', 'routes', 'cities', 'categories', 'feedback'];
const EXPORTABLE = new Set(['places', 'routes', 'cities', 'categories']);

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readJson(name) {
  const file = path.join(DATA, name + '.json');
  if (!fs.existsSync(file)) return name === 'feedback' ? { feedback: [] } : {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(name, obj) {
  const file = path.join(DATA, name + '.json');
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  return fs.statSync(file).size;
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

// 给小程序反馈接口放行跨域（开发者工具里是 file:// 场景）
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/** 跑脚本（重算交通/路径/照片），返回输出尾巴 */
function runScript(scriptRel, env) {
  return new Promise((resolve) => {
    const child = spawn(
      process.env.PYTHON_BIN || 'python',
      ['-X', 'utf8', path.join(ROOT, scriptRel)],
      { cwd: ROOT, env: Object.assign({}, process.env, env || {}) }
    );
    let out = '';
    const cap = (buf) => {
      out += buf.toString('utf8');
      if (out.length > 20000) out = out.slice(-20000);
    };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    child.on('close', (code) => resolve({ code, output: out.slice(-4000) }));
    child.on('error', (e) => resolve({ code: -1, output: String(e.message || e) }));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  cors(res);
  if (req.method === 'OPTIONS') return send(res, 204, '');

  try {
    // ---------- 数据读写 ----------
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
      const bytes = writeJson(name, payload.data);
      return send(res, 200, { ok: true, file: `admin/data/${name}.json`, bytes });
    }

    if (url.pathname === '/api/export' && req.method === 'POST') {
      const results = exportAll();
      return send(res, 200, { ok: true, results });
    }

    // ---------- 用户反馈 ----------
    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      const payload = await body(req);
      const text = String(payload.text || '').trim();
      if (!text) return send(res, 400, { error: '反馈内容为空' });
      const store = readJson('feedback');
      store.feedback = store.feedback || [];
      const item = {
        id: 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        at: Date.now(),
        text: text.slice(0, 2000),
        contact: String(payload.contact || '').slice(0, 100),
        placeId: String(payload.placeId || ''),
        placeName: String(payload.placeName || ''),
        page: String(payload.page || ''),
        status: 'new'
      };
      store.feedback.unshift(item);
      writeJson('feedback', store);
      return send(res, 200, { ok: true, id: item.id, total: store.feedback.length });
    }

    if (url.pathname === '/api/feedback' && req.method === 'GET') {
      return send(res, 200, readJson('feedback'));
    }

    // ---------- 一键重算（需要进程里有 AMAP_KEY） ----------
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      const payload = await body(req);
      const what = payload.what || 'legs';
      const pyEnv = { AMAP_KEY: process.env.AMAP_KEY || '' };
      if (!pyEnv.AMAP_KEY) return send(res, 400, { error: '后台进程没有 AMAP_KEY，重启时先设置环境变量' });

      const todo = [];
      if (what === 'legs' || what === 'all') todo.push('scripts/fetch_legs.py');
      if (what === 'paths' || what === 'all') todo.push('scripts/fetch_pair_paths.py');
      if (what === 'photos' || what === 'all') todo.push('scripts/fetch_photos.py');

      const results = [];
      for (const script of todo) {
        results.push({ script, result: await runScript(script, pyEnv) });
      }
      return send(res, 200, { ok: true, results });
    }

    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, port: PORT, data: NAMES, hasKey: !!process.env.AMAP_KEY });
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
  console.log(`  重算交通/路径：${process.env.AMAP_KEY ? '可用（已检测到 AMAP_KEY）' : '不可用（启动时设置 $env:AMAP_KEY）'}`);
  console.log('  按 Ctrl+C 停止\n');
});
