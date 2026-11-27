// Coast to Coast — online play over Firebase (Firestore + anonymous auth).
// The Firebase config lives only in this device's localStorage, never in the code.
import * as E from './engine.js';

const SDK = 'https://www.gstatic.com/firebasejs/13.3.0/';
const CFG_KEY = 'c2c.firebase';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const INVITE_PREFIX = 'C2C1:';

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- config ----------
export function getConfig() { return store.get(CFG_KEY, null); }
export function hasConfig() { const c = getConfig(); return !!(c && c.apiKey && c.projectId); }
export function setConfig(cfg) { store.set(CFG_KEY, cfg); backend = null; }
export function clearConfig() { store.del(CFG_KEY); backend = null; }

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'];

// Accepts the snippet from the Firebase console, plain JSON, or an invite text.
export function parseConfigText(text) {
  text = (text || '').trim();
  if (!text) throw new Error('Nothing pasted');
  const inv = text.match(/C2C1:([A-Za-z0-9_\-]+)/);
  if (inv) {
    const data = JSON.parse(b64urlDecode(inv[1]));
    check(data.c);
    return { config: data.c, code: data.g || null };
  }
  let cfg = null;
  try { cfg = JSON.parse(text); } catch { /* not JSON */ }
  if (!cfg) {
    cfg = {};
    const re = /["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(text))) cfg[m[1]] = m[2];
  }
  const keep = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'databaseId'];
  cfg = Object.fromEntries(keep.filter(k => cfg[k]).map(k => [k, String(cfg[k])]));
  check(cfg);
  return { config: cfg, code: null };
  function check(c) {
    const missing = REQUIRED.filter(k => !c || !c[k]);
    if (missing.length) throw new Error(`Missing ${missing.join(', ')} — paste the whole firebaseConfig block`);
  }
}

export function makeInvite(code = null) {
  const cfg = getConfig();
  if (!cfg) return '';
  const payload = b64urlEncode(JSON.stringify(code ? { c: cfg, g: code } : { c: cfg }));
  return `Join me in Coast to Coast${code ? ` (game ${code})` : ''}. In the app open Online setup → Paste invite:\n${INVITE_PREFIX}${payload}`;
}

function b64urlEncode(s) {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

// ---------- backend ----------
let backend = null;

async function firebaseBackend(cfg) {
  const [appM, authM, fsM] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  const name = 'c2c-' + cfg.projectId;
  const { databaseId, ...appCfg } = cfg;
  const app = appM.getApps().find(a => a.name === name) || appM.initializeApp(appCfg, name);
  const auth = authM.getAuth(app);
  await auth.authStateReady();
  if (!auth.currentUser) await authM.signInAnonymously(auth);
  const db = cfg.databaseId ? fsM.getFirestore(app, cfg.databaseId) : fsM.getFirestore(app);
  const ref = code => fsM.doc(db, 'games', code);
  return {
    uid: auth.currentUser.uid,
    async get(code) { const s = await fsM.getDoc(ref(code)); return s.exists() ? s.data() : null; },
    async create(code, data) {
      await fsM.runTransaction(db, async tx => {
        const s = await tx.get(ref(code));
        if (s.exists()) throw new Error('exists');
        tx.set(ref(code), data);
      });
    },
    async transact(code, fn) {
      return fsM.runTransaction(db, async tx => {
        const s = await tx.get(ref(code));
        if (!s.exists()) throw new Error('missing');
        const out = fn(s.data());
        tx.set(ref(code), out.data);
        return out;
      });
    },
    watch(code, cb) {
      return fsM.onSnapshot(ref(code), s => cb(s.exists() ? s.data() : null), e => cb(null, e));
    },
    async mine(uid) {
      const q = fsM.query(fsM.collection(db, 'games'), fsM.where('uids', 'array-contains', uid));
      const r = await fsM.getDocs(q);
      return r.docs.map(d => d.data());
    },
    async remove(code) { await fsM.deleteDoc(ref(code)); },
    async patch(code, fields) { await fsM.updateDoc(ref(code), fields); },
  };
}

export async function connect() {
  if (backend) return backend;
  if (window.__c2cMockBackend) { backend = await window.__c2cMockBackend(); return backend; }
  const cfg = getConfig();
  if (!cfg) throw new Error('noconfig');
  backend = await firebaseBackend(cfg);
  return backend;
}
export function myUid() { return backend?.uid || null; }

// Friendly message for Firebase errors
export function explain(e) {
  const code = e?.code || e?.message || String(e);
  if (code === 'noconfig') return 'Online play isn’t set up on this phone yet.';
  if (code === 'stale') return 'The board changed — try again.';
  if (code === 'missing') return 'That game doesn’t exist (any more).';
  if (code === 'ended') return 'This game was ended.';
  const tag = ` (${code})`;
  // Authentication problems (checked first: their codes also contain words like "not-found")
  if (/api-key-not-valid|invalid-api-key/.test(code)) return 'The API key looks wrong — paste the config again.' + tag;
  if (/auth\/(configuration-not-found|operation-not-allowed|admin-restricted)/.test(code) || /operation-not-allowed|admin-restricted/.test(code))
    return 'Turn on sign-in: Firebase console → Security → Authentication → Sign-in method tab → enable Anonymous.' + tag;
  if (/auth\/network/.test(code)) return 'Can’t reach Firebase — check your internet connection.' + tag;
  if (/^auth\//.test(code)) return 'Firebase sign-in failed. Check Security → Authentication → Sign-in method: Anonymous must be enabled.' + tag;
  // Firestore problems
  if (/permission-denied|insufficient permissions/i.test(code)) return 'Firestore refused access. Paste the rules from “How to set up” into Databases & Storage → Firestore → Rules tab, then Publish.' + tag;
  if (/not-found|NOT_FOUND|database.*does not exist/i.test(code)) return 'Firestore database not found. Create it in Databases & Storage → Firestore → Create database. If yours isn’t called “(default)”, add databaseId: "your-id" to the pasted config.' + tag;
  if (/failed-precondition/.test(code)) return 'Firestore isn’t ready yet. Check Databases & Storage → Firestore in the console.' + tag;
  if (/unavailable|network|Failed to fetch|offline/i.test(code)) return 'Can’t reach Firebase — check your internet connection.' + tag;
  return 'Online error' + tag;
}

export async function test() {
  const b = await connect();
  await b.get('ZZZZ'); // read access check
  return b.uid;
}

// ---------- games ----------
function newCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
const clean = o => JSON.parse(JSON.stringify(o));

export async function createGame({ map, opts, me }) {
  const b = await connect();
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCode();
    const data = clean({
      code, status: 'lobby', hostUid: b.uid, map, opts,
      players: [{ uid: b.uid, name: me.name, color: me.color }], uids: [b.uid],
      state: null, version: 0, lastEvents: null, rematch: null, curUid: null,
      presence: {}, endedBy: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    try { await b.create(code, data); return code; } catch (e) { if (e.message !== 'exists') throw e; }
  }
  throw new Error('Could not find a free game code');
}

export async function getGame(code) {
  const b = await connect();
  return b.get(code.toUpperCase());
}

export async function joinGame(code, me) {
  const b = await connect();
  code = code.toUpperCase();
  return b.transact(code, d => {
    if (d.uids.includes(b.uid)) return { data: d };
    if (d.status !== 'lobby') throw new Error('This game has already started');
    if (d.players.length >= 5) throw new Error('This game is full');
    if (d.players.some(p => p.color === me.color)) throw new Error('colortaken');
    d.players.push({ uid: b.uid, name: me.name, color: me.color });
    d.uids.push(b.uid);
    d.updatedAt = Date.now();
    return { data: d };
  });
}

export async function updateMe(code, me) {
  const b = await connect();
  return b.transact(code, d => {
    if (d.status !== 'lobby') return { data: d };
    if (d.players.some(p => p.uid !== b.uid && p.color === me.color)) throw new Error('colortaken');
    d.players = d.players.map(p => p.uid === b.uid ? { ...p, name: me.name, color: me.color } : p);
    return { data: d };
  });
}

export async function leaveGame(code) {
  const b = await connect();
  const d = await b.get(code);
  if (!d) return;
  if (d.hostUid === b.uid && d.status === 'lobby') return b.remove(code);
  if (d.status === 'lobby') {
    await b.transact(code, x => {
      x.players = x.players.filter(p => p.uid !== b.uid);
      x.uids = x.uids.filter(u => u !== b.uid);
      return { data: x };
    });
  }
}

export async function deleteGame(code) {
  const b = await connect();
  return b.remove(code);
}

export async function startGame(code) {
  const b = await connect();
  return b.transact(code, d => {
    if (d.hostUid !== b.uid) throw new Error('Only the host can start');
    if (d.status !== 'lobby') return { data: d };
    if (d.players.length < 2) throw new Error('Waiting for at least one more player');
    const first = Math.floor(Math.random() * d.players.length);
    const seats = [...d.players.slice(first), ...d.players.slice(0, first)];
    const opts = E.normOpts(d.map, seats.length, d.opts);
    const s = E.newGame(seats, { ...opts, map: d.map });
    s.online = code;
    d.state = JSON.stringify(s);
    d.status = 'playing';
    d.version = 1;
    d.curUid = s.players[s.cur].uid;
    d.updatedAt = Date.now();
    return { data: d };
  });
}

// Apply an engine action inside a transaction. `fn(state)` returns an engine result.
// Firestore retries the transaction with fresh data on conflicts, so we check the
// rule that matters (it is still this player's turn) instead of an exact version.
export async function apply(code, fn, bySeat, { anyTurn = false } = {}) {
  const b = await connect();
  const out = await b.transact(code, d => {
    const s = E.migrate(JSON.parse(d.state));
    if (d.status === 'ended') throw new Error('ended');
    if (!anyTurn && (s.cur !== bySeat || s.over)) throw new Error('stale');
    const res = fn(s);
    if (!res.ok) return { data: d, res, state: null };
    const pub = res.events.map(ev => (ev.private ? { ...ev, color: null } : ev));
    d.state = JSON.stringify(s);
    d.version = d.version + 1;
    d.lastEvents = JSON.stringify({ id: d.version, by: bySeat, events: pub });
    d.status = s.over ? 'over' : 'playing';
    d.curUid = s.over ? null : s.players[s.cur].uid;
    d.updatedAt = Date.now();
    return { data: d, res, state: s, version: d.version };
  });
  return out;
}

// Who has the game open: a timestamp per player, 0 when they leave
export async function setPresence(code, here) {
  const b = await connect();
  try { await b.patch(code, { [`presence.${b.uid}`]: here ? Date.now() : 0 }); } catch { /* offline or game gone */ }
}

// End an online game for everyone (no scores recorded)
export async function endGame(code) {
  const b = await connect();
  return b.transact(code, d => {
    d.status = 'ended';
    d.endedBy = b.uid;
    d.curUid = null;
    d.updatedAt = Date.now();
    return { data: d };
  });
}

export function watch(code, cb) {
  let unsub = () => {};
  connect().then(b => { unsub = b.watch(code, cb); }).catch(e => cb(null, e));
  return () => unsub();
}

export async function myGames() {
  const b = await connect();
  const list = await b.mine(b.uid);
  return list.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
}

export async function setRematch(oldCode, newCode) {
  const b = await connect();
  try { await b.transact(oldCode, d => { d.rematch = newCode; return { data: d }; }); } catch { /* old game gone */ }
}

export const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /games/{code} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.hostUid == request.auth.uid
        && request.resource.data.uids == [request.auth.uid];
      allow update: if request.auth != null && (
        request.auth.uid in resource.data.uids ||
        (resource.data.status == 'lobby'
          && request.auth.uid in request.resource.data.uids
          && request.resource.data.uids.hasAll(resource.data.uids)
          && request.resource.data.uids.size() == resource.data.uids.size() + 1));
      allow delete: if request.auth != null
        && request.auth.uid == resource.data.hostUid;
    }
  }
}`;
