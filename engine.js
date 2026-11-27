// Coast to Coast — rules engine (pure game logic, no DOM)
import { MAP } from './data.js';
import { MAP_EU } from './data_eu.js';

export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white'];
export const LOCO = 'loco';
export const ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15, 7: 18, 8: 21 };
export const START_TRAINS = 45;
export const LONGEST_BONUS = 10;
export const STATIONS = 3;
export const STATION_PTS = 4;

export const COLOR_LABEL = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue',
  purple: 'Purple', black: 'Black', white: 'White', gray: 'Gray', loco: 'Locomotive',
};

// ---------- maps ----------
export const MAPS = {
  usa: { ...MAP, id: 'usa', name: 'USA' },
  europe: MAP_EU,
};
const MAP_CACHE = {};
export function mapData(id = 'usa') {
  if (!MAP_CACHE[id]) {
    const m = MAPS[id] || MAPS.usa;
    MAP_CACHE[id] = {
      map: m,
      CITY: Object.fromEntries(m.cities.map(c => [c.id, c])),
      ROUTES: m.routes,
      TICKETS: m.tickets,
    };
  }
  return MAP_CACHE[id];
}
export const M = s => mapData(s.map || 'usa');

// Rule options. Europe mechanics only exist on the Europe map.
export function defaultOpts(mapId, nPlayers) {
  const eu = mapId === 'europe';
  return { doubleClosed: nPlayers <= 3, tunnels: eu, ferries: eu, stations: eu, longTickets: eu };
}
export function normOpts(mapId, nPlayers, opts = {}) {
  const o = { ...defaultOpts(mapId, nPlayers), ...opts };
  if (o.doubleClosed === null || o.doubleClosed === undefined) o.doubleClosed = nPlayers <= 3;
  if (mapId !== 'europe') { o.tunnels = o.ferries = o.stations = o.longTickets = false; }
  return o;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newGame(players, opts = {}) {
  const mapId = opts.map || 'usa';
  const o = normOpts(mapId, players.length, opts);
  const { TICKETS } = mapData(mapId);
  const deck = [];
  for (const c of COLORS) for (let i = 0; i < 12; i++) deck.push(c);
  for (let i = 0; i < 14; i++) deck.push(LOCO);
  shuffle(deck);
  const longs = shuffle(TICKETS.filter(t => t.long).map(t => t.id));
  const ticketDeck = shuffle(TICKETS.filter(t => !t.long).map(t => t.id));
  const s = {
    v: 2,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: Date.now(),
    map: mapId,
    opts: { doubleClosed: o.doubleClosed, tunnels: o.tunnels, ferries: o.ferries, stations: o.stations, longTickets: o.longTickets },
    players: players.map(p => ({
      name: p.name, color: p.color, uid: p.uid || null, hand: {}, tickets: [], pending: null,
      trains: START_TRAINS, routePts: 0, routes: [], stations: o.stations ? STATIONS : 0,
    })),
    deck, discard: [], faceUp: [null, null, null, null, null],
    ticketDeck, claimed: {}, stationAt: {},
    cur: 0, phase: 'setup', drawn: 0, finalTurns: null, turn: 1, tunnel: null,
    log: [], over: false,
  };
  for (const p of s.players) {
    for (let i = 0; i < 4; i++) addCard(p, drawFromDeck(s));
    const extra = o.longTickets && longs.length ? [longs.pop()] : [];
    p.pending = [...extra, ...s.ticketDeck.splice(0, 3)];
  }
  refillFaceUp(s);
  return s;
}

export function handCount(p) {
  return Object.values(p.hand).reduce((a, b) => a + b, 0);
}

function addCard(p, c) {
  if (!c) return;
  p.hand[c] = (p.hand[c] || 0) + 1;
}

function drawFromDeck(s) {
  if (s.deck.length === 0 && s.discard.length) {
    s.deck = shuffle(s.discard);
    s.discard = [];
  }
  return s.deck.length ? s.deck.pop() : null;
}

export function deckAvailable(s) {
  return s.deck.length + s.discard.length > 0;
}

function refillFaceUp(s) {
  let guard = 0;
  while (true) {
    for (let i = 0; i < 5; i++) if (!s.faceUp[i]) s.faceUp[i] = drawFromDeck(s);
    const locos = s.faceUp.filter(c => c === LOCO).length;
    // Three locomotives face-up: discard all five and deal a fresh display.
    const nonLocoLeft = [...s.deck, ...s.discard].filter(c => c !== LOCO).length;
    if (locos >= 3 && guard < 5 && nonLocoLeft >= 3) {
      s.discard.push(...s.faceUp.filter(Boolean));
      s.faceUp = [null, null, null, null, null];
      guard++;
      continue;
    }
    break;
  }
}

function log(s, text, extra = {}) {
  s.log.push({ turn: s.turn, p: s.cur, text, ...extra });
  if (s.log.length > 300) s.log.shift();
}

export function current(s) { return s.players[s.cur]; }

// ---------- setup: initial tickets ----------
export function keepSetupTickets(s, pi, keepIds) {
  const p = s.players[pi];
  if (!p.pending) return err('No tickets to choose');
  if (keepIds.length < 2) return err('Keep at least 2 tickets');
  const { TICKETS } = M(s);
  // Unkept long tickets leave the game; regular ones go to the bottom of the deck.
  const ret = p.pending.filter(id => !keepIds.includes(id) && !TICKETS[id].long);
  p.tickets.push(...keepIds);
  s.ticketDeck.push(...ret);
  p.pending = null;
  if (s.players.every(q => !q.pending)) {
    s.phase = 'play';
    log(s, `Game started — ${current(s).name} goes first`, { sys: true });
  }
  return ok([{ type: 'tickets', n: keepIds.length, player: pi }]);
}

// ---------- card drawing ----------
export function canTakeFaceUp(s, i) {
  if (s.phase !== 'play' || s.over) return false;
  const c = s.faceUp[i];
  if (!c) return false;
  if (s.drawn === 1 && c === LOCO) return false;
  return true;
}

export function canDrawDeck(s) {
  return s.phase === 'play' && !s.over && deckAvailable(s);
}

export function mustEndTurnManually(s) {
  if (s.drawn !== 1) return false;
  return !canDrawDeck(s) && ![0, 1, 2, 3, 4].some(i => canTakeFaceUp(s, i));
}

export function takeFaceUp(s, i) {
  if (!canTakeFaceUp(s, i)) return err("You can't take that card");
  const p = current(s);
  const c = s.faceUp[i];
  s.faceUp[i] = null;
  addCard(p, c);
  refillFaceUp(s);
  log(s, `took a ${COLOR_LABEL[c].toLowerCase()} card from the display`, { kind: 'card', color: c });
  const events = [{ type: 'card', color: c, from: 'face', index: i, player: s.cur }];
  if (c === LOCO || s.drawn === 1) return endTurn(s, events);
  s.drawn = 1;
  if (mustEndTurnManually(s)) return endTurn(s, events);
  return ok(events);
}

export function takeDeck(s) {
  if (!canDrawDeck(s)) return err('The deck is empty');
  const p = current(s);
  const c = drawFromDeck(s);
  addCard(p, c);
  log(s, 'drew a card from the deck', { kind: 'card' });
  const events = [{ type: 'card', color: c, from: 'deck', private: true, player: s.cur }];
  if (s.drawn === 1) return endTurn(s, events);
  s.drawn = 1;
  if (mustEndTurnManually(s)) return endTurn(s, events);
  return ok(events);
}

export function forceEndTurn(s) {
  if (!mustEndTurnManually(s)) return err('You still have a draw');
  return endTurn(s, []);
}

// ---------- payments ----------
// Ways to pay `len` cards of `color` ('gray' = any one colour) with at least `minLocos` locomotives.
function payOptions(hand, len, color, minLocos = 0) {
  const locos = hand[LOCO] || 0;
  const opts = [];
  if (locos < minLocos) return opts;
  const colors = color === 'gray' ? COLORS : [color];
  for (const c of colors) {
    const have = hand[c] || 0;
    if (have === 0 || len - minLocos <= 0) continue;
    const colored = Math.min(have, len - minLocos);
    const needL = len - colored;
    if (needL <= locos) opts.push({ color: c, colored, locos: needL });
  }
  if (locos >= len) opts.push({ color: LOCO, colored: 0, locos: len });
  opts.sort((a, b) => a.locos - b.locos || (hand[b.color] || 0) - (hand[a.color] || 0));
  return opts;
}

function pay(s, p, color, colored, locos) {
  if (colored) { p.hand[color] -= colored; for (let i = 0; i < colored; i++) s.discard.push(color); }
  if (locos) { p.hand[LOCO] -= locos; for (let i = 0; i < locos; i++) s.discard.push(LOCO); }
  for (const k of Object.keys(p.hand)) if (!p.hand[k]) delete p.hand[k];
}

export const isTunnel = (s, r) => !!(r.tunnel && s.opts.tunnels);
export const ferryLocos = (s, r) => (s.opts.ferries && r.ferry) || 0;

// ---------- routes ----------
export function routeStatus(s, pi, rid) {
  const r = M(s).ROUTES[rid];
  if (s.claimed[rid] !== undefined) return { ok: false, reason: 'taken', by: s.claimed[rid] };
  if (r.pair !== null && s.claimed[r.pair] !== undefined) {
    if (s.claimed[r.pair] === pi) return { ok: false, reason: 'ownpair' };
    if (s.opts.doubleClosed) return { ok: false, reason: 'closed' };
  }
  const p = s.players[pi];
  if (p.trains < r.len) return { ok: false, reason: 'trains' };
  if (paymentOptions(s, pi, rid).length === 0) return { ok: false, reason: 'cards' };
  return { ok: true };
}

export function routeOpenFor(s, pi, rid) {
  const r = M(s).ROUTES[rid];
  if (s.claimed[rid] !== undefined) return false;
  if (r.pair !== null && s.claimed[r.pair] !== undefined) {
    if (s.claimed[r.pair] === pi) return false;
    if (s.opts.doubleClosed) return false;
  }
  return true;
}

export function paymentOptions(s, pi, rid) {
  const r = M(s).ROUTES[rid];
  return payOptions(s.players[pi].hand, r.len, r.color, ferryLocos(s, r));
}

function finishClaim(s, rid, color, colored, locos, events) {
  const { ROUTES, CITY } = M(s);
  const r = ROUTES[rid];
  const p = current(s);
  pay(s, p, color, colored, locos);
  s.claimed[rid] = s.cur;
  p.routes.push(rid);
  p.trains -= r.len;
  const pts = ROUTE_POINTS[r.len];
  p.routePts += pts;
  log(s, `claimed ${CITY[r.a].name} – ${CITY[r.b].name} (+${pts})`, { kind: 'route', rid });
  refillFaceUp(s);
  events.push({ type: 'route', rid, pts, player: s.cur });
  return endTurn(s, events);
}

export function claimRoute(s, rid, choice) {
  if (s.phase !== 'play' || s.over) return err('Not now');
  if (s.drawn) return err('Finish drawing your second card');
  const st = routeStatus(s, s.cur, rid);
  if (!st.ok) return err('You cannot claim this route');
  const valid = paymentOptions(s, s.cur, rid).find(o => o.color === choice.color && o.locos === choice.locos);
  if (!valid) return err('Invalid payment');
  const r = M(s).ROUTES[rid];
  if (!isTunnel(s, r)) return finishClaim(s, rid, valid.color, valid.colored, valid.locos, []);
  // Tunnel: reveal 3 cards; each matching the colour played (or a locomotive) costs one more card.
  const revealed = [];
  for (let i = 0; i < 3; i++) { const c = drawFromDeck(s); if (c) revealed.push(c); }
  const extra = revealed.filter(c => c === LOCO || (valid.color !== LOCO && c === valid.color)).length;
  const events = [{ type: 'tunnelReveal', rid, revealed, extra, player: s.cur }];
  if (extra === 0) {
    s.discard.push(...revealed);
    return finishClaim(s, rid, valid.color, valid.colored, valid.locos, events);
  }
  s.tunnel = { rid, pay: valid, revealed, extra };
  s.phase = 'tunnel';
  return ok(events);
}

export function tunnelOptions(s) {
  const t = s.tunnel;
  if (!t) return [];
  const h = current(s).hand;
  const availC = t.pay.color === LOCO ? 0 : (h[t.pay.color] || 0) - t.pay.colored;
  const availL = (h[LOCO] || 0) - t.pay.locos;
  const opts = [];
  const colored = Math.min(availC, t.extra);
  if (colored + availL >= t.extra) opts.push({ colored, locos: t.extra - colored });
  if (colored > 0 && availL >= t.extra) opts.push({ colored: 0, locos: t.extra });
  return opts;
}

export function tunnelPay(s, k) {
  if (s.phase !== 'tunnel' || !s.tunnel) return err('No tunnel to pay for');
  const o = tunnelOptions(s)[k];
  if (!o) return err('Not enough cards');
  const t = s.tunnel;
  s.discard.push(...t.revealed);
  s.tunnel = null;
  s.phase = 'play';
  return finishClaim(s, t.rid, t.pay.color, t.pay.colored + o.colored, t.pay.locos + o.locos,
    [{ type: 'tunnelPaid', extra: t.extra }]);
}

export function tunnelGiveUp(s) {
  if (s.phase !== 'tunnel' || !s.tunnel) return err('No tunnel');
  const { ROUTES, CITY } = M(s);
  const t = s.tunnel;
  const r = ROUTES[t.rid];
  s.discard.push(...t.revealed);
  s.tunnel = null;
  s.phase = 'play';
  log(s, `couldn’t dig the ${CITY[r.a].name} – ${CITY[r.b].name} tunnel`, { kind: 'tunnelFail', rid: t.rid });
  return endTurn(s, [{ type: 'tunnelFail', rid: t.rid }]);
}

// ---------- stations ----------
export function stationCost(p) { return STATIONS - p.stations + 1; }

export function stationOptions(s, pi) {
  const p = s.players[pi];
  if (!s.opts.stations || p.stations <= 0) return [];
  return payOptions(p.hand, stationCost(p), 'gray');
}

export function stationStatus(s, pi, cityId) {
  if (!s.opts.stations) return { ok: false, reason: 'off' };
  if (s.stationAt[cityId] !== undefined) return { ok: false, reason: 'taken', by: s.stationAt[cityId] };
  const p = s.players[pi];
  if (p.stations <= 0) return { ok: false, reason: 'none' };
  if (!stationOptions(s, pi).length) return { ok: false, reason: 'cards' };
  return { ok: true };
}

export function buildStation(s, cityId, choice) {
  if (s.phase !== 'play' || s.over) return err('Not now');
  if (s.drawn) return err('Finish drawing your second card');
  if (!stationStatus(s, s.cur, cityId).ok) return err('You cannot build a station here');
  const valid = stationOptions(s, s.cur).find(o => o.color === choice.color && o.locos === choice.locos);
  if (!valid) return err('Invalid payment');
  const p = current(s);
  pay(s, p, valid.color, valid.colored, valid.locos);
  p.stations--;
  s.stationAt[cityId] = s.cur;
  log(s, `built a station in ${M(s).CITY[cityId].name}`, { kind: 'station', city: cityId });
  refillFaceUp(s);
  return endTurn(s, [{ type: 'station', city: cityId, player: s.cur }]);
}

// ---------- destination tickets ----------
export function canDrawTickets(s) {
  return s.phase === 'play' && !s.over && s.drawn === 0 && s.ticketDeck.length > 0;
}

export function drawTickets(s) {
  if (!canDrawTickets(s)) return err('No tickets left');
  const p = current(s);
  p.pending = s.ticketDeck.splice(0, 3);
  s.phase = 'tickets';
  return ok([{ type: 'ticketDraw' }]);
}

export function keepTickets(s, keepIds) {
  const p = current(s);
  if (s.phase !== 'tickets' || !p.pending) return err('No tickets to choose');
  if (keepIds.length < 1) return err('Keep at least 1 ticket');
  const ret = p.pending.filter(id => !keepIds.includes(id));
  p.tickets.push(...keepIds);
  s.ticketDeck.push(...ret);
  p.pending = null;
  s.phase = 'play';
  log(s, `drew destination tickets and kept ${keepIds.length}`, { kind: 'tickets' });
  return endTurn(s, [{ type: 'tickets', n: keepIds.length, player: s.cur }]);
}

// ---------- turn flow ----------
function endTurn(s, events) {
  const p = current(s);
  s.drawn = 0;
  if (s.finalTurns !== null) {
    s.finalTurns--;
    if (s.finalTurns <= 0) {
      s.over = true;
      s.phase = 'over';
      log(s, 'Game over', { sys: true });
      events.push({ type: 'gameOver' });
      return ok(events);
    }
  } else if (p.trains <= 2) {
    s.finalTurns = s.players.length;
    log(s, `has ${p.trains} train${p.trains === 1 ? '' : 's'} left — final round! Everyone gets one more turn`, { sys: true, final: true });
    events.push({ type: 'finalRound', player: s.cur });
  }
  s.cur = (s.cur + 1) % s.players.length;
  s.turn++;
  events.push({ type: 'turnEnd' });
  return ok(events);
}

// ---------- graph helpers ----------
function adjFrom(s, rids) {
  const { ROUTES } = M(s);
  const adj = {};
  for (const rid of rids) {
    const r = ROUTES[rid];
    (adj[r.a] ||= []).push({ to: r.b, rid });
    (adj[r.b] ||= []).push({ to: r.a, rid });
  }
  return adj;
}

function connected(adj, a, b) {
  const seen = new Set([a]);
  const q = [a];
  while (q.length) {
    const u = q.shift();
    if (u === b) return true;
    for (const e of adj[u] || []) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
  }
  return false;
}

// Best use of stations: each may borrow one opponent route touching its city.
// Returns completed tickets and which routes were borrowed.
const ticketCache = new Map();
export function ticketResult(s, pi) {
  const p = s.players[pi];
  const myStations = Object.keys(s.stationAt).filter(c => s.stationAt[c] === pi);
  const key = `${s.id}|${pi}|${s.turn}|${Object.keys(s.claimed).length}|${myStations.join(',')}|${p.tickets.join(',')}`;
  if (ticketCache.has(key)) return ticketCache.get(key);
  const { ROUTES, TICKETS } = M(s);
  const choices = myStations.map(c => [null, ...ROUTES
    .filter(r => (r.a === c || r.b === c) && s.claimed[r.id] !== undefined && s.claimed[r.id] !== pi)
    .map(r => r.id)]);
  let best = null;
  const evalCombo = borrowed => {
    const adj = adjFrom(s, [...p.routes, ...borrowed.filter(x => x !== null)]);
    const done = p.tickets.filter(t => connected(adj, TICKETS[t].a, TICKETS[t].b));
    const score = done.reduce((a, t) => a + 2 * TICKETS[t].pts, 0);
    if (!best || score > best.score) best = { score, done, borrowed: borrowed.filter(x => x !== null) };
  };
  const rec = (k, acc) => {
    if (k === choices.length) return evalCombo(acc);
    for (const c of choices[k]) rec(k + 1, [...acc, c]);
  };
  rec(0, []);
  const res = { done: best.done, failed: p.tickets.filter(t => !best.done.includes(t)), borrowed: best.borrowed };
  if (ticketCache.size > 200) ticketCache.clear();
  ticketCache.set(key, res);
  return res;
}

export function ticketDone(s, pi, tid) {
  return ticketResult(s, pi).done.includes(tid);
}

export function longestPath(s, pi) {
  const { ROUTES } = M(s);
  const adj = adjFrom(s, s.players[pi].routes);
  const used = new Set();
  let best = 0;
  function dfs(u, len) {
    if (len > best) best = len;
    for (const e of adj[u] || []) {
      if (used.has(e.rid)) continue;
      used.add(e.rid);
      dfs(e.to, len + ROUTES[e.rid].len);
      used.delete(e.rid);
    }
  }
  for (const c of Object.keys(adj)) dfs(c, 0);
  return best;
}

// Cheapest way to finish a ticket: own routes cost 0, open routes cost their length.
export function ticketPlan(s, pi, tid) {
  const { ROUTES, TICKETS } = M(s);
  const t = TICKETS[tid];
  const dist = { [t.a]: 0 };
  const prev = {};
  const done = new Set();
  const pq = [[0, t.a]];
  while (pq.length) {
    pq.sort((x, y) => x[0] - y[0]);
    const [d, u] = pq.shift();
    if (done.has(u)) continue;
    done.add(u);
    if (u === t.b) break;
    for (const r of ROUTES) {
      if (r.a !== u && r.b !== u) continue;
      const v = r.a === u ? r.b : r.a;
      let w;
      if (s.claimed[r.id] === pi) w = 0;
      else if (routeOpenFor(s, pi, r.id)) w = r.len;
      else continue;
      if (d + w < (dist[v] ?? Infinity)) {
        dist[v] = d + w;
        prev[v] = r.id;
        pq.push([dist[v], v]);
      }
    }
  }
  if (dist[t.b] === undefined) return null;
  const routes = [];
  let c = t.b;
  while (c !== t.a) {
    const rid = prev[c];
    routes.push(rid);
    const r = ROUTES[rid];
    c = r.a === c ? r.b : r.a;
  }
  return { cost: dist[t.b], routes: routes.reverse() };
}

export function finalScores(s) {
  const { TICKETS } = M(s);
  const longest = s.players.map((_, i) => longestPath(s, i));
  const maxL = Math.max(...longest);
  const res = s.players.map((p, i) => {
    const { done, failed, borrowed } = ticketResult(s, i);
    const plus = done.reduce((a, t) => a + TICKETS[t].pts, 0);
    const minus = failed.reduce((a, t) => a + TICKETS[t].pts, 0);
    const bonus = maxL > 0 && longest[i] === maxL ? LONGEST_BONUS : 0;
    const stationPts = s.opts.stations ? p.stations * STATION_PTS : 0;
    return {
      i, name: p.name, color: p.color, routePts: p.routePts, done, failed, plus, minus, borrowed,
      stationsLeft: p.stations, stationPts,
      longest: longest[i], bonus, total: p.routePts + plus - minus + bonus + stationPts,
    };
  });
  const ranked = [...res].sort((a, b) =>
    b.total - a.total || b.done.length - a.done.length || b.bonus - a.bonus);
  ranked.forEach((r, k) => {
    const prev = ranked[k - 1];
    r.rank = prev && prev.total === r.total && prev.done.length === r.done.length && prev.bonus === r.bonus
      ? prev.rank : k + 1;
  });
  return { players: res, ranked };
}

// Upgrade a game saved by v1.0
export function migrate(s) {
  if (!s) return s;
  s.map ||= 'usa';
  s.opts = { ...normOpts(s.map, s.players.length, s.opts), doubleClosed: s.opts?.doubleClosed ?? s.players.length <= 3 };
  s.stationAt ||= {};
  s.tunnel ??= null;
  for (const p of s.players) { p.stations ??= 0; p.uid ??= null; }
  s.v = 2;
  return s;
}

function ok(events = []) { return { ok: true, events }; }
function err(error) { return { ok: false, error, events: [] }; }
