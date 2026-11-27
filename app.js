// Coast to Coast — UI layer
import * as E from './engine.js';
import * as Online from './online.js';
import { sfx, unlockAudio, setSoundEnabled, haptic } from './sound.js';

const VERSION = '1.1.3';
// Player colours, picked to stay distinct from the eight route colours
const PLAYER_COLORS = [
  { id: 'coral', hex: '#ff5a47', name: 'Coral' },
  { id: 'teal', hex: '#12a8a2', name: 'Teal' },
  { id: 'indigo', hex: '#5b4fd6', name: 'Indigo' },
  { id: 'lime', hex: '#86c232', name: 'Lime' },
  { id: 'bronze', hex: '#a2662f', name: 'Bronze' },
  { id: 'pink', hex: '#ef5fa7', name: 'Pink' },
  { id: 'sky', hex: '#3cb4e5', name: 'Sky' },
  { id: 'slate', hex: '#60748a', name: 'Slate' },
];
const PC = Object.fromEntries(PLAYER_COLORS.map(c => [c.id, c.hex]));
const HAND_ORDER = [...E.COLORS, E.LOCO];
const LS = {
  game: 'c2c.game', settings: 'c2c.settings', history: 'c2c.history', names: 'c2c.names',
  me: 'c2c.me', setup: 'c2c.setup', hidden: 'c2c.hiddenGames',
};

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let settings = { sound: true, hints: true, hideHand: true, ...store.get(LS.settings, {}) };
setSoundEnabled(settings.sound);

let G = null;
// Session: local pass-and-play, or an online game
let S = { mode: 'local' };
const ui = { selected: null, selCity: null, viewer: null, busy: false, plan: null, overlay: null, overlayKind: null };

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const overlayRoot = $('#overlay-root');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MD = () => E.M(G);
const cityName = id => MD().CITY[id].name;
const online = () => S.mode === 'online';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const TRAIN_SVG = '<svg viewBox="0 0 34 22" aria-hidden="true"><path d="M7 4h4v4h9V3h-2V1h12v2h-2v13H4.5L1 19.5V14l3-1.5V9.5L7 8z"/><rect x="21.5" y="4.5" width="5" height="4" rx=".6" fill="rgba(255,255,255,.6)"/><circle cx="9" cy="18" r="3"/><circle cx="16" cy="18" r="3"/><circle cx="25" cy="17.5" r="3.6"/></svg>';
const STATION_PATH = 'M-6 4 V-2 L0 -7.5 L6 -2 V4 Z';

document.addEventListener('pointerdown', unlockAudio, { passive: true });

function stopWatch() {
  S.unsub?.(); S.unsub = null;
  if (S.presenceTimer) {
    clearInterval(S.presenceTimer); S.presenceTimer = null;
    document.removeEventListener('visibilitychange', S.onVis);
    Online.setPresence(S.code, false);
  }
}

const AWAY_MS = 150000;
const isHere = (d, uid) => !!(d?.presence?.[uid] && Date.now() - d.presence[uid] < AWAY_MS);

// ======================================================================
// Home
// ======================================================================
function showHome() {
  stopWatch();
  S = { mode: 'local' };
  closeOverlayNow();
  const saved = store.get(LS.game, null);
  const canContinue = saved && !saved.over;
  app.className = 'screen-home';
  app.innerHTML = `
    <div class="home">
      <button class="icon-btn help-corner" data-a="help" aria-label="Help">?</button>
      <div class="brand">
        ${logoSvg()}
        <h1>Coast&nbsp;to&nbsp;Coast</h1>
        <p class="tag">Railways across America &amp; Europe</p>
      </div>
      <div class="home-actions">
        ${canContinue ? `<button class="btn primary big" data-a="continue">
            Continue game<small>${E.MAPS[saved.map || 'usa'].name} · ${saved.players.map(p => esc(p.name)).join(' vs ')} · turn ${saved.turn}</small></button>` : ''}
        <button class="btn ${canContinue ? '' : 'primary'} big" data-a="new">New game</button>
        <div class="row2">
          <button class="btn" data-a="join">Join online game</button>
          <button class="btn" data-a="mygames">My online games<small id="turnBadge"></small></button>
        </div>
        <div class="row2">
          <button class="btn" data-a="history">Score history</button>
          <button class="btn" data-a="help">Help</button>
        </div>
        <div class="row2 ghosts">
          <button class="btn ghost" data-a="online">Online setup</button>
          <button class="btn ghost" data-a="settings">Settings</button>
        </div>
      </div>
      <footer>v${VERSION}</footer>
    </div>`;
  app.oninput = null;
  app.onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    sfx.tap();
    if (a === 'continue') { G = E.migrate(saved); S = { mode: 'local' }; startGameScreen(); }
    if (a === 'new') showSetup();
    if (a === 'join') needOnline(() => showJoin());
    if (a === 'mygames') needOnline(() => showMyGames());
    if (a === 'history') showHistory();
    if (a === 'help') openHelp(null);
    if (a === 'online') showOnlineSetup();
    if (a === 'settings') openSettings();
  };
  // "your turn" badge for online games
  if (Online.hasConfig()) {
    Online.myGames().then(list => {
      const uid = Online.myUid();
      const hidden = store.get(LS.hidden, []);
      const n = list.filter(g => g.status === 'playing' && g.curUid === uid && !hidden.includes(g.code)).length;
      const el = $('#turnBadge');
      if (el && n) el.textContent = `${n} waiting for you`;
    }).catch(() => {});
  }
}

function needOnline(then) {
  if (Online.hasConfig()) then();
  else { toast('Set up online play first'); showOnlineSetup(); }
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

// ======================================================================
// Setup (local or online host). `pre` pre-fills everything (rematch).
// ======================================================================
const OPT_INFO = {
  tunnels: ['Tunnels', 'Reveal 3 cards when claiming; matches cost extra'],
  ferries: ['Ferries', 'Sea routes need locomotives'],
  stations: ['Train stations', '3 each; borrow a rival route for tickets'],
  longTickets: ['Long-route tickets', 'One big ticket dealt at the start'],
};

function colorPicker(sel, taken, attr) {
  return `<div class="swatches">${PLAYER_COLORS.map(c => {
    const off = taken.includes(c.id) && c.id !== sel;
    return `<button class="sw ${c.id === sel ? 'on' : ''}" ${off ? 'disabled' : ''} ${attr}="${c.id}" style="--pc:${c.hex}" aria-label="${c.name}${off ? ' (taken)' : ''}"></button>`;
  }).join('')}</div>`;
}

function showSetup(pre = null) {
  stopWatch();
  closeOverlayNow();
  const last = store.get(LS.setup, null);
  const me = store.get(LS.me, { name: '', color: 'coral' });
  const lastNames = store.get(LS.names, ['Player 1', 'Player 2']);
  const st = {
    mode: pre?.mode || (Online.hasConfig() && last?.mode === 'online' ? 'online' : 'local'),
    map: pre?.map || last?.map || 'usa',
    opts: pre?.opts ? { ...pre.opts } : (last?.opts ? { ...last.opts } : {}),
    doubleClosed: pre?.opts?.doubleClosed ?? null,
    players: pre?.players || last?.players || lastNames.map((n, i) => ({ name: n, color: PLAYER_COLORS[i % 8].id })),
    me: pre?.me || me,
    open: -1,
    rematchOf: pre?.rematchOf || null,
  };
  // Europe options: keep them only if they came from a Europe game, else last choice / on
  for (const k of Object.keys(OPT_INFO)) {
    if (pre?.opts && pre.map !== 'europe') st.opts[k] = last?.opts?.[k];
    if (st.opts[k] === undefined) st.opts[k] = true;
  }
  if (st.players.length < 2) st.players.push({ name: 'Player 2', color: 'teal' });
  fixColors(st.players);

  app.className = 'screen-setup';
  const render = () => {
    const n = st.mode === 'local' ? st.players.length : 2;
    const closed = st.doubleClosed ?? n <= 3;
    const eu = st.map === 'europe';
    app.innerHTML = `
      <div class="setup">
        <header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>${pre?.rematch ? 'Rematch' : 'New game'}</h2>
          <button class="icon-btn" data-a="help" aria-label="Help">?</button></header>
        <section class="card-section">
          <label class="lbl">Play</label>
          <div class="seg">
            <button class="${st.mode === 'local' ? 'on' : ''}" data-mode="local">On this phone</button>
            <button class="${st.mode === 'online' ? 'on' : ''}" data-mode="online">Online</button>
          </div>
          ${st.mode === 'online' && !Online.hasConfig() ? `<p class="hint warn">Online isn’t set up on this phone. <button class="link" data-a="online">Set it up</button></p>` : ''}
          ${st.mode === 'online' ? `<p class="hint">You’ll get a 4-letter code; the others join with it on their phones. Turns can be spread over days.</p>` : ''}
        </section>
        <section class="card-section">
          <label class="lbl">Map</label>
          <div class="maps">
            ${Object.values(E.MAPS).map(m => `
              <button class="mapcard ${st.map === m.id ? 'on' : ''}" data-map="${m.id}">
                <svg viewBox="${m.viewBox.join(' ')}" aria-hidden="true"><path d="${m.outline}"/>${m.lakes.map(d => `<path d="${d}" class="w"/>`).join('')}
                  ${m.cities.map(c => `<circle cx="${c.x}" cy="${c.y}" r="9"/>`).join('')}</svg>
                <b>${m.name}</b><small>${m.cities.length} cities</small>
              </button>`).join('')}
          </div>
          ${eu ? `<div class="opts">${Object.entries(OPT_INFO).map(([k, [label, desc]]) => `
            <label class="toggle"><span><b>${label}</b><small>${desc}</small></span>
              <input type="checkbox" data-opt="${k}" ${st.opts[k] ? 'checked' : ''}><i></i></label>`).join('')}</div>` : ''}
        </section>
        <section class="card-section">
          ${st.mode === 'local' ? `
            <label class="lbl">Players</label>
            <div class="seg">${[2, 3, 4, 5].map(k => `<button class="${k === st.players.length ? 'on' : ''}" data-n="${k}">${k}</button>`).join('')}</div>
            <div class="names">
              ${st.players.map((p, i) => `
                <div class="name-row">
                  <button class="dotbtn" data-pick="${i}" style="--pc:${PC[p.color]}" aria-label="Choose colour"></button>
                  <input type="text" maxlength="14" data-i="${i}" value="${esc(p.name)}" aria-label="Player ${i + 1} name">
                </div>
                ${st.open === i ? colorPicker(p.color, st.players.map(q => q.color), 'data-col') : ''}`).join('')}
            </div>
            <p class="hint">Tap a colour dot to change it. Who goes first is random.</p>` : `
            <label class="lbl">You</label>
            <div class="names"><div class="name-row">
              <span class="dot big" style="--pc:${PC[st.me.color]}"></span>
              <input type="text" maxlength="14" data-me value="${esc(st.me.name)}" placeholder="Your name" aria-label="Your name">
            </div>${colorPicker(st.me.color, [], 'data-mecol')}</div>`}
        </section>
        <section class="card-section">
          <label class="lbl">Double routes</label>
          <div class="seg">
            <button class="${closed ? 'on' : ''}" data-dc="1">One side only</button>
            <button class="${!closed ? 'on' : ''}" data-dc="0">Both sides open</button>
          </div>
          <p class="hint">Official rule: with 2–3 players only one side of a double route can be used. Nobody can take both sides.</p>
        </section>
        <button class="btn primary big" data-a="start">${st.mode === 'online' ? 'Create online game' : 'Start game'}</button>
      </div>`;
  };
  render();
  app.oninput = e => {
    if (e.target.dataset.i !== undefined) st.players[+e.target.dataset.i].name = e.target.value;
    if (e.target.dataset.me !== undefined) st.me.name = e.target.value;
  };
  app.onchange = e => { if (e.target.dataset.opt) st.opts[e.target.dataset.opt] = e.target.checked; };
  app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    sfx.tap();
    const d = t.dataset;
    if (d.mode) { st.mode = d.mode; render(); }
    if (d.map) { st.map = d.map; render(); }
    if (d.n) {
      const k = +d.n;
      while (st.players.length < k) st.players.push({ name: `Player ${st.players.length + 1}`, color: null });
      st.players.length = k; fixColors(st.players); st.open = -1; render();
    }
    if (d.pick !== undefined) { st.open = st.open === +d.pick ? -1 : +d.pick; render(); }
    if (d.col) { st.players[st.open].color = d.col; st.open = -1; render(); }
    if (d.mecol) { st.me.color = d.mecol; render(); }
    if (d.dc) { st.doubleClosed = d.dc === '1'; render(); }
    if (d.a === 'back') showHome();
    if (d.a === 'help') openHelp({ map: st.map, opts: { ...E.normOpts(st.map, st.players.length, st.opts), doubleClosed: st.doubleClosed ?? st.players.length <= 3 } });
    if (d.a === 'online') showOnlineSetup();
    if (d.a === 'start') {
      const opts = { ...E.normOpts(st.map, st.mode === 'local' ? st.players.length : 2, st.opts) };
      if (st.doubleClosed !== null) opts.doubleClosed = st.doubleClosed; else delete opts.doubleClosed;
      store.set(LS.setup, { mode: st.mode, map: st.map, opts: st.opts, players: st.players });
      if (st.mode === 'local') {
        const ps = st.players.map((p, i) => ({ name: (p.name || '').trim() || `Player ${i + 1}`, color: p.color }));
        store.set(LS.names, ps.map(p => p.name));
        const first = Math.floor(Math.random() * ps.length);
        const ordered = [...ps.slice(first), ...ps.slice(0, first)];
        G = E.newGame(ordered, { ...opts, map: st.map });
        S = { mode: 'local' };
        save();
        startGameScreen();
      } else {
        if (!Online.hasConfig()) { showOnlineSetup(); return; }
        const meName = (st.me.name || '').trim();
        if (!meName) { toast('Enter your name'); return; }
        st.me.name = meName;
        store.set(LS.me, st.me);
        t.disabled = true; t.textContent = 'Creating…';
        try {
          const code = await Online.createGame({ map: st.map, opts: { ...opts, doubleClosed: st.doubleClosed }, me: st.me });
          if (st.rematchOf) Online.setRematch(st.rematchOf, code);
          showLobby(code);
        } catch (err) { toast(Online.explain(err)); render(); }
      }
    }
  };
}

function fixColors(players) {
  const used = new Set();
  for (const p of players) {
    if (!p.color || used.has(p.color) || !PC[p.color]) p.color = PLAYER_COLORS.find(c => !used.has(c.id)).id;
    used.add(p.color);
  }
}

// ======================================================================
// Online: setup, join, lobby, my games
// ======================================================================
function showOnlineSetup() {
  stopWatch();
  closeOverlayNow();
  const cfg = Online.getConfig();
  app.className = 'screen-setup';
  app.innerHTML = `
    <div class="setup">
      <header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>Online setup</h2></header>
      <section class="card-section">
        <label class="lbl">Connection</label>
        ${cfg ? `<p class="okline">✓ Connected to Firebase project <b>${esc(cfg.projectId)}</b></p>
          <div class="row2"><button class="btn" data-a="test">Test connection</button><button class="btn" data-a="copy">Copy invite</button></div>
          <p class="hint">“Copy invite” copies a message with this connection. Send it over iMessage or AirDrop; on the other phone use <b>Paste invite</b> below.</p>`
          : `<p class="hint">Not set up yet. On your phone, paste your Firebase config. On your partner’s phone, paste the invite you send them.</p>`}
        <div id="testOut" class="hint"></div>
      </section>
      <section class="card-section">
        <label class="lbl">${cfg ? 'Replace connection' : 'Paste config or invite'}</label>
        <textarea id="cfgText" rows="6" placeholder="Paste the firebaseConfig block from the Firebase console, or an invite text (C2C1:…)" spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>
        <div class="row2">
          <button class="btn" data-a="paste">Paste invite</button>
          <button class="btn primary" data-a="save">Save</button>
        </div>
        <p class="hint">The config is stored only on this phone. It never goes into the app’s code or GitHub.</p>
      </section>
      <details class="card-section howto">
        <summary><b>How to set up Firebase (once, ~5 min)</b></summary>
        <ol>
          <li>Open <b>console.firebase.google.com</b> and create a project (or open yours).</li>
          <li>Left menu <b>Security → Authentication</b> → <b>Sign-in method</b> tab → enable <b>Anonymous</b>.</li>
          <li>Left menu <b>Databases &amp; Storage → Firestore</b> → <b>Create database</b> → pick a location → <b>Production mode</b> → <b>Create</b>.</li>
          <li>Still in Firestore, open the <b>Rules</b> tab, replace everything with the rules below and click <b>Publish</b>.</li>
          <li>Get the config: on the project overview page click the <b>Web</b> icon (or <b>Add app</b> → Web), enter a nickname, <b>Register app</b>, copy the <code>firebaseConfig</code> block. Already registered? <b>Project settings → Your apps</b> → your web app → <b>Firebase SDK snippet → Config</b>.</li>
          <li>Paste it above and tap <b>Save</b>, then <b>Copy invite</b> and send it to your partner.</li>
        </ol>
        <p class="hint">Database not called “(default)”? Add a line <code>databaseId: "your-id"</code> to the pasted config.</p>
        <pre class="rules-code" id="rulesCode">${esc(Online.RULES)}</pre>
        <button class="btn" data-a="copyrules">Copy rules</button>
      </details>
      ${cfg ? `<button class="btn ghost danger" data-a="remove">Remove connection from this phone</button>` : ''}
    </div>`;
  app.oninput = null; app.onchange = null;
  const out = $('#testOut');
  const saveText = async (text) => {
    try {
      const { config, code } = Online.parseConfigText(text);
      Online.setConfig(config);
      out.textContent = 'Checking…';
      try {
        await Online.test();
        toast('Connected ✓');
        if (code) { showJoin(code); return; }
        showOnlineSetup();
      } catch (err) {
        showOnlineSetup();
        $('#testOut').textContent = '⚠︎ Saved, but: ' + Online.explain(err);
      }
    } catch (err) { out.textContent = '⚠︎ ' + err.message; sfx.error(); }
  };
  app.onclick = async e => {
    const t = e.target.closest('[data-a]');
    if (!t) return;
    sfx.tap();
    const a = t.dataset.a;
    if (a === 'back') showHome();
    if (a === 'save') saveText($('#cfgText').value);
    if (a === 'paste') {
      try {
        const text = await navigator.clipboard.readText();
        if (text) { $('#cfgText').value = text; saveText(text); }
      } catch { out.textContent = 'Couldn’t read the clipboard — long-press the box above and choose Paste, then Save.'; $('#cfgText').focus(); }
    }
    if (a === 'test') {
      out.textContent = 'Testing…';
      try { await Online.test(); out.textContent = '✓ All good — signed in and Firestore is reachable.'; }
      catch (err) { out.textContent = '⚠︎ ' + Online.explain(err); }
    }
    if (a === 'copy') copyText(Online.makeInvite(), 'Invite copied — send it to your partner');
    if (a === 'copyrules') copyText(Online.RULES, 'Rules copied');
    if (a === 'remove') {
      if (t.dataset.confirm) { Online.clearConfig(); showOnlineSetup(); }
      else { t.dataset.confirm = '1'; t.textContent = 'Tap again to remove'; }
    }
  };
}

async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch {
    openOverlay(`<div class="menu"><div class="sheet-head"><h2>Copy this</h2><button class="icon-btn sm" data-close aria-label="Close">✕</button></div>
      <textarea class="copybox" rows="8" readonly>${esc(text)}</textarea><p class="hint">Long-press the text, Select All, Copy.</p></div>`, { cls: 'bottom' });
  }
}

function showJoin(prefill = '') {
  stopWatch();
  closeOverlayNow();
  const me = store.get(LS.me, { name: '', color: 'teal' });
  let game = null, code = prefill;
  app.className = 'screen-setup';
  const render = (msg = '') => {
    const taken = game ? game.players.filter(p => p.uid !== Online.myUid()).map(p => p.color) : [];
    if (taken.includes(me.color)) me.color = PLAYER_COLORS.find(c => !taken.includes(c.id))?.id || me.color;
    app.innerHTML = `
      <div class="setup">
        <header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>Join online game</h2></header>
        <section class="card-section">
          <label class="lbl">Game code</label>
          <div class="coderow">
            <input type="text" id="codeIn" maxlength="4" value="${esc(code)}" placeholder="ABCD" autocapitalize="characters" autocomplete="off" aria-label="Game code">
            <button class="btn" data-a="find">Find</button>
          </div>
          ${game ? `<p class="okline">${E.MAPS[game.map].name} · host ${esc(game.players[0]?.name)} · ${plural(game.players.length, 'player')}</p>` : ''}
          ${msg ? `<p class="hint warn">${esc(msg)}</p>` : ''}
        </section>
        ${game ? `<section class="card-section">
          <label class="lbl">You</label>
          <div class="names"><div class="name-row">
            <span class="dot big" style="--pc:${PC[me.color]}"></span>
            <input type="text" maxlength="14" data-me value="${esc(me.name)}" placeholder="Your name" aria-label="Your name">
          </div>${colorPicker(me.color, taken, 'data-mecol')}</div>
        </section>
        <button class="btn primary big" data-a="join">Join game</button>` : ''}
      </div>`;
  };
  const find = async () => {
    code = ($('#codeIn')?.value || code).trim().toUpperCase();
    if (code.length !== 4) { render('Codes have 4 letters'); return; }
    try {
      game = await Online.getGame(code);
      if (!game) { render('No game with that code'); return; }
      if (game.uids.includes(Online.myUid())) { openOnline(code); return; }
      if (game.status !== 'lobby') { game = null; render('That game has already started'); return; }
      render();
    } catch (err) { game = null; render(Online.explain(err)); }
  };
  render();
  if (prefill) find();
  app.oninput = e => {
    if (e.target.dataset.me !== undefined) me.name = e.target.value;
    if (e.target.id === 'codeIn') code = e.target.value.toUpperCase();
  };
  app.onchange = null;
  app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    sfx.tap();
    if (t.dataset.a === 'back') showHome();
    if (t.dataset.a === 'find') find();
    if (t.dataset.mecol) { me.color = t.dataset.mecol; render(); }
    if (t.dataset.a === 'join') {
      me.name = (me.name || '').trim();
      if (!me.name) { toast('Enter your name'); return; }
      store.set(LS.me, me);
      t.disabled = true;
      try { await Online.joinGame(code, me); showLobby(code); }
      catch (err) {
        if (err.message === 'colortaken') { toast('That colour was just taken'); find(); }
        else render(err.message.startsWith('This game') ? err.message : Online.explain(err));
      }
    }
  };
}

function showLobby(code) {
  stopWatch();
  closeOverlayNow();
  app.className = 'screen-setup';
  app.oninput = null; app.onchange = null;
  let data = null;
  const render = () => {
    if (!data) { app.innerHTML = `<div class="setup"><p class="empty">Loading…</p></div>`; return; }
    const uid = Online.myUid();
    const host = data.hostUid === uid;
    const mine = data.players.find(p => p.uid === uid);
    const taken = data.players.filter(p => p.uid !== uid).map(p => p.color);
    app.innerHTML = `
      <div class="setup">
        <header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>Waiting room</h2>
          <button class="icon-btn" data-a="help" aria-label="Help">?</button></header>
        <section class="card-section center">
          <label class="lbl">Game code</label>
          <div class="bigcode">${esc(code)}</div>
          <p class="hint">${E.MAPS[data.map].name}${data.map === 'europe' ? ' · ' + (Object.keys(OPT_INFO).filter(k => data.opts?.[k]).map(k => OPT_INFO[k][0].toLowerCase()).join(', ') || 'no extra rules') : ''}</p>
          <div class="row2"><button class="btn" data-a="copycode">Copy code</button><button class="btn" data-a="invite">Copy invite + code</button></div>
        </section>
        <section class="card-section">
          <label class="lbl">Players (${data.players.length}/5)</label>
          <ul class="lobby-list">${data.players.map(p => `<li><span class="dot" style="--pc:${PC[p.color]}"></span><b>${esc(p.name)}</b>${p.uid === data.hostUid ? '<small>host</small>' : ''}${p.uid === uid ? '<small>you</small>' : ''}</li>`).join('')}</ul>
          ${mine ? `<label class="lbl" style="margin-top:12px">Your colour</label>${colorPicker(mine.color, taken, 'data-mecol')}` : ''}
        </section>
        ${host ? `<button class="btn primary big" data-a="start" ${data.players.length < 2 ? 'disabled' : ''}>${data.players.length < 2 ? 'Waiting for players…' : 'Start game'}</button>`
          : `<p class="empty">Waiting for ${esc(data.players[0]?.name || 'the host')} to start…</p>`}
        <button class="btn ghost danger" data-a="leave">${host ? 'Cancel game' : 'Leave game'}</button>
      </div>`;
  };
  render();
  S = { mode: 'lobby', code };
  S.unsub = Online.watch(code, (d, err) => {
    if (err) { toast(Online.explain(err)); return; }
    if (!d) { toast('The game was cancelled'); showHome(); return; }
    data = d;
    if (d.status !== 'lobby') { openOnline(code, d); return; }
    render();
  });
  app.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    sfx.tap();
    const a = t.dataset.a;
    if (a === 'back') showHome();
    if (a === 'help' && data) openHelp({ map: data.map, opts: E.normOpts(data.map, data.players.length, data.opts) });
    if (a === 'copycode') copyText(code, 'Code copied');
    if (a === 'invite') copyText(Online.makeInvite(code), 'Invite copied');
    if (t.dataset.mecol) {
      const me = { ...store.get(LS.me, {}), name: data.players.find(p => p.uid === Online.myUid())?.name, color: t.dataset.mecol };
      store.set(LS.me, me);
      try { await Online.updateMe(code, me); } catch (err) { toast(err.message === 'colortaken' ? 'That colour is taken' : Online.explain(err)); }
    }
    if (a === 'start') {
      t.disabled = true;
      try { await Online.startGame(code); } catch (err) { toast(err.message.startsWith('Waiting') || err.message.startsWith('Only') ? err.message : Online.explain(err)); render(); }
    }
    if (a === 'leave') {
      if (!t.dataset.confirm) { t.dataset.confirm = '1'; t.textContent = 'Tap again to confirm'; return; }
      stopWatch();
      try { await Online.leaveGame(code); } catch { /* ignore */ }
      showHome();
    }
  };
}

async function showMyGames() {
  stopWatch();
  closeOverlayNow();
  app.className = 'screen-history';
  app.oninput = null; app.onchange = null;
  app.innerHTML = `<div class="history"><header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>My online games</h2></header><p class="empty">Loading…</p></div>`;
  app.onclick = e => { if (e.target.closest('[data-a="back"]')) showHome(); };
  let list;
  try { list = await Online.myGames(); }
  catch (err) { app.querySelector('.empty').textContent = Online.explain(err); return; }
  const uid = Online.myUid();
  const hidden = store.get(LS.hidden, []);
  list = list.filter(g => !hidden.includes(g.code));
  const label = g => g.status === 'lobby' ? 'In waiting room' : g.status === 'over' ? 'Finished' : g.status === 'ended' ? 'Ended'
    : g.curUid === uid ? 'Your turn' : `${esc(g.players.find(p => p.uid === g.curUid)?.name || '…')}’s turn`;
  app.innerHTML = `
    <div class="history">
      <header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>My online games</h2></header>
      <div class="row2"><button class="btn" data-a="new">New online game</button><button class="btn" data-a="join">Join with code</button></div>
      ${list.length ? `<section class="games">${list.map(g => `
        <div class="gamerow ${g.curUid === uid && g.status === 'playing' ? 'myturn' : ''}">
          <button class="gopen" data-open="${g.code}">
            <div class="gdate">${esc(g.code)} · ${E.MAPS[g.map]?.name || ''} · ${timeAgo(g.updatedAt)}</div>
            <div class="gplayers">${g.players.map(p => `<span class="gp" style="--pc:${PC[p.color] || '#888'}">${esc(p.name)}</span>`).join('')}</div>
            <div class="gstatus">${label(g)}</div>
          </button>
          <button class="icon-btn sm gdel" data-hide="${g.code}" aria-label="Remove from list">✕</button>
        </div>`).join('')}</section>` : `<p class="empty">No online games yet.</p>`}
    </div>`;
  app.onclick = e => {
    const t = e.target.closest('button');
    if (!t) return;
    sfx.tap();
    if (t.dataset.a === 'back') showHome();
    if (t.dataset.a === 'new') showSetup({ mode: 'online' });
    if (t.dataset.a === 'join') showJoin();
    if (t.dataset.open) openOnline(t.dataset.open);
    if (t.dataset.hide) {
      if (!t.dataset.confirm) { t.dataset.confirm = '1'; t.textContent = '?'; toast('Tap again to remove it from your list'); return; }
      const g = list.find(x => x.code === t.dataset.hide);
      if (g && g.hostUid === uid) Online.deleteGame(g.code).catch(() => {});
      store.set(LS.hidden, [...hidden, t.dataset.hide]);
      showMyGames();
    }
  };
}

function timeAgo(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// Open an online game (lobby or in progress) and keep it in sync
function openOnline(code, first = null) {
  stopWatch();
  closeOverlayNow();
  S = { mode: 'online', code, version: -1, mySeat: null, doc: null, started: false };
  const onDoc = (d, err) => {
    if (err) { toast(Online.explain(err)); return; }
    if (!d) { toast('This game no longer exists'); showHome(); return; }
    if (d.status === 'lobby') { showLobby(code); return; }
    const prevDoc = S.doc;
    S.doc = d;
    if (d.status === 'ended') { showEnded(d); return; }
    // Tell me when someone leaves or comes back
    if (prevDoc && G && S.started) {
      for (const p of G.players) {
        if (p.uid === Online.myUid()) continue;
        const was = isHere(prevDoc, p.uid), now = isHere(d, p.uid);
        if (was && !now) toast(`${p.name} left the game — they can continue later`);
        if (!was && now) toast(`${p.name} is back`);
      }
    }
    if (d.version <= S.version) { maybeRematchButton(); if (S.started) { renderPlayers(); renderStatus(); } return; }
    const prev = G;
    G = E.migrate(JSON.parse(d.state));
    const firstLoad = S.version < 0;
    S.version = d.version;
    S.mySeat = G.players.findIndex(p => p.uid === Online.myUid());
    if (S.mySeat < 0) S.mySeat = null;
    if (!S.started) { S.started = true; startGameScreen(); return; }
    // Remote move: play its effects
    if (d.lastEvents && !firstLoad) {
      const le = JSON.parse(d.lastEvents);
      if (le.by !== S.mySeat) playRemote(le.events, prev);
    }
    ui.viewer = S.mySeat;
    renderAll();
    if (G.over) { if (!ui.overlay || ui.overlayKind !== 'gameover') setTimeout(showGameOver, 600); }
    else checkPrompts();
  };
  if (first) onDoc(first);
  if (S.mode !== 'online' || S.code !== code) return; // moved on (e.g. to the lobby)
  const mySession = S;
  S.resync = async () => { try { const d = await Online.getGame(code); if (S === mySession) onDoc(d); } catch { /* offline */ } };
  const unsub = Online.watch(code, (d, err) => { if (S === mySession) onDoc(d, err); });
  S.unsub = unsub;
  // presence: say I'm here, refresh every minute, and say I left when the app is hidden
  Online.setPresence(code, true);
  S.presenceTimer = setInterval(() => { if (!document.hidden) Online.setPresence(code, true); if (app.className === 'screen-game' && G) renderPlayers(); }, 60000);
  S.onVis = () => Online.setPresence(code, !document.hidden);
  document.addEventListener('visibilitychange', S.onVis);
}

function showEnded(d) {
  const who = d.players.find(p => p.uid === d.endedBy);
  const me = d.endedBy === Online.myUid();
  openOverlay(`
    <div class="handoff">
      <p class="kicker">Game ended</p>
      <h2>${me ? 'You ended the game' : `${esc(who?.name || 'A player')} ended the game`}</h2>
      <p class="sub">No scores were recorded.</p>
      <button class="btn primary big" data-a="home">Main menu</button>
    </div>`, {
    cls: 'center', dismiss: false, kind: 'ended',
    onClick: e => { if (e.target.closest('[data-a="home"]')) showHome(); },
  });
}

function playRemote(events, prev) {
  for (const ev of events) {
    const who = G.players[ev.player ?? prev?.cur ?? 0];
    if (ev.type === 'card') { ev.color === E.LOCO ? sfx.loco() : sfx.card(); flashSlot(ev); }
    if (ev.type === 'route') animateClaim(ev);
    if (ev.type === 'station') { sfx.ticket(); toast(`${who?.name} built a station in ${cityName(ev.city)}`); }
    if (ev.type === 'tunnelReveal') toast(`${who?.name} is digging a tunnel: ${ev.extra ? `${plural(ev.extra, 'extra card')} needed` : 'clear!'}`);
    if (ev.type === 'tunnelFail') toast(`${who?.name} gave up on a tunnel`);
    if (ev.type === 'tickets') sfx.ticket();
    if (ev.type === 'finalRound') { sfx.final(); bigToast('Final round!', `${G.players[ev.player].name} is almost out of trains. Everyone gets one last turn.`); }
    if (ev.type === 'turnEnd' && G.cur === S.mySeat && !G.over) setTimeout(() => { sfx.turn(); haptic(15); toast('Your turn!'); }, 700);
  }
}

function flashSlot(ev) {
  if (ev.from !== 'face') return;
  const el = document.querySelector(`.slot[data-f="${ev.index}"]`);
  if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}

// ======================================================================
// Game screen
// ======================================================================
let svg, vb, FULL, geom;

function startGameScreen() {
  ui.selected = null; ui.selCity = null; ui.plan = null; ui.busy = false;
  ui.viewer = online() ? S.mySeat : null;
  app.className = 'screen-game';
  app.oninput = null; app.onchange = null;
  app.innerHTML = `
    <div class="game">
      <header class="topbar">
        <button class="icon-btn" id="menuBtn" aria-label="Menu">☰</button>
        <div class="players" id="players"></div>
        <button class="icon-btn" id="helpBtn" aria-label="Help">?</button>
      </header>
      <div class="mapwrap" id="mapwrap">
        <svg id="map" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"></svg>
        <div class="zoom">
          <button class="icon-btn sm" data-z="in" aria-label="Zoom in">+</button>
          <button class="icon-btn sm" data-z="out" aria-label="Zoom out">−</button>
          <button class="icon-btn sm" data-z="fit" aria-label="Fit map">⤢</button>
        </div>
        <div class="banner" id="banner" hidden></div>
        ${online() ? `<div class="codetag">${esc(S.code)}</div>` : ''}
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
  app.onclick = null;
  buildMap();
  $('#menuBtn').onclick = () => { sfx.tap(); openMenu(); };
  $('#helpBtn').onclick = () => { sfx.tap(); openHelp({ map: G.map, opts: G.opts }); };
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
  if (G.over) { showGameOver(); return; }
  if (online()) { checkPrompts(); if (G.cur === S.mySeat && G.phase === 'play') toast('Your turn!'); }
  else nextHandoff();
}

function nextHandoff() {
  if (G.phase === 'setup') {
    showHandoff(G.players.findIndex(p => p.pending), true);
    return;
  }
  if (!settings.hideHand) {
    ui.viewer = G.cur; renderAll(); sfx.turn();
    toast(`${G.players[G.cur].name}'s turn`);
    checkPrompts();
    return;
  }
  showHandoff(G.cur, false);
}

// Open the sheet the current situation requires (ticket choice, tunnel payment)
function checkPrompts() {
  if (!G || G.over || ui.busy || ui.overlay || ui.viewer === null || app.className !== 'screen-game') return;
  const me = ui.viewer;
  if (G.phase === 'setup' && online() && G.players[me].pending) openTicketChooser(true);
  else if (G.phase === 'tickets' && G.cur === me && G.players[me].pending) openTicketChooser(false);
  else if (G.phase === 'tunnel' && G.cur === me) openTunnel();
}

function save() { if (!online()) store.set(LS.game, G); }

// ---------- map ----------
const LABEL_POS = {
  usa: {
    SEA: [0, -14, 'middle'], POR: [-12, 4, 'end'], SFO: [-12, 4, 'end'], LAX: [-10, 15, 'end'],
    MIN: [-11, 4, 'end'], SLC: [11, -8, 'start'], CHI: [-4, -13, 'end'], BOS: [11, 4, 'start'],
    NYC: [11, 8, 'start'], LAS: [11, -6, 'start'], PHX: [-10, 15, 'end'], SAF: [11, -6, 'start'],
    DEN: [11, -8, 'start'], KAN: [11, -8, 'start'], STL: [11, -8, 'start'], PIT: [-6, 17, 'end'],
    WAS: [11, 8, 'start'], ELP: [0, 20, 'middle'], OKC: [-11, 16, 'middle'], DAL: [0, 20, 'middle'],
    HOU: [0, 20, 'middle'], MEM: [11, -6, 'start'], NAS: [11, -8, 'start'], ATL: [-12, 14, 'end'],
    RAL: [11, -6, 'start'], CHS: [11, 8, 'start'], NOR: [0, 20, 'middle'], MIA: [-11, 4, 'end'],
  },
  europe: {
    EDI: [-11, 4, 'end'], LON: [-11, 4, 'end'], BRE: [-11, 4, 'end'], LIS: [-11, 4, 'end'], CAD: [0, 20, 'middle'],
    MAD: [0, 20, 'middle'], BAR: [11, 12, 'start'], PAM: [0, -13, 'middle'], BOR: [-11, 4, 'end'],
    PAR: [-10, 16, 'end'], BRU: [-11, 4, 'end'], AMS: [0, -13, 'middle'], COL: [11, -6, 'start'],
    FRA: [11, 12, 'start'], ZUR: [-10, 15, 'end'], MAR: [0, 20, 'middle'], MUN: [11, 12, 'start'],
    VEN: [-11, 4, 'end'], ROM: [-11, 4, 'end'], PAL: [0, 20, 'middle'], BRI: [11, 12, 'start'],
    VIE: [11, -6, 'start'], BUD: [11, -6, 'start'], ZAG: [0, 20, 'middle'], SAR: [-11, 14, 'end'],
    ATH: [0, 20, 'middle'], SOF: [11, 12, 'start'], BUC: [11, -6, 'start'], IST: [11, -6, 'start'],
    IZM: [0, 20, 'middle'], ANK: [0, 20, 'middle'], ERZ: [0, 20, 'middle'], SEV: [0, 20, 'middle'],
    SOC: [0, 20, 'middle'], ROS: [11, 4, 'start'], KHA: [11, 4, 'start'], KYI: [11, -6, 'start'],
    ODE: [-11, 4, 'end'], LVI: [-11, 12, 'end'], WAR: [11, -6, 'start'], GDA: [0, -13, 'middle'],
    BER: [-4, -13, 'middle'], CPH: [0, -13, 'middle'], STO: [0, -13, 'middle'], STP: [0, -13, 'middle'],
    RIG: [11, 4, 'start'], VIL: [11, 4, 'start'], SMO: [11, 4, 'start'], MOS: [0, -13, 'middle'],
  },
};

function computeGeom() {
  geom = {};
  const { ROUTES, CITY } = MD();
  for (const r of ROUTES) {
    const A = CITY[r.a], B = CITY[r.b];
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
  const { map, ROUTES } = MD();
  const [, , W, H] = map.viewBox;
  FULL = { x: 0, y: 0, w: W, h: H };
  const fer = r => E.ferryLocos(G, r);
  const routesSvg = ROUTES.map(r => {
    const g = geom[r.id];
    const cars = g.cars.map((c, k) => `<g transform="translate(${c.x.toFixed(1)},${c.y.toFixed(1)}) rotate(${g.ang.toFixed(1)})"><rect class="car" style="--k:${k}" x="${(-g.cl / 2).toFixed(1)}" y="${(-g.w / 2).toFixed(1)}" width="${g.cl.toFixed(1)}" height="${g.w}" rx="1.8"/>${k < fer(r) ? '<circle class="fmark" r="2.6"/>' : ''}</g>`).join('');
    return `<g class="route c-${r.color} ${E.isTunnel(G, r) ? 'tunnel' : ''} ${fer(r) ? 'ferry' : ''}" data-id="${r.id}">${cars}</g>`;
  }).join('');
  const labels = LABEL_POS[map.id] || {};
  const cities = map.cities.map(c => {
    const [dx, dy, anchor] = labels[c.id] || [0, -13, 'middle'];
    return `<g class="city" data-id="${c.id}"><circle cx="${c.x}" cy="${c.y}" r="7"/><circle class="inner" cx="${c.x}" cy="${c.y}" r="3"/>
      <text x="${c.x + dx}" y="${c.y + dy}" text-anchor="${anchor}">${esc(c.name)}</text></g>`;
  }).join('');
  const compassAt = map.id === 'europe' ? [70, 95] : [W - 70, H - 70];
  svg.innerHTML = `
    <defs>
      <pattern id="waves" width="28" height="14" patternUnits="userSpaceOnUse">
        <path d="M0 10 q7 -6 14 0 t14 0" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1.2"/>
      </pattern>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#0b1a28" flood-opacity=".35"/></filter>
    </defs>
    <rect x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}" class="sea"/>
    <rect x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}" fill="url(#waves)"/>
    <path d="${map.outline}" class="land" filter="url(#shadow)"/>
    ${map.lakes.map(d => `<path d="${d}" class="lake"/>`).join('')}
    ${compassSvg(...compassAt)}
    <g id="routesLayer">${routesSvg}</g>
    <g id="planLayer"></g>
    <g id="hintLayer"></g>
    <g id="citiesLayer">${cities}</g>
    <g id="stationLayer"></g>
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
  if (!svg || !vb || !svg.isConnected) return;
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
  const setW = w => { const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2; vb.w = w; vb.h = w * a; vb.x = cx - w / 2; vb.y = cy - vb.h / 2; };
  if (vb.w > maxW) setW(maxW);
  if (vb.w < minW) setW(minW);
  const clampAxis = (pos, size, full) => size >= full ? (full - size) / 2 : Math.max(-size * 0.15, Math.min(full - size * 0.85, pos));
  vb.x = clampAxis(vb.x, vb.w, FULL.w);
  vb.y = clampAxis(vb.y, vb.h, FULL.h);
}

function applyVB() {
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const k = (svg.clientWidth || 1) / vb.w;
  svg.style.setProperty('--label', Math.max(9, Math.min(15, 11.5 / k)) + 'px');
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
  // Nearest route; a city wins when the tap is right on it (for stations)
  const thr = Math.max(10, 26 / k);
  let best = null, bd = Infinity;
  for (const r of MD().ROUTES) {
    const d = distToSeg(p.x, p.y, geom[r.id]);
    if (d < bd) { bd = d; best = r.id; }
  }
  if (G.opts.stations) {
    let bc = null, bcd = Infinity;
    for (const c of MD().map.cities) {
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < bcd) { bcd = d; bc = c.id; }
    }
    if (bcd < Math.max(8, 13 / k) && bcd <= bd + 3) {
      sfx.tap();
      ui.selCity = ui.selCity === bc ? null : bc; ui.selected = null; ui.plan = null;
      renderAll(); return;
    }
  }
  if (bd > thr) {
    if (ui.selected !== null || ui.plan || ui.selCity) { ui.selected = null; ui.selCity = null; ui.plan = null; renderAll(); }
    return;
  }
  sfx.tap();
  ui.selected = best === ui.selected ? null : best;
  ui.selCity = null;
  renderAll();
}

// ---------- rendering ----------
function renderAll() {
  if (!G || app.className !== 'screen-game') return;
  renderPlayers();
  renderRoutes();
  renderStations();
  renderHints();
  renderMarket();
  renderHand();
  renderStatus();
  renderBanner();
}

function renderPlayers() {
  $('#players').innerHTML = G.players.map((p, i) => `
    <div class="pchip ${i === G.cur && !G.over && G.phase !== 'setup' ? 'active' : ''}" style="--pc:${PC[p.color]}">
      <div class="pname"><span class="dot"></span>${esc(p.name)}${online() && i === S.mySeat ? ' <small>(you)</small>' : ''}${online() && i !== S.mySeat ? `<i class="pres ${isHere(S.doc, p.uid) ? 'on' : ''}" title="${isHere(S.doc, p.uid) ? 'In the game' : 'Away'}"></i>` : ''}${G.phase === 'setup' && p.pending ? ' <small>choosing tickets…</small>' : ''}</div>
      <div class="pstats">
        <span title="Route points"><b>${p.routePts}</b> pts</span>
        <span title="Trains left">🚃${p.trains}</span>
        <span title="Cards in hand">🂠${E.handCount(p)}</span>
        <span title="Tickets">🎫${p.tickets.length}</span>
        ${G.opts.stations ? `<span title="Stations left">🏠${p.stations}</span>` : ''}
      </div>
    </div>`).join('');
}

function myTurnNow() {
  return ui.viewer !== null && ui.viewer === G.cur && !ui.busy && G.phase === 'play' && !G.over;
}

function renderRoutes() {
  const viewer = ui.viewer;
  for (const r of MD().ROUTES) {
    const el = svg.querySelector(`.route[data-id="${r.id}"]`);
    const owner = G.claimed[r.id];
    el.classList.toggle('claimed', owner !== undefined);
    if (owner !== undefined) el.style.setProperty('--pc', PC[G.players[owner].color]);
    const closed = owner === undefined && r.pair !== null && G.claimed[r.pair] !== undefined && G.opts.doubleClosed;
    el.classList.toggle('closed', closed);
    el.classList.toggle('sel', ui.selected === r.id);
    const can = settings.hints && myTurnNow() && G.drawn === 0 && E.routeStatus(G, viewer, r.id).ok;
    el.classList.toggle('can', !!can);
  }
  svg.querySelectorAll('.city').forEach(c => c.classList.toggle('sel', c.dataset.id === ui.selCity));
}

function renderStations() {
  const { CITY } = MD();
  $('#stationLayer').innerHTML = Object.entries(G.stationAt || {}).map(([cid, pi]) => {
    const c = CITY[cid];
    return `<g class="station" transform="translate(${c.x + 7},${c.y - 7})" style="--pc:${PC[G.players[pi].color]}"><path d="${STATION_PATH}"/></g>`;
  }).join('');
}

function renderHints() {
  const hl = $('#hintLayer'), pl = $('#planLayer');
  const { CITY, TICKETS } = MD();
  let h = '', pth = '';
  if (ui.viewer !== null && !G.over) {
    const p = G.players[ui.viewer];
    if (settings.hints) {
      const rings = new Map();
      for (const tid of p.tickets) {
        const t = TICKETS[tid];
        const done = E.ticketDone(G, ui.viewer, tid);
        for (const c of [t.a, t.b]) if (!rings.has(c) || !done) rings.set(c, done);
      }
      for (const [cid, done] of rings) {
        const c = CITY[cid];
        h += `<circle class="ring ${done ? 'done' : ''}" cx="${c.x}" cy="${c.y}" r="12" style="--pc:${PC[p.color]}"/>`;
      }
    }
    if (ui.plan) {
      const t = TICKETS[ui.plan.tid];
      for (const rid of ui.plan.routes) {
        const g = geom[rid];
        pth += `<line class="plan ${G.claimed[rid] === ui.viewer ? 'own' : ''}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`;
      }
      for (const c of [t.a, t.b]) h += `<circle class="target" cx="${CITY[c].x}" cy="${CITY[c].y}" r="15"/>`;
    }
  }
  hl.innerHTML = h; pl.innerHTML = pth;
}

function cardHtml(color, { count = null, cls = '', attrs = '' } = {}) {
  return `<div class="card c-${color} ${cls}" ${attrs}><span class="ci">${TRAIN_SVG}</span>${count !== null ? `<span class="cnt">${count}</span>` : ''}</div>`;
}

function renderMarket() {
  const my = myTurnNow();
  const face = G.faceUp.map((c, i) => c
    ? `<button class="slot ${my && E.canTakeFaceUp(G, i) ? '' : 'off'}" data-f="${i}" aria-label="${E.COLOR_LABEL[c]} card">${cardHtml(c)}</button>`
    : `<div class="slot empty"></div>`).join('');
  const deckN = G.deck.length + G.discard.length;
  $('#market').innerHTML = `
    <div class="faceup">${face}</div>
    <div class="decks">
      <button class="slot ${my && E.canDrawDeck(G) ? '' : 'off'}" data-d="deck" aria-label="Draw from deck">
        <div class="card back"><span class="cnt">${deckN}</span></div></button>
      <button class="slot ${my && E.canDrawTickets(G) ? '' : 'off'}" data-d="tickets" aria-label="Draw destination tickets">
        <div class="tcard"><span>🎫</span><span class="cnt">${G.ticketDeck.length}</span></div></button>
    </div>`;
}

function renderHand() {
  const hand = $('#hand');
  const tb = $('#ticketBtn');
  if (ui.viewer === null) {
    hand.innerHTML = `<div class="hidden-hand">${online() ? 'Watching' : 'Hand hidden'}</div>`;
    tb.innerHTML = `🎫`; tb.disabled = true;
    return;
  }
  const p = G.players[ui.viewer];
  const items = HAND_ORDER.filter(c => p.hand[c]).map(c => cardHtml(c, { count: p.hand[c], attrs: `data-c="${c}"` }));
  hand.innerHTML = items.length ? items.join('') : `<div class="hidden-hand">No cards yet</div>`;
  const done = E.ticketResult(G, ui.viewer).done.length;
  tb.disabled = false;
  tb.innerHTML = `<span>🎫</span><b>${done}/${p.tickets.length}</b>`;
}

function renderStatus() {
  const st = $('#status');
  if (G.over) { st.innerHTML = `<div class="msg">Game over. <button class="link" data-s="results">Show results</button></div>`; return; }
  const curP = G.players[G.cur];
  if (ui.busy) { st.innerHTML = `<div class="msg muted">${online() ? 'Sending…' : 'Turn complete…'}</div>`; return; }
  if (ui.viewer === null) { st.innerHTML = `<div class="msg muted">Waiting for ${esc(curP.name)}</div>`; return; }
  const p = G.players[ui.viewer];
  if (ui.selected !== null) { st.innerHTML = claimHtml(ui.selected); return; }
  if (ui.selCity) { st.innerHTML = stationHtml(ui.selCity); return; }
  if (ui.plan) {
    const t = MD().TICKETS[ui.plan.tid];
    st.innerHTML = `<div class="msg plan-msg"><span>Showing <b>${esc(cityName(t.a))} → ${esc(cityName(t.b))}</b>: ${ui.plan.cost ? `${plural(ui.plan.cost, 'more train')} needed` : 'complete!'}</span><button class="icon-btn sm" data-s="clearplan" aria-label="Clear">✕</button></div>`;
    return;
  }
  let msg;
  const mine = G.cur === ui.viewer;
  const away = q => online() && !isHere(S.doc, q.uid) ? ` <span class="awaynote">(away — they’ll see it when they open the game)</span>` : '';
  if (G.phase === 'setup') {
    const choosing = G.players.filter(q => q.pending && q !== p);
    msg = p.pending ? 'Choose your starting tickets. <button class="link" data-s="prompt">Open</button>'
      : `Not started yet: waiting for ${choosing.map(q => `<b style="color:${PC[q.color]}">${esc(q.name)}</b>${away(q)}`).join(', ')} to choose starting tickets. ${esc(curP.name)} goes first.`;
  } else if (!mine) msg = `Waiting for <b style="color:${PC[curP.color]}">${esc(curP.name)}</b>${G.phase === 'tunnel' ? ' (digging a tunnel)' : ''}…${away(curP)}`;
  else if (G.phase === 'tickets') msg = 'Choose which destination tickets to keep. <button class="link" data-s="prompt">Open</button>';
  else if (G.phase === 'tunnel') msg = 'Tunnel! Pay the extra cards or give up. <button class="link" data-s="prompt">Open</button>';
  else if (G.drawn === 1) msg = E.mustEndTurnManually(G)
    ? `No cards left to draw. <button class="link" data-s="endturn">End turn</button>`
    : '<b>Take one more card</b> (a face-up locomotive isn’t allowed now).';
  else msg = `<b>${online() ? 'Your turn' : esc(p.name)}</b>: draw 2 cards, tap a route to claim it${G.opts.stations ? ', tap a city for a station' : ''}, or take 🎫 tickets.`;
  st.innerHTML = `<div class="msg" style="--pc:${PC[mine ? p.color : curP.color]}">${msg}</div>`;
}

function blockedReason(vi) {
  if (vi !== G.cur) return 'Not your turn.';
  if (G.phase !== 'play') return 'Finish what you’re doing first.';
  if (G.drawn) return 'You’ve drawn a card — take your second card to finish the turn.';
  return null;
}

function payButtons(opts, attr, label) {
  return `<div class="payopts">${opts.map((o, k) => `
    <button class="pay" ${attr}="${k}">
      <span class="paycards">${o.colored ? cardHtml(o.color, { count: o.colored, cls: 'tiny' }) : ''}${o.locos ? cardHtml('loco', { count: o.locos, cls: 'tiny' }) : ''}</span>
      <span>${label}</span></button>`).join('')}</div>`;
}

function claimHtml(rid) {
  const r = MD().ROUTES[rid];
  const vi = ui.viewer;
  const tun = E.isTunnel(G, r), fer = E.ferryLocos(G, r);
  const head = `<div class="claim-head">
      <span class="swatch c-${r.color}"></span>
      <b>${esc(cityName(r.a))} – ${esc(cityName(r.b))}</b>
      <span class="chip">${r.len} 🚃</span><span class="chip">+${E.ROUTE_POINTS[r.len]}</span>
      <button class="icon-btn sm" data-s="close" aria-label="Close">✕</button></div>
      ${tun ? '<p class="tag-line">⛰ Tunnel: 3 cards are revealed when you claim; each match costs one more card.</p>' : ''}
      ${fer ? `<p class="tag-line">⛴ Ferry: needs at least ${plural(fer, 'locomotive')}.</p>` : ''}`;
  let body;
  const owner = G.claimed[rid];
  const st = E.routeStatus(G, vi, rid);
  const block = blockedReason(vi);
  if (owner !== undefined) body = `<p>Claimed by <b style="color:${PC[G.players[owner].color]}">${esc(G.players[owner].name)}</b>.</p>`;
  else if (st.reason === 'closed') body = `<p>Closed — the other side of this double route is taken.</p>`;
  else if (st.reason === 'ownpair') body = `<p>You already own the other side of this double route.</p>`;
  else if (block) body = `<p>${block}</p>`;
  else if (st.reason === 'trains') body = `<p>Not enough trains (you have ${G.players[vi].trains}).</p>`;
  else if (st.reason === 'cards') {
    const p = G.players[vi];
    const need = r.color === 'gray' ? `${r.len} cards of one colour` : `${r.len} ${E.COLOR_LABEL[r.color].toLowerCase()} cards`;
    const have = r.color === 'gray' ? Math.max(0, ...E.COLORS.map(c => p.hand[c] || 0)) : (p.hand[r.color] || 0);
    body = `<p>Needs ${need}${fer ? ` incl. ${plural(fer, 'locomotive')}` : ''}. You have ${have}${p.hand.loco ? ` + ${plural(p.hand.loco, 'locomotive')}` : ''}.</p>`;
  } else body = payButtons(E.paymentOptions(G, vi, rid), 'data-pay', tun ? 'Try' : 'Claim');
  return `<div class="claim">${head}${body}</div>`;
}

function stationHtml(cid) {
  const vi = ui.viewer;
  const p = G.players[vi];
  const head = `<div class="claim-head">
      <svg class="sticon" viewBox="-8 -9 16 14" style="--pc:${PC[p.color]}"><path d="${STATION_PATH}"/></svg>
      <b>Station in ${esc(cityName(cid))}</b>
      <span class="chip">${p.stations} left</span>
      <button class="icon-btn sm" data-s="close" aria-label="Close">✕</button></div>`;
  const st = E.stationStatus(G, vi, cid);
  const block = blockedReason(vi);
  let body;
  if (st.reason === 'taken') body = `<p>${esc(G.players[st.by].name)} has a station here.</p>`;
  else if (st.reason === 'none') body = `<p>You’ve built all your stations.</p>`;
  else if (block) body = `<p>${block}</p>`;
  else if (st.reason === 'cards') body = `<p>Costs ${plural(E.stationCost(p), 'card')} of one colour (locomotives are wild).</p>`;
  else body = payButtons(E.stationOptions(G, vi), 'data-spay', 'Build');
  return `<div class="claim">${head}<p class="tag-line">Lets you use one rival route out of this city for your tickets. Unused stations score ${E.STATION_PTS} each.</p>${body}</div>`;
}

function renderBanner() {
  const b = $('#banner');
  if (G.finalTurns !== null && !G.over) {
    b.hidden = false;
    b.textContent = `Final round · ${plural(G.finalTurns, 'turn')} left`;
  } else b.hidden = true;
}

// ---------- input ----------
function onMarketClick(e) {
  const b = e.target.closest('button.slot');
  if (!b || ui.busy || ui.viewer === null || ui.viewer !== G.cur) return;
  if (b.classList.contains('off')) {
    if (b.dataset.f !== undefined && G.drawn === 1 && G.faceUp[+b.dataset.f] === E.LOCO) toast('A face-up locomotive can only be your first card');
    else if (b.dataset.d === 'tickets' && G.drawn === 1) toast('Take your second card first');
    sfx.error(); return;
  }
  ui.selected = null; ui.selCity = null; ui.plan = null;
  const srcRect = b.getBoundingClientRect();
  if (b.dataset.f !== undefined) { const i = +b.dataset.f; act(s => E.takeFaceUp(s, i), srcRect); }
  else if (b.dataset.d === 'deck') act(s => E.takeDeck(s), srcRect);
  else if (b.dataset.d === 'tickets') act(s => E.drawTickets(s));
}

function onStatusClick(e) {
  const t = e.target.closest('[data-s],[data-pay],[data-spay]');
  if (!t) return;
  if (t.dataset.s === 'close') { ui.selected = null; ui.selCity = null; renderAll(); return; }
  if (t.dataset.s === 'clearplan') { ui.plan = null; renderAll(); return; }
  if (t.dataset.s === 'endturn') { act(s => E.forceEndTurn(s)); return; }
  if (t.dataset.s === 'results') { showGameOver(); return; }
  if (t.dataset.s === 'prompt') { checkPrompts(); return; }
  if (t.dataset.pay !== undefined && ui.selected !== null) {
    const rid = ui.selected;
    const opt = E.paymentOptions(G, ui.viewer, rid)[+t.dataset.pay];
    ui.selected = null; ui.plan = null;
    act(s => E.claimRoute(s, rid, opt));
  }
  if (t.dataset.spay !== undefined && ui.selCity) {
    const cid = ui.selCity;
    const opt = E.stationOptions(G, ui.viewer)[+t.dataset.spay];
    ui.selCity = null;
    act(s => E.buildStation(s, cid, opt));
  }
}

// Run an engine action locally or through Firestore
async function act(fn, srcRect, { anyTurn = false } = {}) {
  if (ui.busy) return;
  let res;
  if (online()) {
    ui.busy = true; renderStatus();
    try {
      const out = await Online.apply(S.code, fn, S.mySeat, { anyTurn });
      res = out.res;
      if (res.ok) { G = out.state; S.version = out.version; }
    } catch (err) {
      ui.busy = false; toast(Online.explain(err)); sfx.error();
      if (err.message === 'stale') await S.resync?.();
      renderAll();
      return;
    }
    ui.busy = false;
  } else {
    res = fn(G);
    if (res.ok) save();
  }
  if (!res.ok) { toast(res.error); sfx.error(); renderAll(); return; }
  handleEvents(res.events, srcRect);
}

function handleEvents(events, srcRect) {
  const ends = events.some(ev => ev.type === 'turnEnd' || ev.type === 'gameOver');
  const over = events.some(ev => ev.type === 'gameOver');
  if (ends && !online()) ui.busy = true;
  renderAll();
  let delay = 700;
  for (const ev of events) {
    if (ev.type === 'card') {
      ev.color === E.LOCO ? sfx.loco() : sfx.card();
      haptic(8);
      if (srcRect) flyCard(ev.color, srcRect);
    }
    if (ev.type === 'route') { animateClaim(ev); delay = 900 + MD().ROUTES[ev.rid].len * 110; }
    if (ev.type === 'station') { sfx.claim(1); haptic(20); }
    if (ev.type === 'tickets' || ev.type === 'ticketDraw') sfx.ticket();
    if (ev.type === 'tunnelReveal' && ev.extra === 0) toast('Tunnel clear — no extra cards needed!');
    if (ev.type === 'tunnelFail') { toast('You keep your cards; the turn is over.'); }
    if (ev.type === 'finalRound') {
      setTimeout(() => { sfx.final(); bigToast('Final round!', `${G.players[ev.player].name} is almost out of trains. Everyone gets one last turn.`); }, 500);
      delay += 1800;
    }
  }
  if (over) {
    if (!online()) setTimeout(() => { ui.busy = false; ui.viewer = null; renderAll(); showGameOver(); }, delay + 300);
    else setTimeout(showGameOver, delay + 300);
  } else if (ends && !online()) {
    setTimeout(() => {
      ui.busy = false;
      ui.viewer = settings.hideHand ? null : ui.viewer;
      renderAll();
      nextHandoff();
    }, delay);
  } else checkPrompts();
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
  const r = MD().ROUTES[ev.rid];
  const el = svg.querySelector(`.route[data-id="${ev.rid}"]`);
  if (!el) return;
  el.classList.remove('anim'); void el.getBBox(); el.classList.add('anim');
  setTimeout(() => el.classList.remove('anim'), 1500);
  sfx.claim(r.len); haptic(25);
  const g = geom[ev.rid];
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', g.cx); t.setAttribute('y', g.cy - 8);
  t.setAttribute('class', 'pop');
  t.style.setProperty('--pc', PC[G.players[ev.player].color]);
  t.textContent = `+${ev.pts}`;
  $('#fxLayer').appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

// ======================================================================
// Overlays
// ======================================================================
function openOverlay(html, { cls = '', onClick, dismiss = true, kind = 'sheet' } = {}) {
  overlayRoot.innerHTML = `<div class="overlay ${cls}"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const ov = overlayRoot.firstElementChild;
  ui.overlay = ov; ui.overlayKind = kind;
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
  ui.overlay = null; ui.overlayKind = null;
  ov.classList.remove('show');
  setTimeout(() => { if (ov.parentNode) ov.remove(); }, 220);
  // re-open anything still required (e.g. a ticket choice) after menus close
  setTimeout(checkPrompts, 260);
}

function closeOverlayNow() { ui.overlay = null; ui.overlayKind = null; overlayRoot.innerHTML = ''; }

function showHandoff(pi, setup) {
  const p = G.players[pi];
  ui.viewer = null; ui.selected = null; ui.selCity = null; ui.plan = null;
  renderAll();
  const recap = setup ? '' : recapHtml(pi);
  const nTickets = p.pending?.length || 3;
  openOverlay(`
    <div class="handoff" style="--pc:${PC[p.color]}">
      <div class="avatar">${TRAIN_SVG}</div>
      <p class="kicker">${setup ? 'Starting tickets' : `Turn ${G.turn}`}</p>
      <h2>Pass to ${esc(p.name)}</h2>
      <p class="sub">${setup ? `Pick at least 2 of your ${nTickets} destination tickets. Keep them secret!` : 'Your hand is hidden until you’re ready.'}</p>
      ${recap}
      <button class="btn primary big" data-a="reveal">I’m ${esc(p.name)} — show my hand</button>
    </div>`, {
    cls: 'handoff-ov', dismiss: false, kind: 'handoff',
    onClick: e => {
      if (!e.target.closest('[data-a="reveal"]')) return;
      sfx.turn(); haptic(10);
      ui.viewer = pi;
      closeOverlayNow();
      renderAll();
      if (setup) setTimeout(() => openTicketChooser(true), 200);
      else setTimeout(checkPrompts, 200);
    },
  });
}

function logText(l) {
  if (l.kind === 'card' && l.color) return `took ${cardHtml(l.color, { cls: 'micro' })}`;
  return esc(l.text);
}

function recapHtml(pi) {
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
    const plain = t.items[0].sys && !t.items[0].final;
    return `<li><span class="dot" style="--pc:${PC[q.color]}"></span><span>${plain ? '' : `<b>${esc(q.name)}</b> `}${t.items.map(logText).join(', ')}</span></li>`;
  }).join('');
  return `<div class="recap"><h3>Since your last turn</h3><ul>${rows}</ul></div>`;
}

function miniMap(t) {
  const { CITY, map } = MD();
  const A = CITY[t.a], B = CITY[t.b];
  const [, , W, H] = map.viewBox;
  return `<svg class="mini" viewBox="40 50 ${W - 60} ${H - 70}" aria-hidden="true">
    <path d="${map.outline}" class="land"/>
    ${map.cities.map(c => `<circle cx="${c.x}" cy="${c.y}" r="9" class="mdot"/>`).join('')}
    <line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="mline"/>
    <circle cx="${A.x}" cy="${A.y}" r="30" class="mend"/><circle cx="${B.x}" cy="${B.y}" r="30" class="mend"/>
  </svg>`;
}

function ticketHtml(tid, { sel = false, status = '', btn = true } = {}) {
  const t = MD().TICKETS[tid];
  const tag = btn ? 'button' : 'div';
  return `<${tag} class="ticket ${sel ? 'sel' : ''} ${status} ${t.long ? 'long' : ''}" data-t="${tid}">
    ${miniMap(t)}
    <div class="tinfo">${t.long ? '<span class="longtag">Long route</span>' : ''}<div class="tcities">${esc(cityName(t.a))}<span>→</span>${esc(cityName(t.b))}</div></div>
    <div class="tpts">${t.pts}</div>
    <div class="tcheck">✓</div>
  </${tag}>`;
}

function openTicketChooser(setup) {
  const pi = ui.viewer;
  const p = G.players[pi];
  if (!p.pending) return;
  const min = setup ? 2 : 1;
  const keep = new Set(p.pending.filter(id => !MD().TICKETS[id].long));
  const render = () => {
    const sheet = ui.overlay?.querySelector('.sheet');
    const html = `
      <div class="chooser">
        <h2>${setup ? 'Your starting tickets' : 'New destination tickets'}</h2>
        <p class="sub">Connect both cities with your trains by the end to score the points; unfinished tickets count against you. Keep at least ${min}.${p.pending.some(id => MD().TICKETS[id].long) ? ' A long-route ticket you don’t keep leaves the game.' : ''}</p>
        <div class="tickets">${p.pending.map(tid => ticketHtml(tid, { sel: keep.has(tid) })).join('')}</div>
        ${!setup && p.tickets.length ? `<details class="have"><summary>Tickets you already have (${p.tickets.length})</summary>
          <div class="tickets small">${p.tickets.map(tid => ticketHtml(tid, { btn: false, status: E.ticketDone(G, pi, tid) ? 'done' : '' })).join('')}</div></details>` : ''}
        <button class="btn primary big" data-a="keep" ${keep.size < min ? 'disabled' : ''}>Keep ${plural(keep.size, 'ticket')}</button>
      </div>`;
    if (sheet) sheet.innerHTML = html;
    return html;
  };
  openOverlay(render(), {
    cls: 'bottom', dismiss: false, kind: 'chooser',
    onClick: e => {
      const t = e.target.closest('button.ticket');
      if (t) { const id = +t.dataset.t; keep.has(id) ? keep.delete(id) : keep.add(id); sfx.tap(); render(); return; }
      if (!e.target.closest('[data-a="keep"]') || keep.size < min) return;
      const ids = [...keep];
      if (setup && !online()) {
        closeOverlayNow();
        const r = E.keepSetupTickets(G, pi, ids);
        if (!r.ok) { toast(r.error); return; }
        save(); sfx.ticket();
        ui.viewer = settings.hideHand ? null : ui.viewer;
        renderAll();
        setTimeout(nextHandoff, 300);
      } else {
        act(s => setup ? E.keepSetupTickets(s, pi, ids) : E.keepTickets(s, ids), null, { anyTurn: setup });
        closeOverlayNow();
      }
    },
  });
}

function openTunnel() {
  const t = G.tunnel;
  if (!t) return;
  const r = MD().ROUTES[t.rid];
  const opts = E.tunnelOptions(G);
  const colorName = t.pay.color === E.LOCO ? 'locomotives' : `${E.COLOR_LABEL[t.pay.color].toLowerCase()} cards or locomotives`;
  openOverlay(`
    <div class="tunnel">
      <p class="kicker">⛰ Tunnel</p>
      <h2>${esc(cityName(r.a))} – ${esc(cityName(r.b))}</h2>
      <div class="revealed">${t.revealed.map(c => cardHtml(c, { cls: (c === E.LOCO || c === t.pay.color) ? 'hit' : 'miss' })).join('')}</div>
      <p class="sub">${t.extra === 1 ? '1 match' : `${t.extra} matches`} — you need <b>${t.extra} more</b> ${colorName}.</p>
      ${opts.length ? payButtons(opts, 'data-tpay', 'Pay & claim') : `<p class="sub warn">You don’t have enough matching cards.</p>`}
      <button class="btn ${opts.length ? '' : 'primary'}" data-a="giveup">Give up (keep your cards, end turn)</button>
    </div>`, {
    cls: 'center', dismiss: false, kind: 'tunnel',
    onClick: e => {
      const b = e.target.closest('[data-tpay],[data-a="giveup"]');
      if (!b) return;
      if (b.dataset.tpay !== undefined) { const k = +b.dataset.tpay; act(s => E.tunnelPay(s, k)); }
      else act(s => E.tunnelGiveUp(s));
      closeOverlayNow();
    },
  });
}

function openTicketsView() {
  const pi = ui.viewer;
  const p = G.players[pi];
  const { TICKETS } = MD();
  const tr = E.ticketResult(G, pi);
  const items = p.tickets.map(tid => {
    const done = tr.done.includes(tid);
    const plan = done ? null : E.ticketPlan(G, pi, tid);
    const status = done ? 'done' : plan ? '' : 'blocked';
    const note = done ? 'Complete' : plan ? `${plural(plan.cost, 'more train')} needed` : (G.opts.stations && p.stations ? 'Blocked — a station might save it' : 'Blocked — no open path');
    return `<div class="trow">${ticketHtml(tid, { status })}<div class="tnote ${status}">${note}${!done && plan && settings.hints ? ' · tap to show on map' : ''}</div></div>`;
  }).join('');
  const pts = p.tickets.reduce((a, t) => a + (tr.done.includes(t) ? TICKETS[t].pts : -TICKETS[t].pts), 0);
  openOverlay(`
    <div class="chooser">
      <div class="sheet-head"><h2>Your tickets</h2><button class="icon-btn sm" data-close aria-label="Close">✕</button></div>
      <p class="sub">${tr.done.length} of ${p.tickets.length} complete · if the game ended now: <b>${pts >= 0 ? '+' : ''}${pts}</b> pts · longest route ${E.longestPath(G, pi)} trains${tr.borrowed.length ? ` · stations borrow ${plural(tr.borrowed.length, 'route')}` : ''}</p>
      <div class="tickets list">${items}</div>
    </div>`, {
    cls: 'bottom',
    onClick: e => {
      const t = e.target.closest('button.ticket');
      if (!t || !settings.hints) return;
      const tid = +t.dataset.t;
      const plan = tr.done.includes(tid) ? null : E.ticketPlan(G, pi, tid);
      if (!plan) return;
      ui.plan = { tid, ...plan };
      ui.selected = null; ui.selCity = null;
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
      <button class="btn" data-m="help">Help</button>
      <button class="btn" data-m="log">Game log</button>
      <button class="btn" data-m="settings">Settings</button>
      <button class="btn" data-m="history">Score history</button>
      ${inGame && online() ? `<button class="btn" data-m="mygames">My online games</button>
        <button class="btn" data-m="home">Exit to main menu<small>The game stays open; continue any time</small></button>
        ${G.over ? '' : `<button class="btn danger" data-m="endonline">End game for everyone</button>`}` : ''}
      ${inGame && !online() ? `<button class="btn" data-m="home">Save &amp; exit to menu</button>
      <button class="btn danger" data-m="abandon">Abandon game</button>` : ''}
    </div>`, {
    cls: 'bottom',
    onClick: e => {
      const btn = e.target.closest('[data-m]');
      if (!btn) return;
      const m = btn.dataset.m;
      sfx.tap();
      if (m === 'help') openHelp({ map: G.map, opts: G.opts });
      if (m === 'log') openLog();
      if (m === 'settings') openSettings();
      if (m === 'history') showHistory(true);
      if (m === 'mygames') showMyGames();
      if (m === 'home') { save(); showHome(); }
      if (m === 'endonline') {
        if (!btn.dataset.confirm) { btn.dataset.confirm = '1'; btn.textContent = 'Tap again to end it for all players (no scores)'; return; }
        Online.endGame(S.code).catch(err => toast(Online.explain(err)));
        return;
      }
      if (m === 'abandon') {
        if (btn.dataset.confirm) { store.del(LS.game); G = null; showHome(); }
        else { btn.dataset.confirm = '1'; btn.textContent = 'Tap again to abandon (no score saved)'; }
      }
    },
  });
}

function openLog() {
  const rows = [...G.log].reverse().map(l => {
    const q = G.players[l.p];
    return `<li class="${l.sys ? 'sys' : ''}"><span class="dot" style="--pc:${PC[q.color]}"></span><span>${l.sys && !l.final ? '' : `<b>${esc(q.name)}</b> `}${logText(l)}${l.kind === 'card' && l.color ? ' from the display' : ''}</span></li>`;
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
      ${row('hideHand', 'Hide hand between turns', 'On one phone: a “pass the phone” screen keeps hands secret')}
      <p class="hint">Coast to Coast v${VERSION}</p>
    </div>`, { cls: 'bottom' });
  ov.onchange = e => {
    const k = e.target.dataset.k;
    if (!k) return;
    settings[k] = e.target.checked;
    store.set(LS.settings, settings);
    if (k === 'sound') { setSoundEnabled(settings.sound); sfx.tap(); }
    renderAll();
  };
}

// ---------- help: only what's on in this game ----------
function openHelp(ctx) {
  const map = ctx?.map || null;
  const o = ctx?.opts || null;
  const all = !ctx; // from the home screen: explain everything
  const on = k => all || !!o?.[k];
  const tabs = ['Rules', 'Icons', 'Tips'];
  let tab = 0;
  const startTickets = on('longTickets') && !all ? '1 long + 3 regular' : '3';
  const rules = () => `
    ${ctx ? `<p class="modeline">${E.MAPS[map].name}${map === 'europe' ? ' · ' + (Object.keys(OPT_INFO).filter(k => o[k]).map(k => OPT_INFO[k][0]).join(', ') || 'no extra rules') : ''} · double routes ${o.doubleClosed ? 'one side only' : 'both open'}</p>` : ''}
    <h3>Goal</h3>
    <p>Claim railway routes between cities. Points come from routes, finished destination tickets${on('stations') ? ', unused stations' : ''} and the longest continuous line.</p>
    <h3>Start</h3>
    <p>45 trains, 4 cards and ${startTickets} tickets each; keep at least 2${all ? ' (Europe can add a long-route ticket)' : ''}.</p>
    <h3>Your turn: do one thing</h3>
    <ul>
      <li><b>Draw 2 cards</b> from the 5 face-up or the deck. A face-up locomotive counts as both.</li>
      <li><b>Claim a route</b>: tap it, pay cards equal to its length in its colour. Gray = any one colour. Locomotives are wild.</li>
      <li><b>Draw 3 tickets</b>, keep at least 1.</li>
      ${on('stations') ? `<li><b>Build a station</b>: tap a city. Costs 1, then 2, then 3 cards of one colour.</li>` : ''}
    </ul>
    ${on('tunnels') ? `<h3>⛰ Tunnels</h3><p>Routes with dark dashed outlines. After you pay, 3 cards are flipped; each one matching your colour (or a locomotive) costs one more card. Can’t or won’t pay? Keep your cards, turn ends.</p>` : ''}
    ${on('ferries') ? `<h3>⛴ Ferries</h3><p>Gray sea routes with locomotive dots: each dot must be paid with a locomotive.</p>` : ''}
    ${on('stations') ? `<h3>🏠 Stations</h3><p>One per city. At the end, each lets you use one rival route out of its city to finish your tickets. Unused stations score 4 each.</p>` : ''}
    ${on('longTickets') ? `<h3>Long-route tickets</h3><p>Worth 19–26 points. If you don’t keep it at the start, it leaves the game.</p>` : ''}
    <h3>Double routes</h3>
    <p>Nobody can claim both sides. ${all ? 'With 2–3 players usually only one side is usable.' : o.doubleClosed ? 'In this game only one side can be used at all.' : 'In this game both sides are open.'}</p>
    <h3>Points per route</h3>
    <div class="ptable">${[1, 2, 3, 4, 5, 6].map(l => `<span>${l}</span><b>${E.ROUTE_POINTS[l]}</b>`).join('')}</div>
    <h3>End</h3>
    <p>When someone has 2 or fewer trains left, everyone gets one last turn. Finished tickets add points, unfinished ones subtract. Longest line: +10.</p>`;
  const icons = () => `
    <ul class="legend">
      <li><span class="lg"><b>12</b> pts</span>Route points so far (tickets are secret until the end)</li>
      <li><span class="lg">🚃</span>Trains left</li>
      <li><span class="lg">🂠</span>Cards in hand</li>
      <li><span class="lg">🎫</span>Destination tickets (your button shows done/total)</li>
      ${on('stations') ? '<li><span class="lg">🏠</span>Stations left</li>' : ''}
      <li><span class="lg"><i class="lgl glow"></i></span>Glowing route: you can claim it now</li>
      <li><span class="lg"><i class="lgl ring"></i></span>Dashed ring: a city on your tickets (solid = done)</li>
      <li><span class="lg"><i class="lgl faded"></i></span>Faded route: closed double route</li>
      ${on('tunnels') ? '<li><span class="lg"><i class="lgl tun"></i></span>Dark dashed outline: tunnel</li>' : ''}
      ${on('ferries') ? '<li><span class="lg"><i class="lgl fer"></i></span>White dots: locomotives a ferry needs</li>' : ''}
      ${on('stations') ? `<li><span class="lg"><svg class="sticon" viewBox="-8 -9 16 14" style="--pc:#ff5a47"><path d="${STATION_PATH}"/></svg></span>A player’s station</li>` : ''}
      <li><span class="lg">${cardHtml('loco', { cls: 'tiny' })}</span>Locomotive: wild card</li>
      <li><span class="lg">⤢</span>Fit the whole map (pinch to zoom, drag to move)</li>
    </ul>`;
  const tips = () => `
    <ul class="tips">
      <li><b>Pick tickets that overlap.</b> Two tickets sharing a corridor score twice for one line.</li>
      <li><b>Long routes pay best.</b> A 6 earns 15 points; six 1s earn 6.</li>
      <li><b>Grab bottlenecks early.</b> If a route on your path has no alternative, claim it before it’s gone.</li>
      <li><b>Collect quietly, then strike.</b> Hoard a colour and claim several routes in a row.</li>
      <li><b>Don’t over-draw tickets late.</b> Unfinished tickets cost points.</li>
      <li><b>Watch their trains.</b> When someone gets low, the end is near.</li>
      ${on('tunnels') ? '<li><b>Bring spares to tunnels.</b> An extra locomotive or two avoids a wasted turn.</li>' : ''}
      ${on('ferries') ? '<li><b>Save locomotives</b> for the ferries you’ll need.</li>' : ''}
      ${on('stations') ? '<li><b>Stations are insurance.</b> Each costs 4 points, so use one only to rescue a ticket.</li>' : ''}
    </ul>`;
  const render = () => {
    const sheet = ui.overlay?.querySelector('.sheet');
    const html = `
      <div class="rules">
        <div class="sheet-head"><h2>Help</h2><button class="icon-btn sm" data-close aria-label="Close">✕</button></div>
        <div class="seg tabs">${tabs.map((t, i) => `<button class="${i === tab ? 'on' : ''}" data-tab="${i}">${t}</button>`).join('')}</div>
        <div class="tabbody">${[rules, icons, tips][tab]()}</div>
      </div>`;
    if (sheet) sheet.innerHTML = html;
    return html;
  };
  openOverlay(render(), {
    cls: 'bottom', kind: 'help',
    onClick: e => { const t = e.target.closest('[data-tab]'); if (t) { tab = +t.dataset.tab; sfx.tap(); render(); } },
  });
}

// ---------- game over & history ----------
function showGameOver() {
  const res = E.finalScores(G);
  recordHistory(res);
  const { ROUTES } = MD();
  const winners = res.ranked.filter(r => r.rank === 1);
  const rows = res.ranked.map(r => `
    <div class="result ${r.rank === 1 ? 'win' : ''}" style="--pc:${PC[r.color]}">
      <div class="rhead"><span class="rank">${r.rank === 1 ? '🏆' : r.rank}</span><b>${esc(r.name)}</b><span class="total" data-total="${r.total}">0</span></div>
      <div class="rlines">
        <div><span>Routes</span><b>${r.routePts}</b></div>
        <div><span>Tickets completed (${r.done.length})</span><b class="plus">+${r.plus}</b></div>
        <div><span>Tickets missed (${r.failed.length})</span><b class="minus">−${r.minus}</b></div>
        ${G.opts.stations ? `<div><span>Unused stations (${r.stationsLeft})</span><b>${r.stationPts ? '+' + r.stationPts : '—'}</b></div>` : ''}
        <div><span>Longest route (${r.longest} trains)</span><b>${r.bonus ? '+' + r.bonus : '—'}</b></div>
      </div>
      <div class="rtickets">${r.done.map(t => tLine(t, true)).join('')}${r.failed.map(t => tLine(t, false)).join('')}</div>
      ${r.borrowed.length ? `<p class="hint">Stations borrowed: ${r.borrowed.map(id => `${esc(cityName(ROUTES[id].a))}–${esc(cityName(ROUTES[id].b))}`).join(', ')}</p>` : ''}
    </div>`).join('');
  const ov = openOverlay(`
    <div class="gameover">
      <div class="confetti" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => `<i style="--i:${i};--c:${['#ff5a47', '#12a8a2', '#f2c230', '#5b4fd6', '#86c232'][i % 5]}"></i>`).join('')}</div>
      <p class="kicker">Final scores · ${E.MAPS[G.map].name}</p>
      <h2>${winners.map(w => esc(w.name)).join(' & ')} win${winners.length > 1 ? '' : 's'}!</h2>
      <div class="results">${rows}</div>
      <div id="rematchBox"></div>
      <div class="row2">
        <button class="btn" data-g="board">View board</button>
        <button class="btn primary" data-g="rematch">Rematch…</button>
      </div>
      <button class="btn ghost" data-g="home">Main menu</button>
    </div>`, {
    cls: 'center', dismiss: false, kind: 'gameover',
    onClick: e => {
      const g = e.target.closest('[data-g]')?.dataset.g;
      if (!g) return;
      sfx.tap();
      if (g === 'board') { closeOverlay(); renderAll(); }
      if (g === 'home') { if (!online()) store.del(LS.game); showHome(); }
      if (g === 'joinre') joinRematch();
      if (g === 'rematch') {
        // Rematch opens setup pre-filled so map, rules and colours can change
        const ps = G.players.map(p => ({ name: p.name, color: p.color }));
        if (!online()) {
          store.del(LS.game);
          showSetup({ rematch: true, mode: 'local', map: G.map, opts: G.opts, players: [...ps.slice(1), ps[0]] });
        } else {
          const mine = G.players[S.mySeat] || {};
          const code = S.code;
          showSetup({ rematch: true, mode: 'online', map: G.map, opts: G.opts, me: { name: mine.name, color: mine.color }, rematchOf: code });
        }
      }
    },
  });
  sfx.win();
  maybeRematchButton();
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

function maybeRematchButton() {
  const box = $('#rematchBox');
  if (!box || !online() || !S.doc?.rematch) return;
  box.innerHTML = `<button class="btn primary big" data-g="joinre">Join rematch (${esc(S.doc.rematch)})</button>`;
}

async function joinRematch() {
  const code = S.doc.rematch;
  const mine = G.players[S.mySeat];
  const me = { name: mine.name, color: mine.color };
  try { await Online.joinGame(code, me); showLobby(code); }
  catch (err) {
    if (err.message === 'colortaken') showJoin(code);
    else toast(err.message.startsWith('This game') ? err.message : Online.explain(err));
  }
}

function tLine(tid, done) {
  const t = MD().TICKETS[tid];
  return `<span class="tl ${done ? 'ok' : 'no'}">${done ? '✓' : '✗'} ${esc(cityName(t.a))} – ${esc(cityName(t.b))} <b>${done ? '+' : '−'}${t.pts}</b></span>`;
}

function recordHistory(res) {
  const h = store.get(LS.history, []);
  if (h.some(g => g.id === G.id)) return;
  h.unshift({
    id: G.id, date: Date.now(), turns: G.turn, map: G.map, online: online(),
    players: res.ranked.map(r => ({ name: r.name, color: r.color, total: r.total, rank: r.rank, done: r.done.length, failed: r.failed.length, longest: r.longest })),
  });
  store.set(LS.history, h.slice(0, 200));
}

function showHistory(fromGame = false) {
  closeOverlayNow();
  const h = store.get(LS.history, []);
  const wins = {}, played = {}, best = {};
  for (const g of h) for (const p of g.players) {
    played[p.name] = (played[p.name] || 0) + 1;
    if (p.rank === 1) wins[p.name] = (wins[p.name] || 0) + 1;
    best[p.name] = Math.max(best[p.name] ?? -Infinity, p.total);
  }
  const names = Object.keys(played).sort((a, b) => (wins[b] || 0) - (wins[a] || 0));
  const wasGame = fromGame && G && !G.over;
  const keepS = S;
  app.className = 'screen-history';
  app.oninput = null; app.onchange = null;
  app.innerHTML = `
    <div class="history">
      <header class="subhead"><button class="icon-btn" data-a="back" aria-label="Back">‹</button><h2>Score history</h2></header>
      ${h.length ? `
      <section class="card-section tally">
        ${names.map(n => `<div class="trow2"><b>${esc(n)}</b><span>${plural(wins[n] || 0, 'win')} / ${played[n]} played</span><span>best ${best[n]}</span></div>`).join('')}
      </section>
      <section class="games">
        ${h.map(g => `<div class="gamerow">
          <div class="gdate">${new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${E.MAPS[g.map || 'usa'].name}${g.online ? ' · online' : ''}</div>
          <div class="gplayers">${g.players.map(p => `<span class="gp ${p.rank === 1 ? 'win' : ''}" style="--pc:${PC[p.color] || '#888'}">${p.rank === 1 ? '🏆 ' : ''}${esc(p.name)} <b>${p.total}</b></span>`).join('')}</div>
        </div>`).join('')}
      </section>
      <button class="btn ghost" data-a="clear">Clear history</button>` : `<p class="empty">No finished games yet. Play one!</p>`}
    </div>`;
  app.onclick = e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    sfx.tap();
    if (a.dataset.a === 'back') {
      if (wasGame && keepS.mode === 'online') openOnline(keepS.code);
      else if (wasGame) { S = { mode: 'local' }; startGameScreen(); }
      else showHome();
    }
    if (a.dataset.a === 'clear') {
      if (a.dataset.confirm) { store.del(LS.history); showHistory(fromGame); }
      else { a.dataset.confirm = '1'; a.textContent = 'Tap again to clear all history'; }
    }
  };
  if (keepS.mode === 'online') stopWatch();
}

// ---------- toasts ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.className = 'show'; t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2400);
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

(async () => {
  if (new URLSearchParams(location.search).has('mock')) {
    try { const m = await import('./mock_backend.js'); window.__c2cMockBackend = m.mockBackend; } catch { /* not shipped */ }
  }
  showHome();
})();
