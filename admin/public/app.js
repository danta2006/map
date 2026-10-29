/* 标点地图 · 后台前端（原生 JS，无依赖） */

const state = {
  data: null, // { places:{places:[]}, routes:{routes:[]}, cities:{cities:[]}, categories:{categories:[],radius:{}} }
  tab: 'routes',
  routeId: '',
  placeId: '',
  placeFilter: ''
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function setStatus(text, ok = true) {
  const s = $('#status');
  s.textContent = text;
  s.className = 'status ' + (ok ? 'ok' : 'err');
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.status);
  return json;
}

async function loadData() {
  state.data = await api('/api/data');
  setStatus(`已加载：${state.data.places.places.length} 个点位 / ${state.data.routes.routes.length} 条路线`);
  renderAll();
}

function renderAll() {
  renderRoutes();
  renderPlaces();
  renderCities();
}

/* ---------------- 路线 ---------------- */
function renderRoutes() {
  const ul = $('#routeList');
  ul.innerHTML = '';
  state.data.routes.routes.forEach((r) => {
    const li = el('li', 'item' + (r.id === state.routeId ? ' active' : ''));
    li.appendChild(el('div', 'item-title', r.name));
    li.appendChild(el('div', 'item-sub', `${r.city} · ${r.stops.length} 站 · ${r.legs.length} 段交通`));
    li.onclick = () => {
      state.routeId = r.id;
      renderRoutes();
      renderRouteEditor();
    };
    ul.appendChild(li);
  });
}

function renderRouteEditor() {
  const box = $('#routeEditor');
  const route = state.data.routes.routes.find((r) => r.id === state.routeId);
  if (!route) {
    box.innerHTML = '<p class="hint">← 从左边选一条路线</p>';
    return;
  }
  const places = state.data.places.places;
  const cityPlaces = places.filter((p) => p.city === route.city);

  box.innerHTML = '';
  box.appendChild(el('h2', null, `编辑路线：${route.name}（${route.id}）`));

  const form = el('div', 'form');

  form.appendChild(field('名称', input('text', route.name, (v) => (route.name = v))));
  form.appendChild(
    field(
      '城市',
      select(
        state.data.cities.cities.map((c) => ({ value: c.id, label: c.name })),
        route.city,
        (v) => {
          route.city = v;
          renderRouteEditor();
        }
      )
    )
  );
  form.appendChild(field('颜色', input('color', route.color, (v) => (route.color = v))));
  form.appendChild(field('简介', textarea(route.desc, (v) => (route.desc = v), 2)));

  const stopBox = el('div', 'field');
  stopBox.appendChild(el('label', null, '站点顺序（每行一个点位 id）'));
  const ta = textarea(route.stops.join('\n'), (v) => {
    route.stops = v
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }, 8);
  stopBox.appendChild(ta);
  const hint = el('div', 'hint');
  hint.textContent = '可用点位（' + route.city + '）：' + cityPlaces.map((p) => `${p.id}（${p.name}）`).join('、');
  stopBox.appendChild(hint);
  form.appendChild(stopBox);

  const warn = el('p', 'warn');
  warn.textContent =
    '注意：改了站点顺序后，legs（交通段）不会自动重算。需要在新顺序下重新抓交通数据时，用 scripts/fetch_legs.py 跑一遍再粘回来。';
  form.appendChild(warn);

  const actions = el('div', 'actions');
  const save = el('button', 'primary', '保存路线');
  save.onclick = () => saveRoutes(route);
  actions.appendChild(save);
  form.appendChild(actions);

  box.appendChild(form);
}

async function saveRoutes(route) {
  try {
    await api('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'routes', data: { routes: state.data.routes.routes } })
    });
    setStatus(`已保存路线「${route.name}」（还没导出到小程序）`);
    renderRoutes();
  } catch (e) {
    setStatus('保存失败：' + e.message, false);
  }
}

/* ---------------- 点位 ---------------- */
function renderPlaces() {
  const ul = $('#placeList');
  const kw = state.placeFilter.trim().toLowerCase();
  const list = state.data.places.places.filter((p) => {
    if (!kw) return true;
    return [p.name, p.id, p.city, p.category, (p.tags || []).join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(kw);
  });
  $('#placeCount').textContent = `${list.length} / ${state.data.places.places.length} 个点位`;
  ul.innerHTML = '';
  list.slice(0, 200).forEach((p) => {
    const li = el('li', 'item' + (p.id === state.placeId ? ' active' : ''));
    li.appendChild(el('div', 'item-title', `${p.emoji} ${p.name}`));
    li.appendChild(el('div', 'item-sub', `${p.id} · ${p.city} · ${p.category}`));
    li.onclick = () => {
      state.placeId = p.id;
      renderPlaces();
      renderPlaceEditor();
    };
    ul.appendChild(li);
  });
}

function renderPlaceEditor() {
  const box = $('#placeEditor');
  const p = state.data.places.places.find((x) => x.id === state.placeId);
  if (!p) {
    box.innerHTML = '<p class="hint">← 从左边选一个点位</p>';
    return;
  }
  box.innerHTML = '';
  box.appendChild(el('h2', null, `编辑点位：${p.name}`));

  const form = el('div', 'form');
  form.appendChild(field('名称', input('text', p.name, (v) => (p.name = v))));
  form.appendChild(field('emoji', input('text', p.emoji, (v) => (p.emoji = v), 'width:120px')));
  form.appendChild(
    field(
      '分类',
      select(
        state.data.categories.categories.map((c) => ({ value: c.key, label: c.name })),
        p.category,
        (v) => (p.category = v)
      )
    )
  );
  form.appendChild(field('一句话（≤30 字）', input('text', p.summary, (v) => (p.summary = v))));
  form.appendChild(field('标签（逗号分隔）', input('text', (p.tags || []).join(','), (v) => {
    p.tags = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  })));
  form.appendChild(field('简介', textarea(p.intro, (v) => (p.intro = v), 5)));
  form.appendChild(field('备注或补充', textarea(p.note || '', (v) => (p.note = v), 3)));
  form.appendChild(field('地址', input('text', p.address, (v) => (p.address = v))));
  form.appendChild(field('开放时间', input('text', p.openTime, (v) => (p.openTime = v))));
  form.appendChild(field('建议时长（分钟）', input('number', p.durationMin, (v) => (p.durationMin = Number(v) || 60))));
  form.appendChild(field('纬度', input('text', p.latitude, (v) => (p.latitude = Number(v)))));
  form.appendChild(field('经度', input('text', p.longitude, (v) => (p.longitude = Number(v)))));

  const actions = el('div', 'actions');
  const save = el('button', 'primary', '保存点位');
  save.onclick = () => savePlaces(p);
  actions.appendChild(save);
  form.appendChild(actions);
  box.appendChild(form);
}

async function savePlaces(p) {
  try {
    await api('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'places', data: { places: state.data.places.places } })
    });
    setStatus(`已保存点位「${p.name}」（还没导出到小程序）`);
    renderPlaces();
  } catch (e) {
    setStatus('保存失败：' + e.message, false);
  }
}

/* ---------------- 城市 ---------------- */
function renderCities() {
  const box = $('#cityEditor');
  box.innerHTML = '';
  box.appendChild(el('h2', null, '城市默认视野'));
  const form = el('div', 'form');
  state.data.cities.cities.forEach((c) => {
    const row = el('div', 'city-row');
    row.appendChild(el('div', 'city-name', `${c.name}（${c.id}）`));
    row.appendChild(field('纬度', input('text', c.center.latitude, (v) => (c.center.latitude = Number(v)), 'width:130px')));
    row.appendChild(field('经度', input('text', c.center.longitude, (v) => (c.center.longitude = Number(v)), 'width:130px')));
    row.appendChild(field('缩放', input('text', c.scale, (v) => (c.scale = Number(v)), 'width:90px')));
    form.appendChild(row);
  });
  const actions = el('div', 'actions');
  const save = el('button', 'primary', '保存城市');
  save.onclick = async () => {
    try {
      await api('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'cities', data: { cities: state.data.cities.cities } })
      });
      setStatus('已保存城市视野（还没导出到小程序）');
    } catch (e) {
      setStatus('保存失败：' + e.message, false);
    }
  };
  actions.appendChild(save);
  form.appendChild(actions);
  box.appendChild(form);
}

/* ---------------- 小控件 ---------------- */
function field(label, control) {
  const box = el('div', 'field');
  box.appendChild(el('label', null, label));
  box.appendChild(control);
  return box;
}

function input(type, value, onChange, style) {
  const i = document.createElement('input');
  i.type = type;
  i.value = value == null ? '' : value;
  if (style) i.setAttribute('style', style);
  i.oninput = () => onChange(i.value);
  return i;
}

function textarea(value, onChange, rows) {
  const t = document.createElement('textarea');
  t.value = value == null ? '' : value;
  t.rows = rows || 3;
  t.oninput = () => onChange(t.value);
  return t;
}

function select(options, value, onChange) {
  const s = document.createElement('select');
  options.forEach((o) => {
    const op = el('option', null, o.label);
    op.value = o.value;
    s.appendChild(op);
  });
  s.value = value;
  s.onchange = () => onChange(s.value);
  return s;
}

/* ---------------- 事件 ---------------- */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    state.tab = tab;
    ['routes', 'places', 'cities'].forEach((t) => {
      $('#tab-' + t).classList.toggle('hidden', t !== tab);
    });
  };
});

$('#placeSearch').oninput = (e) => {
  state.placeFilter = e.target.value;
  renderPlaces();
};

$('#exportBtn').onclick = async () => {
  try {
    setStatus('导出中…');
    const res = await api('/api/export', { method: 'POST' });
    const text = res.results.map((r) => `${r.file}（${r.items} 条）`).join('；');
    setStatus('已导出：' + text);
  } catch (e) {
    setStatus('导出失败：' + e.message, false);
  }
};

loadData().catch((e) => setStatus('加载失败：' + e.message, false));
