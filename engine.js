// Coast to Coast — rules engine (pure game logic, no DOM)
import { MAP } from './data.js';

export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white'];
export const LOCO = 'loco';
export const ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };
export const START_TRAINS = 45;
export const LONGEST_BONUS = 10;

export const CITY = Object.fromEntries(MAP.cities.map(c => [c.id, c]));
export const ROUTES = MAP.routes;
export const TICKETS = MAP.tickets;

export const COLOR_LABEL = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue',
  purple: 'Purple', black: 'Black', white: 'White', gray: 'Gray', loco: 'Locomotive',
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function newGame(players, opts = {}) {
  const deck = [];
  for (const c of COLORS) for (let i = 0; i < 12; i++) deck.push(c);
  for (let i = 0; i < 14; i++) deck.push(LOCO);
  shuffle(deck);
  const ticketDeck = shuffle(TICKETS.map(t => t.id));
  const s = {
    v: 1,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: Date.now(),
    opts: { doubleClosed: opts.doubleClosed ?? players.length <= 3 },
    players: players.map(p => ({
      name: p.name, color: p.color, hand: {}, tickets: [], pending: null,
      trains: START_TRAINS, routePts: 0, routes: [],
    })),
    deck, discard: [], faceUp: [null, null, null, null, null],
    ticketDeck, claimed: {},
    cur: 0, phase: 'setup', drawn: 0, finalTurns: null, turn: 1,
    log: [], over: false,
  };
  for (const p of s.players) {
    for (let i = 0; i < 4; i++) addCard(p, drawFromDeck(s));
    p.pending = s.ticketDeck.splice(0, 3);
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
    // Stop trying if the remaining cards can't produce a legal display.
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
  const ret = p.pending.filter(id => !keepIds.includes(id));
  p.tickets.push(...keepIds);
  s.ticketDeck.push(...ret);
  p.pending = null;
  if (s.players.every(q => !q.pending)) {
    s.phase = 'play';
    log(s, `Game started — ${current(s).name} goes first`, { sys: true });
  }
  return ok([{ type: 'tickets', n: keepIds.length }]);
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
  // Second draw is required but no legal draw is possible.
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
  const events = [{ type: 'card', color: c, from: 'face', index: i }];
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
  const events = [{ type: 'card', color: c, from: 'deck', private: true }];
  if (s.drawn === 1) return endTurn(s, events);
  s.drawn = 1;
  if (mustEndTurnManually(s)) return endTurn(s, events);
  return ok(events);
}

export function forceEndTurn(s) {
  if (!mustEndTurnManually(s)) return err('You still have a draw');
  return endTurn(s, []);
}

// ---------- routes ----------
export function routeStatus(s, pi, rid) {
  const r = ROUTES[rid];
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
  // Could this player ever claim it (ignoring cards/trains)?
  const r = ROUTES[rid];
  if (s.claimed[rid] !== undefined) return false;
  if (r.pair !== null && s.claimed[r.pair] !== undefined) {
    if (s.claimed[r.pair] === pi) return false;
    if (s.opts.doubleClosed) return false;
  }
  return true;
}

export function paymentOptions(s, pi, rid) {
  const r = ROUTES[rid];
  const p = s.players[pi];
  const locos = p.hand[LOCO] || 0;
  const opts = [];
  const colors = r.color === 'gray' ? COLORS : [r.color];
  for (const c of colors) {
    const have = p.hand[c] || 0;
    if (have === 0) continue;
    const colored = Math.min(have, r.len);
    const needL = r.len - colored;
    if (needL <= locos) opts.push({ color: c, colored, locos: needL });
  }
  if (locos >= r.len) opts.push({ color: LOCO, colored: 0, locos: r.len });
  // Prefer options using fewer locomotives, then the colour you hold most of
  opts.sort((a, b) => a.locos - b.locos || (p.hand[b.color] || 0) - (p.hand[a.color] || 0));
  return opts;
}

export function claimRoute(s, rid, pay) {
  if (s.phase !== 'play' || s.over) return err('Not now');
  if (s.drawn) return err('Finish drawing your second card');
  const st = routeStatus(s, s.cur, rid);
  if (!st.ok) return err('You cannot claim this route');
  const valid = paymentOptions(s, s.cur, rid).find(o => o.color === pay.color && o.locos === pay.locos);
  if (!valid) return err('Invalid payment');
  const r = ROUTES[rid];
  const p = current(s);
  if (valid.colored) {
    p.hand[valid.color] -= valid.colored;
    for (let i = 0; i < valid.colored; i++) s.discard.push(valid.color);
  }
  if (valid.locos) {
    p.hand[LOCO] -= valid.locos;
    for (let i = 0; i < valid.locos; i++) s.discard.push(LOCO);
  }
  for (const k of Object.keys(p.hand)) if (!p.hand[k]) delete p.hand[k];
  s.claimed[rid] = s.cur;
  p.routes.push(rid);
  p.trains -= r.len;
  const pts = ROUTE_POINTS[r.len];
  p.routePts += pts;
  log(s, `claimed ${CITY[r.a].name} – ${CITY[r.b].name} (+${pts})`, { kind: 'route', rid });
  // Refill the display if it ran dry earlier
  refillFaceUp(s);
  return endTurn(s, [{ type: 'route', rid, pts, player: s.cur }]);
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
  s.ticketDeck.push(...ret); // returned to the bottom
  p.pending = null;
  s.phase = 'play';
  log(s, `drew destination tickets and kept ${keepIds.length}`, { kind: 'tickets' });
  return endTurn(s, [{ type: 'tickets', n: keepIds.length }]);
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
function ownedAdj(s, pi) {
  const adj = {};
  for (const rid of s.players[pi].routes) {
    const r = ROUTES[rid];
    (adj[r.a] ||= []).push({ to: r.b, rid });
    (adj[r.b] ||= []).push({ to: r.a, rid });
  }
  return adj;
}

export function ticketDone(s, pi, tid) {
  const t = TICKETS[tid];
  const adj = ownedAdj(s, pi);
  const seen = new Set([t.a]);
  const q = [t.a];
  while (q.length) {
    const u = q.shift();
    if (u === t.b) return true;
    for (const e of adj[u] || []) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
  }
  return false;
}

export function longestPath(s, pi) {
  const adj = ownedAdj(s, pi);
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
  const longest = s.players.map((_, i) => longestPath(s, i));
  const maxL = Math.max(...longest);
  const res = s.players.map((p, i) => {
    const done = [], failed = [];
    for (const tid of p.tickets) (ticketDone(s, i, tid) ? done : failed).push(tid);
    const plus = done.reduce((a, t) => a + TICKETS[t].pts, 0);
    const minus = failed.reduce((a, t) => a + TICKETS[t].pts, 0);
    const bonus = maxL > 0 && longest[i] === maxL ? LONGEST_BONUS : 0;
    return {
      i, name: p.name, color: p.color, routePts: p.routePts, done, failed, plus, minus,
      longest: longest[i], bonus, total: p.routePts + plus - minus + bonus,
    };
  });
  // Ties: most completed tickets, then longest-route holder
  const ranked = [...res].sort((a, b) =>
    b.total - a.total || b.done.length - a.done.length || b.bonus - a.bonus);
  ranked.forEach((r, k) => {
    const prev = ranked[k - 1];
    r.rank = prev && prev.total === r.total && prev.done.length === r.done.length && prev.bonus === r.bonus
      ? prev.rank : k + 1;
  });
  return { players: res, ranked };
}

function ok(events = []) { return { ok: true, events }; }
function err(error) { return { ok: false, error, events: [] }; }
