// Coast to Coast — UI layer
import { MAP } from './data.js';
import * as E from './engine.js';
import { sfx, unlockAudio, setSoundEnabled, haptic } from './sound.js';

const VERSION = '1.0.0';
const PLAYER_COLORS = [
  { id: 'coral', hex: '#ff5a47', name: 'Coral' },
  { id: 'teal', hex: '#12a8a2', name: 'Teal' },
  { id: 'indigo', hex: '#5b4fd6', name: 'Indigo' },
  { id: 'lime', hex: '#86c232', name: 'Lime' },
  { id: 'bronze', hex: '#a2662f', name: 'Bronze' },
];
const PC = Object.fromEntries(PLAYER_COLORS.map(c => [c.id, c.hex]));
const HAND_ORDER = [...E.COLORS, E.LOCO];
const LS = { game: 'c2c.game', settings: 'c2c.settings', history: 'c2c.history', names: 'c2c.names' };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let settings = { sound: true, hints: true, hideHand: true, ...store.get(LS.settings, {}) };
setSoundEnabled(settings.sound);

let G = null;
const ui = { selected: null, viewer: null, busy: false, plan: null, overlay: null, resultsHidden: false };

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const overlayRoot = $('#overlay-root');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cityName = id => E.CITY[id].name;

const TRAIN_SVG = '<svg viewBox="0 0 34 22" aria-hidden="true"><path d="M7 4h4v4h9V3h-2V1h12v2h-2v13H4.5L1 19.5V14l3-1.5V9.5L7 8z"/><rect x="21.5" y="4.5" width="5" height="4" rx=".6" fill="rgba(255,255,255,.6)"/><circle cx="9" cy="18" r="3"/><circle cx="16" cy="18" r="3"/><circle cx="25" cy="17.5" r="3.6"/></svg>';

document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });

// ======================================================================
// Screens
// ======================================================================
function showHome() {
  ui.overlay = null; overlayRoot.innerHTML = '';
  const saved = store.get(LS.game, null);
  const canContinue = saved && !saved.over;
  app.className = 'screen-home';
  app.innerHTML = `
    <div class="home">
      <div class="brand">
        ${logoSvg()}
        <h1>Coast&nbsp;to&nbsp;Coast</h1>
        <p class="tag">Build railways across America</p>
      </div>
      <div class="home-actions">
        ${canContinue ? `<button class="btn primary big" data-a="continue">
            Continue game<small>${saved.players.map(p => esc(p.name)).join(' vs ')} · turn ${saved.turn}</small></button>` : ''}
        <button class="btn ${canContinue ? '' : 'primary'} big" data-a="new">New game</button>
        <div class="row2">
          <button class="btn" data-a="history">Score history</button>
          <button class="btn" data-a="rules">How to play</button>
        </div>
        <button class="btn ghost" data-a="settings">Settings</button>
      </div>
      <footer>v${VERSION} · pass-and-play on one device</footer>
    </div>`;
  app.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    sfx.tap();
    if (a === 'continue') { G = saved; startGameScreen(true); }
    if (a === 'new') showSetup();
    if (a === 'history') showHistory();
    if (a === 'rules') openRules();
    if (a === 'settings') openSettings();
  };
}

function logoSvg() {
  return `<svg class="logo" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="56" fill="#f3e6c8" stroke="#c9a96a" stroke-width="4"/>
    <path d="M18 78 C 40 40, 70 95, 102 44" fill="none" stroke="#17283a" stroke-width="9" stroke-linecap="round"/>
    <path d="M18 78 C 40 40, 70 95, 102 44" fill="none" stroke="#f3e6c8" stroke-width="3" stroke-dasharray="6 6"/>
    <circle cx="18" cy="78" r="9" fill="#ff5a47" stroke="#17283a" stroke-width="3"/>
    <circle cx="102" cy="44" r="9" fill="#12a8a2" stroke="#17283a" stroke-width="3"/>
  </svg>`;
}

function showSetup() {
  const last = store.get(LS.names, ['Player 1', 'Player 2']);
  let n = Math.max(2, Math.min(5, last.length));
  let doubleClosed = null; // null = follow player count
  const names = [...last];
  app.className = 'screen-setup';
  const render = () => {
    const closed = doubleClosed ?? n <= 3;
    app.innerHTML = `
      <div class="setup">
        <header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>New game</h2></header>
        <section class="card-section">
          <label class="lbl">Players</label>
          <div class="seg">${[2, 3, 4, 5].map(k => `<button class="${k === n ? 'on' : ''}" data-n="${k}">${k}</button>`).join('')}</div>
          <div class="names">
            ${Array.from({ length: n }, (_, i) => `
              <div class="name-row">
                <span class="dot" style="background:${PLAYER_COLORS[i].hex}"></span>
                <input type="text" maxlength="14" data-i="${i}" value="${esc(names[i] ?? `Player ${i + 1}`)}" aria-label="Player ${i + 1} name">
              </div>`).join('')}
          </div>
        </section>
        <section class="card-section">
          <label class="lbl">Double routes</label>
          <div class="seg">
            <button class="${closed ? 'on' : ''}" data-dc="1">One side only</button>
            <button class="${!closed ? 'on' : ''}" data-dc="0">Both sides open</button>
          </div>
          <p class="hint">Official rule: with 2–3 players, once one side of a double route is claimed the other closes. A player can never take both sides.</p>
        </section>
        <section class="card-section">
          <label class="lbl">Who goes first</label>
          <p class="hint">Chosen at random when the game starts.</p>
        </section>
        <button class="btn primary big" data-a="start">Start game</button>
      </div>`;
  };
  render();
  app.oninput = e => { if (e.target.dataset.i !== undefined) names[+e.target.dataset.i] = e.target.value; };
  app.onclick = e => {
    const t = e.target.closest('button');
    if (!t) return;
    sfx.tap();
    if (t.dataset.n) { n = +t.dataset.n; render(); }
    if (t.dataset.dc) { doubleClosed = t.dataset.dc === '1'; render(); }
    if (t.dataset.a === 'back') showHome();
    if (t.dataset.a === 'start') {
      const ps = Array.from({ length: n }, (_, i) => ({
        name: (names[i] || '').trim() || `Player ${i + 1}`,
        color: PLAYER_COLORS[i].id,
      }));
      store.set(LS.names, ps.map(p => p.name));
      // random seating order, colours stay with names
      const first = Math.floor(Math.random() * n);
      const ordered = [...ps.slice(first), ...ps.slice(0, first)];
      G = E.newGame(ordered, { doubleClosed: doubleClosed ?? n <= 3 });
      save();
      startGameScreen(false);
    }
  };
}

// ======================================================================
// Game screen
// ======================================================================
let svg, vb, FULL, geom;

function startGameScreen(resumed) {
  ui.selected = null; ui.plan = null; ui.busy = false; ui.viewer = null; ui.resultsHidden = false;
  app.className = 'screen-game';
  app.innerHTML = `
    <div class="game">
      <header class="topbar">
        <button class="icon-btn" id="menuBtn" aria-label="Menu">☰</button>
        <div class="players" id="players"></div>
      </header>
      <div class="mapwrap" id="mapwrap">
        <svg id="map" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="zoom">
          <button class="icon-btn sm" data-z="in" aria-label="Zoom in">+</button>
          <button class="icon-btn sm" data-z="out" aria-label="Zoom out">−</button>
          <button class="icon-btn sm" data-z="fit" aria-label="Fit map">⤢</button>
        </div>
        <div class="banner" id="banner" hidden></div>
        <button class="rotate-tip" id="rotateTip">↻ Turn sideways for a bigger map</button>
      </div>
      <div class="panel" id="panel">
        <div class="status" id="status"></div>
        <div class="market" id="market"></div>
        <div class="handrow">
          <div class="hand" id="hand"></div>
          <button class="ticket-btn" id="ticketBtn"></button>
        </div>
      </div>
    </div>`;
  app.onclick = null; app.oninput = null;
  buildMap();
  $('#menuBtn').onclick = () => { sfx.tap(); openMenu(); };
  $('#ticketBtn').onclick = () => { if (ui.viewer === null || ui.busy) return; sfx.tap(); openTicketsView(); };
  $('#mapwrap .zoom').onclick = e => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (!z) return;
    if (z === 'fit') fitMap(); else zoomAt(z === 'in' ? 1.6 : 1 / 1.6);
  };
  $('#market').onclick = onMarketClick;
  $('#status').onclick = onStatusClick;
  window.onresize = () => { resizeMap(); };
  const tip = $('#rotateTip');
  if (store.get('c2c.tipSeen', false)) tip.remove();
  else tip.onclick = () => { store.set('c2c.tipSeen', true); tip.remove(); };
  renderAll();
  if (G.over) { ui.viewer = null; renderAll(); showGameOver(); return; }
  nextHandoff(resumed);
}

function nextHandoff() {
  if (G.phase === 'setup') {
    const pi = G.players.findIndex(p => p.pending);
    showHandoff(pi, true);
    return;
  }
  if (!settings.hideHand) {
    ui.viewer = G.cur; renderAll(); sfx.turn();
    toast(`${G.players[G.cur].name}'s turn`);
    if (G.phase === 'tickets') openTicketChooser(false);
    return;
  }
  showHandoff(G.cur, false);
}

function save() { store.set(LS.game, G); }

// ---------- map ----------
const LABEL_POS = {
  SEA: [0, -14, 'middle'], POR: [-12, 4, 'end'], SFO: [-12, 4, 'end'], LAX: [-10, 15, 'end'],
  BOI: [0, -13, 'middle'], HEL: [0, -13, 'middle'], BIS: [0, -13, 'middle'], DUL: [0, -13, 'middle'],
  MIN: [-11, 4, 'end'], SLC: [11, -8, 'start'], RAP: [0, -13, 'middle'], OMA: [0, -13, 'middle'],
  CHI: [-4, -13, 'end'], DET: [0, -13, 'middle'], BUF: [0, -13, 'middle'], BOS: [11, 4, 'start'],
  NYC: [11, 8, 'start'], LAS: [11, -6, 'start'], PHX: [-10, 15, 'end'], SAF: [11, -6, 'start'],
  DEN: [11, -8, 'start'], KAN: [11, -8, 'start'], STL: [11, -8, 'start'], PIT: [-6, 17, 'end'],
  WAS: [11, 8, 'start'], ELP: [0, 20, 'middle'], OKC: [-11, 16, 'middle'], DAL: [0, 20, 'middle'],
  HOU: [0, 20, 'middle'], LIT: [0, -13, 'middle'], MEM: [11, -6, 'start'], NAS: [11, -8, 'start'],
  ATL: [-12, 14, 'end'], RAL: [11, -6, 'start'], CHS: [11, 8, 'start'], NOR: [0, 20, 'middle'],
  MIA: [-11, 4, 'end'],
};

function computeGeom() {
  geom = {};
  for (const r of E.ROUTES) {
    const A = E.CITY[r.a], B = E.CITY[r.b];
    const dx = B.x - A.x, dy = B.y - A.y;
    const d = Math.hypot(dx, dy);
    const ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
    const off = r.lane * 5.2;
    const trim = 9;
    const x1 = A.x + ux * trim + nx * off, y1 = A.y + uy * trim + ny * off;
    const x2 = B.x - ux * trim + nx * off, y2 = B.y - uy * trim + ny * off;
    const L = d - trim * 2, gap = 2.6;
    const cl = (L - gap * (r.len - 1)) / r.len;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const cars = [];
    for (let k = 0; k < r.len; k++) {
      const t = (k * (cl + gap) + cl / 2);
      cars.push({ x: x1 + ux * t, y: y1 + uy * t });
    }
    geom[r.id] = { x1, y1, x2, y2, cl, w: r.lane ? 8 : 9.5, ang, cars, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
  }
}

function buildMap() {
  svg = $('#map');
  computeGeom();
  const [, , W, H] = MAP.viewBox;
  FULL = { x: 0, y: 0, w: W, h: H };
  const routesSvg = E.ROUTES.map(r => {
    const g = geom[r.id];
    const cars = g.cars.map((c, k) => `<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${g.ang.toFixed(1)})"><rect class="car" style="--k:${k}" x="${(-g.cl / 2).toFixed(1)}" y="${(-g.w / 2).toFixed(1)}" width="${g.cl.toFixed(1)}" height="${g.w}" rx="1.8"/></g>`).join('');
    return `<g class="route c-${r.color}" data-id="${r.id}">${cars}</g>`;
  }).join('');
  const cities = MAP.cities.map(c => {
    const [dx, dy, anchor] = LABEL_POS[c.id] || [0, -13, 'middle'];
    return `<g class="city" data-id="${c.id}"><circle cx="${c.x}" cy="${c.y}" r="7"/><circle class="inner" cx="${c.x}" cy="${c.y}" r="3"/>
      <text x="${c.x + dx}" y="${c.y + dy}" text-anchor="${anchor}">${esc(c.name)}</text></g>`;
  }).join('');
  svg.innerHTML = `
    <defs>
      <pattern id="waves" width="28" height="14" patternUnits="userSpaceOnUse">
        <path d="M0 10 q7 -6 14 0 t14 0" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.2"/>
      </pattern>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0b1a28" flood-opacity=".35"/></filter>
    </defs>
    <rect x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}" class="sea"/>
    <rect x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}" fill="url(#waves)"/>
    <path d="${MAP.outline}" class="land" filter="url(#shadow)"/>
    ${MAP.lakes.map(d => `<path d="${d}" class="lake"/>`).join('')}
    ${compassSvg(W - 70, H - 70)}
    <g id="routesLayer">${routesSvg}</g>
    <g id="planLayer"></g>
    <g id="hintLayer"></g>
    <g id="citiesLayer">${cities}</g>
    <g id="fxLayer"></g>`;
  setupPanZoom();
  fitMap();
}

function compassSvg(x, y) {
  return `<g class="compass" transform="translate(${x},${y})">
    <circle r="30" fill="none" stroke="rgba(243,230,200,.5)" stroke-width="1.5"/>
    <path d="M0 -36 L6 0 L0 36 L-6 0 Z" fill="rgba(243,230,200,.55)"/>
    <path d="M-36 0 L0 6 L36 0 L0 -6 Z" fill="rgba(243,230,200,.35)"/>
    <text y="-41" text-anchor="middle">N</text></g>`;
}

function fitMap() {
  const cw = svg.clientWidth || 1, ch = svg.clientHeight || 1;
  const a = ch / cw;
  if (a > FULL.h / FULL.w) vb = { x: 0, w: FULL.w, h: FULL.w * a, y: 0 };
  else vb = { y: 0, h: FULL.h, w: FULL.h / a, x: 0 };
  vb.x = (FULL.w - vb.w) / 2; vb.y = (FULL.h - vb.h) / 2;
  applyVB();
}

function resizeMap() {
  if (!svg || !vb) return;
  const cw = svg.clientWidth || 1, ch = svg.clientHeight || 1;
  const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
  vb.h = vb.w * ch / cw;
  vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
  clampVB(); applyVB();
}

function fitScaleW() {
  const cw = svg.clientWidth || 1, ch = svg.clientHeight || 1;
  return ch / cw > FULL.h / FULL.w ? FULL.w : FULL.h * cw / ch;
}

function clampVB() {
  const maxW = fitScaleW() * 1.0001, minW = maxW / 6;
  const a = vb.h / vb.w;
  if (vb.w > maxW) { const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2; vb.w = maxW; vb.h = maxW * a; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; }
  if (vb.w < minW) { const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2; vb.w = minW; vb.h = minW * a; vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2; }
  // keep the map in view
  const clampAxis = (pos, size, full) => size >= full ? (full - size) / 2 : Math.max(-size * 0.15, Math.min(full - size * 0.85, pos));
  vb.x = clampAxis(vb.x, vb.w, FULL.w);
  vb.y = clampAxis(vb.y, vb.h, FULL.h);
}

function applyVB() {
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const k = (svg.clientWidth || 1) / vb.w; // px per unit
  const fs = Math.max(9, Math.min(15, 11.5 / k));
  svg.style.setProperty('--label', fs + 'px');
}

function zoomAt(f, px, py) {
  if (px === undefined) { px = vb.x + vb.w / 2; py = vb.y + vb.h / 2; }
  const nw = vb.w / f, nh = vb.h / f;
  vb.x = px - (px - vb.x) * (nw / vb.w);
  vb.y = py - (py - vb.y) * (nh / vb.h);
  vb.w = nw; vb.h = nh;
  clampVB(); applyVB();
}

function toSvg(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: vb.x + (clientX - r.left) / r.width * vb.w, y: vb.y + (clientY - r.top) / r.height * vb.h };
}

function setupPanZoom() {
  const pts = new Map();
  let tap = null, pinch = null;
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) tap = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
    else { if (tap) tap.moved = true; pinch = null; }
  });
  svg.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };
    pts.set(e.pointerId, cur);
    const r = svg.getBoundingClientRect();
    if (pts.size === 1) {
      if (tap && Math.hypot(cur.x - tap.x, cur.y - tap.y) > 7) tap.moved = true;
      if (!tap || tap.moved) {
        vb.x -= (cur.x - prev.x) / r.width * vb.w;
        vb.y -= (cur.y - prev.y) / r.height * vb.h;
        clampVB(); applyVB();
      }
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinch) {
        const p = toSvg(mx, my);
        zoomAt(d / pinch.d, p.x, p.y);
        vb.x -= (mx - pinch.mx) / r.width * vb.w;
        vb.y -= (my - pinch.my) / r.height * vb.h;
        clampVB(); applyVB();
      }
      pinch = { d, mx, my };
    }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0 && tap && !tap.moved && Date.now() - tap.t < 600) onMapTap(e.clientX, e.clientY);
    if (pts.size === 0) tap = null;
  };
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const p = toSvg(e.clientX, e.clientY);
    zoomAt(Math.exp(-e.deltaY * 0.0022), p.x, p.y);
  }, { passive: false });
  // block iOS page-level pinch
  document.addEventListener('gesturestart', e => e.preventDefault());
}

function distToSeg(px, py, g) {
  const dx = g.x2 - g.x1, dy = g.y2 - g.y1;
  const t = Math.max(0, Math.min(1, ((px - g.x1) * dx + (py - g.y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (g.x1 + t * dx), py - (g.y1 + t * dy));
}

function onMapTap(cx, cy) {
  if (ui.busy || ui.viewer === null || G.over) return;
  const p = toSvg(cx, cy);
  const k = svg.getBoundingClientRect().width / vb.w;
  const thr = Math.max(10, 26 / k);
  let best = null, bd = Infinity;
  for (const r of E.ROUTES) {
    const d = distToSeg(p.x, p.y, geom[r.id]);
    if (d < bd) { bd = d; best = r.id; }
  }
  if (bd > thr) { if (ui.selected !== null || ui.plan) { ui.selected = null; ui.plan = null; renderAll(); } return; }
  sfx.tap();
  ui.selected = best === ui.selected ? null : best;
  renderAll();
}

// ---------- rendering ----------
function renderAll() {
  renderPlayers();
  renderRoutes();
  renderHints();
  renderMarket();
  renderHand();
  renderStatus();
  renderBanner();
}

function renderPlayers() {
  $('#players').innerHTML = G.players.map((p, i) => `
    <div class="pchip ${i === G.cur && !G.over ? 'active' : ''}" style="--pc:${PC[p.color]}">
      <div class="pname"><span class="dot"></span>${esc(p.name)}</div>
      <div class="pstats">
        <span title="Route points"><b>${p.routePts}</b> pts</span>
        <span title="Trains left">🚃${p.trains}</span>
        <span title="Cards">🂠${E.handCount(p)}</span>
        <span title="Tickets">🎫${p.tickets.length}</span>
      </div>
    </div>`).join('');
}

function renderRoutes() {
  const viewer = ui.viewer;
  for (const r of E.ROUTES) {
    const el = svg.querySelector(`.route[data-id="${r.id}"]`);
    const owner = G.claimed[r.id];
    el.classList.toggle('claimed', owner !== undefined);
    if (owner !== undefined) el.style.setProperty('--pc', PC[G.players[owner].color]);
    const closed = owner === undefined && r.pair !== null && G.claimed[r.pair] !== undefined && G.opts.doubleClosed;
    el.classList.toggle('closed', closed);
    el.classList.toggle('sel', ui.selected === r.id);
    const can = settings.hints && viewer !== null && viewer === G.cur && !ui.busy && G.phase === 'play' && G.drawn === 0
      && E.routeStatus(G, viewer, r.id).ok;
    el.classList.toggle('can', !!can);
  }
}

function renderHints() {
  const hl = $('#hintLayer'), pl = $('#planLayer');
  let h = '', pth = '';
  if (ui.viewer !== null && !G.over) {
    const p = G.players[ui.viewer];
    if (settings.hints) {
      const rings = new Map();
      for (const tid of p.tickets) {
        const t = E.TICKETS[tid];
        const done = E.ticketDone(G, ui.viewer, tid);
        for (const c of [t.a, t.b]) if (!rings.has(c) || !done) rings.set(c, done);
      }
      for (const [cid, done] of rings) {
        const c = E.CITY[cid];
        h += `<circle class="ring ${done ? 'done' : ''}" cx="${c.x}" cy="${c.y}" r="12" style="--pc:${PC[p.color]}"/>`;
      }
    }
    if (ui.plan) {
      const t = E.TICKETS[ui.plan.tid];
      for (const rid of ui.plan.routes) {
        const g = geom[rid];
        const own = G.claimed[rid] === ui.viewer;
        pth += `<line class="plan ${own ? 'own' : ''}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`;
      }
      for (const c of [t.a, t.b]) {
        const C = E.CITY[c];
        h += `<circle class="target" cx="${C.x}" cy="${C.y}" r="15"/>`;
      }
    }
  }
  hl.innerHTML = h; pl.innerHTML = pth;
}

function cardHtml(color, { count = null, cls = '', attrs = '' } = {}) {
  return `<div class="card c-${color} ${cls}" ${attrs}><span class="ci">${TRAIN_SVG}</span>${count !== null ? `<span class="cnt">${count}</span>` : ''}</div>`;
}

function renderMarket() {
  const myTurn = ui.viewer !== null && ui.viewer === G.cur && !ui.busy && G.phase === 'play' && !G.over;
  const face = G.faceUp.map((c, i) => c
    ? `<button class="slot ${myTurn && E.canTakeFaceUp(G, i) ? '' : 'off'}" data-f="${i}" aria-label="${E.COLOR_LABEL[c]} card">${cardHtml(c)}</button>`
    : `<div class="slot empty"></div>`).join('');
  const deckN = G.deck.length + G.discard.length;
  $('#market').innerHTML = `
    <div class="faceup">${face}</div>
    <div class="decks">
      <button class="slot ${myTurn && E.canDrawDeck(G) ? '' : 'off'}" data-d="deck" aria-label="Draw from deck">
        <div class="card back"><span class="cnt">${deckN}</span></div></button>
      <button class="slot ${myTurn && E.canDrawTickets(G) ? '' : 'off'}" data-d="tickets" aria-label="Draw destination tickets">
        <div class="tcard"><span>🎫</span><span class="cnt">${G.ticketDeck.length}</span></div></button>
    </div>`;
}

function renderHand() {
  const hand = $('#hand');
  const tb = $('#ticketBtn');
  if (ui.viewer === null) {
    hand.innerHTML = `<div class="hidden-hand">Hand hidden</div>`;
    tb.innerHTML = `🎫`; tb.disabled = true;
    return;
  }
  const p = G.players[ui.viewer];
  const items = HAND_ORDER.filter(c => p.hand[c]).map(c => cardHtml(c, { count: p.hand[c], attrs: `data-c="${c}"` }));
  hand.innerHTML = items.length ? items.join('') : `<div class="hidden-hand">No cards yet</div>`;
  const done = p.tickets.filter(t => E.ticketDone(G, ui.viewer, t)).length;
  tb.disabled = false;
  tb.innerHTML = `<span>🎫</span><b>${done}/${p.tickets.length}</b>`;
  hand.style.setProperty('--pc', PC[p.color]);
}

function renderStatus() {
  const st = $('#status');
  if (G.over) { st.innerHTML = `<div class="msg">Game over. <button class="link" data-s="results">Show results</button></div>`; return; }
  if (ui.viewer === null || ui.busy) {
    st.innerHTML = `<div class="msg muted">${ui.busy ? 'Turn complete…' : `Waiting for ${esc(G.players[G.cur].name)}`}</div>`;
    return;
  }
  const p = G.players[ui.viewer];
  if (ui.selected !== null) { st.innerHTML = claimHtml(ui.selected); return; }
  if (ui.plan) {
    const t = E.TICKETS[ui.plan.tid];
    st.innerHTML = `<div class="msg plan-msg"><span>Showing <b>${esc(cityName(t.a))} → ${esc(cityName(t.b))}</b>: ${ui.plan.cost ? `${ui.plan.cost} more train${ui.plan.cost === 1 ? '' : 's'} needed` : 'complete!'}</span><button class="icon-btn sm" data-s="clearplan" aria-label="Clear">✕</button></div>`;
    return;
  }
  let msg;
  if (G.phase === 'tickets') msg = 'Choose which destination tickets to keep.';
  else if (G.drawn === 1) msg = E.mustEndTurnManually(G)
    ? `No cards left to draw. <button class="link" data-s="endturn">End turn</button>`
    : '<b>Take one more card</b> (a face-up locomotive isn’t allowed now).';
  else msg = `<b>${esc(p.name)}</b>, draw 2 cards, tap a route to claim it, or take 🎫 tickets.`;
  st.innerHTML = `<div class="msg" style="--pc:${PC[p.color]}">${msg}</div>`;
}

function claimHtml(rid) {
  const r = E.ROUTES[rid];
  const vi = ui.viewer;
  const head = `<div class="claim-head">
      <span class="swatch c-${r.color}"></span>
      <b>${esc(cityName(r.a))} – ${esc(cityName(r.b))}</b>
      <span class="chip">${r.len} 🚃</span><span class="chip">+${E.ROUTE_POINTS[r.len]} pts</span>
      <button class="icon-btn sm" data-s="close" aria-label="Close">✕</button></div>`;
  let body = '';
  const owner = G.claimed[rid];
  const st = E.routeStatus(G, vi, rid);
  if (owner !== undefined) body = `<p>Claimed by <b style="color:${PC[G.players[owner].color]}">${esc(G.players[owner].name)}</b>.</p>`;
  else if (st.reason === 'closed') body = `<p>Closed — the other side of this double route is taken.</p>`;
  else if (st.reason === 'ownpair') body = `<p>You already own the other side of this double route.</p>`;
  else if (vi !== G.cur) body = `<p>Not your turn.</p>`;
  else if (G.phase !== 'play') body = `<p>Finish choosing tickets first.</p>`;
  else if (G.drawn) body = `<p>You’ve drawn a card — take your second card to finish the turn.</p>`;
  else if (st.reason === 'trains') body = `<p>Not enough trains (you have ${G.players[vi].trains}).</p>`;
  else if (st.reason === 'cards') {
    const p = G.players[vi];
    const need = r.color === 'gray' ? `${r.len} cards of one colour` : `${r.len} ${E.COLOR_LABEL[r.color].toLowerCase()} cards`;
    const have = r.color === 'gray' ? Math.max(0, ...E.COLORS.map(c => p.hand[c] || 0)) : (p.hand[r.color] || 0);
    body = `<p>Needs ${need}. You have ${have}${p.hand.loco ? ` + ${p.hand.loco} locomotive${p.hand.loco > 1 ? 's' : ''}` : ''}.</p>`;
  } else {
    const opts = E.paymentOptions(G, vi, rid);
    body = `<div class="payopts">${opts.map((o, k) => `
      <button class="pay" data-pay="${k}">
        <span class="paycards">${o.colored ? cardHtml(o.color, { count: o.colored, cls: 'tiny' }) : ''}${o.locos ? cardHtml('loco', { count: o.locos, cls: 'tiny' }) : ''}</span>
        <span>Claim</span></button>`).join('')}</div>`;
  }
  return `<div class="claim">${head}${body}</div>`;
}

function renderBanner() {
  const b = $('#banner');
  if (G.finalTurns !== null && !G.over) {
    b.hidden = false;
    b.textContent = `Final round · ${G.finalTurns} turn${G.finalTurns === 1 ? '' : 's'} left`;
  } else b.hidden = true;
}

// ---------- input handlers ----------
function onMarketClick(e) {
  const b = e.target.closest('button.slot');
  if (!b || ui.busy || ui.viewer === null || ui.viewer !== G.cur) return;
  if (b.classList.contains('off')) {
    if (b.dataset.f !== undefined && G.drawn === 1 && G.faceUp[+b.dataset.f] === E.LOCO) toast('A face-up locomotive can only be your first card');
    else if (b.dataset.d === 'tickets' && G.drawn === 1) toast('Take your second card first');
    sfx.error(); return;
  }
  ui.selected = null; ui.plan = null;
  const srcRect = b.getBoundingClientRect();
  if (b.dataset.f !== undefined) act(() => E.takeFaceUp(G, +b.dataset.f), srcRect);
  else if (b.dataset.d === 'deck') act(() => E.takeDeck(G), srcRect);
  else if (b.dataset.d === 'tickets') {
    const r = E.drawTickets(G);
    if (!r.ok) { toast(r.error); return; }
    save(); sfx.ticket(); renderAll(); openTicketChooser(false);
  }
}

function onStatusClick(e) {
  const t = e.target.closest('[data-s],[data-pay]');
  if (!t) return;
  if (t.dataset.s === 'close') { ui.selected = null; renderAll(); return; }
  if (t.dataset.s === 'clearplan') { ui.plan = null; renderAll(); return; }
  if (t.dataset.s === 'endturn') { act(() => E.forceEndTurn(G)); return; }
  if (t.dataset.s === 'results') { showGameOver(); return; }
  if (t.dataset.pay !== undefined && ui.selected !== null) {
    const rid = ui.selected;
    const opt = E.paymentOptions(G, ui.viewer, rid)[+t.dataset.pay];
    ui.selected = null; ui.plan = null;
    act(() => E.claimRoute(G, rid, opt));
  }
}

function act(fn, srcRect) {
  if (ui.busy) return;
  const res = fn();
  if (!res.ok) { toast(res.error); sfx.error(); return; }
  save();
  const ends = res.events.some(ev => ev.type === 'turnEnd' || ev.type === 'gameOver');
  if (ends) ui.busy = true;
  renderAll();
  let delay = 700;
  for (const ev of res.events) {
    if (ev.type === 'card') {
      ev.color === E.LOCO ? sfx.loco() : sfx.card();
      haptic(8);
      if (srcRect) flyCard(ev.color, srcRect);
    }
    if (ev.type === 'route') { animateClaim(ev); delay = 900 + E.ROUTES[ev.rid].len * 110; }
    if (ev.type === 'tickets') sfx.ticket();
    if (ev.type === 'finalRound') {
      setTimeout(() => { sfx.final(); bigToast('Final round!', `${G.players[ev.player].name} is almost out of trains. Everyone gets one last turn.`); }, 500);
      delay += 1800;
    }
  }
  if (res.events.some(ev => ev.type === 'gameOver')) {
    setTimeout(() => { ui.busy = false; ui.viewer = null; renderAll(); showGameOver(); }, delay + 300);
  } else if (ends) {
    setTimeout(() => {
      ui.busy = false;
      ui.viewer = settings.hideHand ? null : ui.viewer;
      renderAll();
      nextHandoff();
    }, delay);
  }
}

function flyCard(color, from) {
  const to = $('#hand').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = `card c-${color} flying`;
  el.innerHTML = `<span class="ci">${TRAIN_SVG}</span>`;
  el.style.left = from.left + from.width / 2 - 22 + 'px';
  el.style.top = from.top + from.height / 2 - 30 + 'px';
  document.body.appendChild(el);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  requestAnimationFrame(() => {
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(8deg) scale(.8)`;
    el.style.opacity = '0.2';
  });
  setTimeout(() => el.remove(), 520);
}

function animateClaim(ev) {
  const r = E.ROUTES[ev.rid];
  const el = svg.querySelector(`.route[data-id="${ev.rid}"]`);
  el.classList.remove('anim'); void el.getBBox(); el.classList.add('anim');
  setTimeout(() => el.classList.remove('anim'), 1500);
  sfx.claim(r.len); haptic(25);
  const g = geom[ev.rid];
  const fx = $('#fxLayer');
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', g.cx); t.setAttribute('y', g.cy - 8);
  t.setAttribute('class', 'pop');
  t.style.setProperty('--pc', PC[G.players[ev.player].color]);
  t.textContent = `+${ev.pts}`;
  fx.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

// ======================================================================
// Overlays
// ======================================================================
function openOverlay(html, { cls = '', onClick, dismiss = true } = {}) {
  overlayRoot.innerHTML = `<div class="overlay ${cls}"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const ov = overlayRoot.firstElementChild;
  ui.overlay = ov;
  requestAnimationFrame(() => ov.classList.add('show'));
  ov.onclick = e => {
    if (dismiss && e.target === ov) { closeOverlay(); return; }
    if (e.target.closest('[data-close]')) { sfx.tap(); closeOverlay(); return; }
    onClick?.(e);
  };
  return ov;
}

function closeOverlay() {
  const ov = ui.overlay;
  if (!ov) return;
  ui.overlay = null;
  ov.classList.remove('show');
  setTimeout(() => { if (ov.parentNode) ov.remove(); }, 220);
}

function showHandoff(pi, setup) {
  const p = G.players[pi];
  ui.viewer = null; ui.selected = null; ui.plan = null;
  renderAll();
  const recap = setup ? '' : recapHtml(pi);
  openOverlay(`
    <div class="handoff" style="--pc:${PC[p.color]}">
      <div class="avatar">${TRAIN_SVG}</div>
      <p class="kicker">${setup ? 'Starting tickets' : `Turn ${G.turn}`}</p>
      <h2>Pass to ${esc(p.name)}</h2>
      <p class="sub">${setup ? 'Pick at least 2 of your 3 destination tickets. Keep them secret!' : 'Your hand is hidden until you’re ready.'}</p>
      ${recap}
      <button class="btn primary big" data-a="reveal">I’m ${esc(p.name)} — show my hand</button>
    </div>`, {
    cls: 'handoff-ov', dismiss: false,
    onClick: e => {
      if (e.target.closest('[data-a="reveal"]')) {
        sfx.turn(); haptic(10);
        ui.viewer = pi;
        closeOverlay();
        renderAll();
        if (setup) setTimeout(() => openTicketChooser(true), 230);
        else if (G.phase === 'tickets') setTimeout(() => openTicketChooser(false), 230);
      }
    },
  });
}

function recapHtml(pi) {
  // Everything that happened since this player's previous turn
  let start = 0;
  for (let i = G.log.length - 1; i >= 0; i--) {
    if (G.log[i].p === pi && !G.log[i].sys) { start = i + 1; break; }
  }
  const entries = G.log.slice(start).filter(l => l.p !== pi || l.sys);
  if (!entries.length) return '';
  const byTurn = [];
  for (const l of entries) {
    const last = byTurn[byTurn.length - 1];
    if (last && last.turn === l.turn && last.p === l.p) last.items.push(l);
    else byTurn.push({ turn: l.turn, p: l.p, items: [l] });
  }
  const rows = byTurn.slice(-6).map(t => {
    const q = G.players[t.p];
    const text = t.items.map(l => l.kind === 'card' && l.color
      ? `took ${cardHtml(l.color, { cls: 'micro' })}` : esc(l.text)).join(', ');
    const plain = t.items[0].sys && !t.items[0].final;
    return `<li><span class="dot" style="background:${PC[q.color]}"></span><span>${plain ? '' : `<b>${esc(q.name)}</b> `}${text}</span></li>`;
  }).join('');
  return `<div class="recap"><h3>Since your last turn</h3><ul>${rows}</ul></div>`;
}

function miniMap(t, owner) {
  const A = E.CITY[t.a], B = E.CITY[t.b];
  const [, , W, H] = MAP.viewBox;
  return `<svg class="mini" viewBox="40 50 ${W - 60} ${H - 50}" aria-hidden="true">
    <path d="${MAP.outline}" class="land"/>
    ${MAP.cities.map(c => `<circle cx="${c.x}" cy="${c.y}" r="9" class="mdot"/>`).join('')}
    <line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="mline"/>
    <circle cx="${A.x}" cy="${A.y}" r="30" class="mend"/><circle cx="${B.x}" cy="${B.y}" r="30" class="mend"/>
  </svg>`;
}

function ticketHtml(tid, { sel = false, status = '', btn = true } = {}) {
  const t = E.TICKETS[tid];
  const tag = btn ? 'button' : 'div';
  return `<${tag} class="ticket ${sel ? 'sel' : ''} ${status}" data-t="${tid}">
    ${miniMap(t)}
    <div class="tinfo"><div class="tcities">${esc(cityName(t.a))}<span>→</span>${esc(cityName(t.b))}</div></div>
    <div class="tpts">${t.pts}</div>
    <div class="tcheck">✓</div>
  </${tag}>`;
}

function openTicketChooser(setup) {
  const pi = ui.viewer;
  const p = G.players[pi];
  const min = setup ? 2 : 1;
  const keep = new Set(p.pending);
  const render = () => {
    const sheet = ui.overlay?.querySelector('.sheet');
    const html = `
      <div class="chooser">
        <h2>${setup ? 'Your starting tickets' : 'New destination tickets'}</h2>
        <p class="sub">Connect both cities with your trains by the end of the game to score the points — unfinished tickets count against you. Keep at least ${min}.</p>
        <div class="tickets">${p.pending.map(tid => ticketHtml(tid, { sel: keep.has(tid) })).join('')}</div>
        ${!setup && p.tickets.length ? `<details class="have"><summary>Tickets you already have (${p.tickets.length})</summary>
          <div class="tickets small">${p.tickets.map(tid => ticketHtml(tid, { btn: false, status: E.ticketDone(G, pi, tid) ? 'done' : '' })).join('')}</div></details>` : ''}
        <button class="btn primary big" data-a="keep" ${keep.size < min ? 'disabled' : ''}>Keep ${keep.size} ticket${keep.size === 1 ? '' : 's'}</button>
      </div>`;
    if (sheet) sheet.innerHTML = html;
    return html;
  };
  openOverlay(render(), {
    cls: 'bottom', dismiss: false,
    onClick: e => {
      const t = e.target.closest('button.ticket');
      if (t) { const id = +t.dataset.t; keep.has(id) ? keep.delete(id) : keep.add(id); sfx.tap(); render(); return; }
      if (e.target.closest('[data-a="keep"]')) {
        if (keep.size < min) return;
        const ids = [...keep];
        closeOverlay();
        if (setup) {
          const r = E.keepSetupTickets(G, pi, ids);
          if (!r.ok) { toast(r.error); return; }
          save(); sfx.ticket();
          ui.viewer = settings.hideHand ? null : ui.viewer;
          renderAll();
          setTimeout(nextHandoff, 350);
        } else {
          act(() => E.keepTickets(G, ids));
        }
      }
    },
  });
}

function openTicketsView() {
  const pi = ui.viewer;
  const p = G.players[pi];
  const items = p.tickets.map(tid => {
    const done = E.ticketDone(G, pi, tid);
    const plan = done ? null : E.ticketPlan(G, pi, tid);
    const status = done ? 'done' : plan ? '' : 'blocked';
    const note = done ? 'Complete' : plan ? `${plan.cost} more train${plan.cost === 1 ? '' : 's'} needed` : 'Blocked — no open path';
    return `<div class="trow">${ticketHtml(tid, { status })}<div class="tnote ${status}">${note}${!done && plan && settings.hints ? ' · tap to show on map' : ''}</div></div>`;
  }).join('');
  const done = p.tickets.filter(t => E.ticketDone(G, pi, t)).length;
  const pts = p.tickets.reduce((a, t) => a + (E.ticketDone(G, pi, t) ? E.TICKETS[t].pts : -E.TICKETS[t].pts), 0);
  openOverlay(`
    <div class="chooser">
      <div class="sheet-head"><h2>Your tickets</h2><button class="icon-btn sm" data-close aria-label="Close">✕</button></div>
      <p class="sub">${done} of ${p.tickets.length} complete · if the game ended now: <b>${pts >= 0 ? '+' : ''}${pts}</b> pts · longest route ${E.longestPath(G, pi)} trains</p>
      <div class="tickets list">${items}</div>
    </div>`, {
    cls: 'bottom',
    onClick: e => {
      const t = e.target.closest('button.ticket');
      if (!t || !settings.hints) return;
      const tid = +t.dataset.t;
      const plan = E.ticketDone(G, pi, tid) ? null : E.ticketPlan(G, pi, tid);
      if (!plan) return;
      ui.plan = { tid, ...plan };
      ui.selected = null;
      closeOverlay();
      renderAll();
    },
  });
}

function openMenu() {
  const inGame = !!G && app.className === 'screen-game';
  openOverlay(`
    <div class="menu">
      <div class="sheet-head"><h2>Menu</h2><button class="icon-btn sm" data-close aria-label="Close">✕</button></div>
      <button class="btn" data-m="rules">How to play</button>
      <button class="btn" data-m="log">Game log</button>
      <button class="btn" data-m="settings">Settings</button>
      <button class="btn" data-m="history">Score history</button>
      ${inGame ? `<button class="btn" data-m="home">Save &amp; exit to menu</button>
      <button class="btn danger" data-m="abandon">Abandon game</button>` : ''}
    </div>`, {
    cls: 'bottom',
    onClick: e => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      sfx.tap();
      if (m === 'rules') openRules();
      if (m === 'log') openLog();
      if (m === 'settings') openSettings();
      if (m === 'history') { closeOverlay(); showHistory(true); }
      if (m === 'home') { save(); showHome(); }
      if (m === 'abandon') {
        const btn = e.target.closest('[data-m]');
        if (btn.dataset.confirm) { store.del(LS.game); G = null; showHome(); }
        else { btn.dataset.confirm = '1'; btn.textContent = 'Tap again to abandon (no score saved)'; }
      }
    },
  });
}

function openLog() {
  const rows = [...G.log].reverse().map(l => {
    const q = G.players[l.p];
    const text = l.kind === 'card' && l.color ? `took ${cardHtml(l.color, { cls: 'micro' })} from the display` : esc(l.text);
    return `<li class="${l.sys ? 'sys' : ''}"><span class="dot" style="background:${PC[q.color]}"></span><span>${l.sys && !l.final ? '' : `<b>${esc(q.name)}</b> `}${text}</span></li>`;
  }).join('');
  openOverlay(`
    <div class="chooser">
      <div class="sheet-head"><h2>Game log</h2><button class="icon-btn sm" data-close aria-label="Close">✕</button></div>
      <ul class="log">${rows || '<li>Nothing yet.</li>'}</ul>
    </div>`, { cls: 'bottom' });
}

function openSettings() {
  const row = (k, label, desc) => `
    <label class="toggle"><span><b>${label}</b><small>${desc}</small></span>
      <input type="checkbox" data-k="${k}" ${settings[k] ? 'checked' : ''}><i></i></label>`;
  const ov = openOverlay(`
    <div class="menu">
      <div class="sheet-head"><h2>Settings</h2><button class="icon-btn sm" data-close aria-label="Close">✕</button></div>
      ${row('sound', 'Sound effects', 'Card, train and fanfare sounds')}
      ${row('hints', 'Hints', 'Glow on routes you can claim, ticket cities ringed, best path to a ticket')}
      ${row('hideHand', 'Hide hand between turns', 'Shows a “pass the phone” screen so hands and tickets stay secret')}
      <p class="hint">Coast to Coast v${VERSION}</p>
    </div>`, { cls: 'bottom' });
  ov.onchange = e => {
    const k = e.target.dataset.k;
    if (!k) return;
    settings[k] = e.target.checked;
    store.set(LS.settings, settings);
    if (k === 'sound') { setSoundEnabled(settings.sound); sfx.tap(); }
    if (G && app.className === 'screen-game') renderAll();
  };
}

function openRules() {
  openOverlay(`
    <div class="rules">
      <div class="sheet-head"><h2>How to play</h2><button class="icon-btn sm" data-close aria-label="Close">✕</button></div>
      <p>Connect cities across America with your trains. Score points for every route you claim and for each destination ticket you complete.</p>
      <h3>Setup</h3>
      <p>Everyone starts with 45 trains, 4 train cards and 3 destination tickets, keeping at least 2 of them.</p>
      <h3>On your turn, do one thing</h3>
      <ol>
        <li><b>Draw 2 train cards</b> from the 5 face-up cards or the deck. A face-up locomotive counts as your whole draw and can’t be taken as your second card. If 3 locomotives are face up, the display is replaced.</li>
        <li><b>Claim a route</b>: tap it on the map and pay cards equal to its length. Coloured routes need that colour; gray routes take any one colour. Locomotives are wild.</li>
        <li><b>Draw 3 destination tickets</b> and keep at least 1.</li>
      </ol>
      <h3>Route points</h3>
      <div class="ptable">${Object.entries(E.ROUTE_POINTS).map(([l, p]) => `<span>${l} 🚃</span><b>${p}</b>`).join('')}</div>
      <h3>Double routes</h3>
      <p>One player can never claim both sides. With 2–3 players only one side can be used at all (you can change this when setting up).</p>
      <h3>End of game</h3>
      <p>When someone ends a turn with 2 or fewer trains, every player, including them, gets one final turn. Then completed tickets add their value and unfinished ones subtract it. The longest continuous route earns +10. Ties go to most completed tickets, then the longest route.</p>
    </div>`, { cls: 'bottom' });
}

// ---------- game over & history ----------
function showGameOver() {
  const res = E.finalScores(G);
  recordHistory(res);
  const winners = res.ranked.filter(r => r.rank === 1);
  const rows = res.ranked.map(r => `
    <div class="result ${r.rank === 1 ? 'win' : ''}" style="--pc:${PC[r.color]}">
      <div class="rhead"><span class="rank">${r.rank === 1 ? '🏆' : r.rank}</span><b>${esc(r.name)}</b><span class="total" data-total="${r.total}">0</span></div>
      <div class="rlines">
        <div><span>Routes</span><b>${r.routePts}</b></div>
        <div><span>Tickets completed (${r.done.length})</span><b class="plus">+${r.plus}</b></div>
        <div><span>Tickets missed (${r.failed.length})</span><b class="minus">−${r.minus}</b></div>
        <div><span>Longest route (${r.longest} trains)</span><b>${r.bonus ? '+' + r.bonus : '—'}</b></div>
      </div>
      <div class="rtickets">${r.done.map(t => tLine(t, true)).join('')}${r.failed.map(t => tLine(t, false)).join('')}</div>
    </div>`).join('');
  const ov = openOverlay(`
    <div class="gameover">
      <div class="confetti" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => `<i style="--i:${i};--c:${['#ff5a47', '#12a8a2', '#f2c230', '#5b4fd6', '#86c232'][i % 5]}"></i>`).join('')}</div>
      <p class="kicker">Final scores</p>
      <h2>${winners.map(w => esc(w.name)).join(' & ')} win${winners.length > 1 ? '' : 's'}!</h2>
      <div class="results">${rows}</div>
      <div class="row2">
        <button class="btn" data-g="board">View board</button>
        <button class="btn primary" data-g="rematch">Rematch</button>
      </div>
      <button class="btn ghost" data-g="home">Main menu</button>
    </div>`, {
    cls: 'center', dismiss: false,
    onClick: e => {
      const g = e.target.closest('[data-g]')?.dataset.g;
      if (!g) return;
      sfx.tap();
      if (g === 'board') { closeOverlay(); renderAll(); }
      if (g === 'home') { store.del(LS.game); showHome(); }
      if (g === 'rematch') {
        // previous second player starts the rematch
        const ps = G.players.map(p => ({ name: p.name, color: p.color }));
        const ordered = [...ps.slice(1), ps[0]];
        G = E.newGame(ordered, { doubleClosed: G.opts.doubleClosed });
        save();
        startGameScreen(false);
      }
    },
  });
  sfx.win();
  // count-up totals
  ov.querySelectorAll('.total').forEach(el => {
    const target = +el.dataset.total;
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 1200);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function tLine(tid, done) {
  const t = E.TICKETS[tid];
  return `<span class="tl ${done ? 'ok' : 'no'}">${done ? '✓' : '✗'} ${esc(cityName(t.a))} – ${esc(cityName(t.b))} <b>${done ? '+' : '−'}${t.pts}</b></span>`;
}

function recordHistory(res) {
  const h = store.get(LS.history, []);
  if (h.some(g => g.id === G.id)) return;
  h.unshift({
    id: G.id, date: Date.now(), turns: G.turn,
    players: res.ranked.map(r => ({ name: r.name, color: r.color, total: r.total, rank: r.rank, done: r.done.length, failed: r.failed.length, longest: r.longest })),
  });
  store.set(LS.history, h.slice(0, 200));
}

function showHistory(fromGame = false) {
  const h = store.get(LS.history, []);
  const wins = {}, played = {}, best = {};
  for (const g of h) for (const p of g.players) {
    played[p.name] = (played[p.name] || 0) + 1;
    if (p.rank === 1) wins[p.name] = (wins[p.name] || 0) + 1;
    best[p.name] = Math.max(best[p.name] ?? -Infinity, p.total);
  }
  const names = Object.keys(played).sort((a, b) => (wins[b] || 0) - (wins[a] || 0));
  app.className = 'screen-history';
  app.innerHTML = `
    <div class="history">
      <header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>Score history</h2></header>
      ${h.length ? `
      <section class="card-section tally">
        ${names.map(n => `<div class="trow2"><b>${esc(n)}</b><span>${wins[n] || 0} win${(wins[n] || 0) === 1 ? '' : 's'} / ${played[n]} played</span><span>best ${best[n]}</span></div>`).join('')}
      </section>
      <section class="games">
        ${h.map(g => `<div class="gamerow">
          <div class="gdate">${new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
          <div class="gplayers">${g.players.map(p => `<span class="gp ${p.rank === 1 ? 'win' : ''}" style="--pc:${PC[p.color] || '#888'}">${p.rank === 1 ? '🏆 ' : ''}${esc(p.name)} <b>${p.total}</b></span>`).join('')}</div>
        </div>`).join('')}
      </section>
      <button class="btn ghost" data-a="clear">Clear history</button>` : `<p class="empty">No finished games yet. Play one!</p>`}
    </div>`;
  app.onclick = e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    sfx.tap();
    if (a.dataset.a === 'back') { if (fromGame && G && !G.over) startGameScreen(true); else showHome(); }
    if (a.dataset.a === 'clear') {
      if (a.dataset.confirm) { store.del(LS.history); showHistory(fromGame); }
      else { a.dataset.confirm = '1'; a.textContent = 'Tap again to clear all history'; }
    }
  };
}

// ---------- toasts ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.className = 'show'; t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2200);
}

function bigToast(title, sub) {
  const t = $('#toast');
  t.className = 'show big';
  t.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3200);
}

// ======================================================================
// Boot
// ======================================================================
try {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* some hosts block service workers */ });
  }
} catch { /* sandboxed preview */ }
showHome();
