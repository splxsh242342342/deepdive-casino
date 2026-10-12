import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const PROD = process.env.NODE_ENV === 'production';

/* The same rules file the page loads, so solo and live games can't drift apart. */
const E = new Function(fs.readFileSync(path.join(PUB, 'engine.js'), 'utf8') +
  '\nreturn {pkNew,pkSeat,pkStart,pkAct,pkNext,pkEligible,botMove,bjNew,bjSeat,bjDeal,bjTick,bjAct,bjInsTimeout,bjNewRound,BOTS,BB,BUY,PK_MIN,PK_MAX,BJ_BET,rid};')();

/* public/index.html is written as page content (it also publishes as a Claude artifact), so the server adds the document shell. */
const SITE = process.env.SITE_URL || 'https://casino.ardanstudio.ie';
const SHELL = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#020814">' +
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">' +
  `<meta property="og:type" content="website"><meta property="og:site_name" content="Deepdive Casino"><meta property="og:title" content="Deepdive Casino"><meta property="og:description" content="Blackjack and Texas Hold'em in the deep. Play friends live, no sign-up."><meta property="og:url" content="${SITE}/"><meta property="og:image" content="${SITE}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">` +
  '<style>:root{padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}</style></head><body>';
let page = '', privacy = '';
const loadPage = () => {
  page = SHELL + fs.readFileSync(path.join(PUB, 'index.html'), 'utf8') + '</body></html>';
  privacy = SHELL + fs.readFileSync(path.join(PUB, 'privacy.html'), 'utf8') + '</body></html>';
};
loadPage();

const app = express();
app.disable('x-powered-by');
app.get(['/', '/index.html'], (_, res) => { if (!PROD) loadPage(); res.set('Cache-Control', 'no-cache').type('html').send(page); });
app.get(['/privacy', '/privacy.html'], (_, res) => { if (!PROD) loadPage(); res.set('Cache-Control', 'no-cache').type('html').send(privacy); });
app.get('/api/health', (_, res) => res.json({ ok: true, tables: tables.size, players: clients.size }));
app.use(express.static(PUB, { index: false, setHeaders: r => r.set('Cache-Control', 'no-cache') }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
const clients = new Set(), tables = new Map();
/* Poker chips that couldn't be handed back because the player had gone; delivered when that browser reconnects. */
const pending = new Map();

const clean = s => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) || 'Diver';
const num = v => { v = Math.floor(+v); return Number.isFinite(v) && v > 0 ? Math.min(v, 1e9) : 0; };
const CODE_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => { for (;;) { const c = Array.from({ length: 4 }, () => CODE_CH[Math.random() * CODE_CH.length | 0]).join(''); if (!tables.has(c)) return c; } };
const send = (c, o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); };
const MAX_TABLES = 300, MAX_MEMBERS = 20;

/* At most 12 open connections from one address, so one person can't flood the server. */
const perIp = new Map(), MAX_PER_IP = 12;
wss.on('connection', (ws, req) => {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  if ((perIp.get(ip) || 0) >= MAX_PER_IP) return ws.close(1008, 'too many connections');
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  const c = { ws, cid: '', wid: '', nm: 'Diver', bal: 0, tb: null, sit: false, bet: 0, rd: null, back: null, alive: true, n: 0, win: Date.now() };
  clients.add(c);
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', raw => {
    const now = Date.now(); if (now - c.win > 1000) { c.win = now; c.n = 0; } if (++c.n > 25) return; // drop floods
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    try { handle(c, m); } catch (e) { console.error('message failed:', e); }
  });
  ws.on('close', () => { clients.delete(c); leave(c); lobbySoon(); const n = (perIp.get(ip) || 1) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip); });
  ws.on('error', () => {});
});
setInterval(() => { for (const c of clients) { if (!c.alive) { c.ws.terminate(); continue; } c.alive = false; try { c.ws.ping(); } catch {} } }, 25000);

function handle(c, m) {
  const tb = c.tb && tables.get(c.tb);
  switch (m.t) {
    case 'hello':
      c.cid = typeof m.cid === 'string' && /^[a-z0-9]{6,32}$/.test(m.cid) ? m.cid : 'd' + E.rid() + E.rid();
      for (const o of clients) if (o !== c && o.cid === c.cid) o.ws.close(4000, 'opened elsewhere');
      c.wid = typeof m.wid === 'string' && /^[a-z0-9]{6,32}$/.test(m.wid) ? m.wid : c.cid;
      c.nm = clean(m.nm); c.bal = num(m.bal);
      for (const p of pending.get(c.wid) || []) send(c, p);
      pending.delete(c.wid);
      send(c, { t: 'lobby', tables: lobbyList() });
      break;
    case 'nm': c.nm = clean(m.nm); if (tb) sync(tb); lobbySoon(); break;
    case 'bal': c.bal = num(m.bal); if (tb) sync(tb); break;
    case 'create': {
      if (m.g !== 'pk' && m.g !== 'bj') return;
      if (tables.size >= MAX_TABLES) return send(c, { t: 'err', m: 'Too many tables are open right now. Join one from the list.' });
      const code = newCode(), t = { code, g: m.g, S: m.g === 'pk' ? E.pkNew(6, true) : E.bjNew(5, true), members: new Set(), timer: 0 };
      tables.set(code, t); c.sit = m.g === 'bj'; join(c, t); break;
    }
    case 'join': {
      const t = tables.get(String(m.code || '').toUpperCase());
      if (!t) return send(c, { t: 'nojoin', code: String(m.code || '').slice(0, 4), auto: !!m.auto });
      c.sit = !!m.sit && t.g === 'bj'; join(c, t, !!m.auto); break;
    }
    case 'leave': leave(c); send(c, { t: 'left' }); lobbySoon(); break;
    case 'sit': if (!tb) return; if (m.on && tb.g === 'pk') return; c.sit = !!m.on; if (m.on) c.bal = num(m.bal); c.rd = null; sync(tb); lobbySoon(); break;
    case 'buy': if (tb && tb.g === 'pk') buyIn(c, tb, num(m.amt), num(m.bal)); break;
    case 'bet': if (!tb) return; c.bet = num(m.amt); sync(tb); break;
    case 'ready': if (!tb) return; c.rd = typeof m.h === 'string' ? m.h.slice(0, 12) : null; sync(tb); break;
    case 'back': if (!tb) return; c.back = String(m.h || '').slice(0, 12); sync(tb); break;
    case 'act': if (tb) action(c, tb, m); break;
    case 'bot': if (tb) bots(c, tb, !!m.add); break;
    case 'react': { /* preset phrases only, at most one every 1.5 seconds */
      if (!tb) return; const k = Math.floor(+m.k), now = Date.now(); if (!(k >= 0 && k < 6) || now - (c.reactAt || 0) < 1500) return;
      const j = tb.S.seats.findIndex(p => p && p.c === c.cid); if (j < 0) return; c.reactAt = now;
      for (const o of tb.members) send(o, { t: 'react', code: tb.code, j, k }); break;
    }
  }
}

function join(c, t, auto) {
  if (c.tb && c.tb !== t.code) leave(c);
  if (!t.members.has(c) && t.members.size >= MAX_MEMBERS) return send(c, { t: 'err', m: 'That table is full.' });
  c.tb = t.code; c.bet = 0; c.rd = null; c.back = null; t.members.add(c); t.empty = 0;
  send(c, { t: 'joined', code: t.code, g: t.g, sit: c.sit, auto: !!auto });
  sync(t, true); lobbySoon();
}
function leave(c) {
  const t = c.tb && tables.get(c.tb); c.tb = null; c.sit = false; c.rd = null;
  if (!t) return;
  t.members.delete(c); sync(t, true);
  if (!t.members.size) { t.empty = Date.now(); setTimeout(() => { if (!t.members.size && tables.get(t.code) === t) { clearTimeout(t.timer); tables.delete(t.code); lobbySoon(); } }, 90000); }
}

/* Apply what each member wants (seat, name, bet, ready) to the table, then publish if anything changed. */
function sync(t, force) {
  const S = t.S, now = Date.now(), before = JSON.stringify(S);
  const pm = new Map(); for (const c of t.members) pm.set(c.cid, c);
  const busy = p => S.g === 'pk' ? (p.in && (S.ph === 'bet' || S.ph === 'run')) : (p.in && (S.ph === 'deal' || S.ph === 'play' || S.ph === 'dealer'));
  for (const c of t.members) {
    const i = S.seats.findIndex(p => p && p.c === c.cid);
    if (c.sit && i < 0 && S.g === 'bj') { const j = S.seats.indexOf(null); if (j >= 0) S.seats[j] = E.bjSeat(c.cid, c.nm, c.bal); else c.sit = false; }
    else if (i >= 0) { const p = S.seats[i]; p.n = c.nm; p.lv = c.sit ? 0 : 1; if (p.out && c.back && c.back === p.oh) { p.out = 0; p.mt = 0; } }
  }
  S.seats.forEach((p, i) => {
    if (!p || p.bot >= 0) return; p.gone = pm.has(p.c) ? 0 : 1;
    const broke = S.g === 'pk' && p.s < E.BB && !busy(p) && !(S.ph === 'end' && p.in);
    if ((p.lv || p.gone || broke) && !busy(p)) { if (S.g === 'pk') cashOut(t, p, pm.get(p.c)); S.seats[i] = null; }
  });
  if (S.g === 'bj') S.seats.forEach(p => { if (!p || busy(p) || (S.ph === 'end' && p.in)) return; const c = pm.get(p.c); if (c) p.s = c.bal; });
  if (S.g === 'bj' && S.ph === 'bet') {
    const act = [];
    for (const p of S.seats) { if (!p) continue; const c = pm.get(p.c); if (c) { p.bet = Math.min(p.s, c.bet); p.rd = c.rd === S.h && p.bet > 0 ? 1 : 0; } if (!p.lv && !p.gone) act.push(p); }
    if (act.some(p => p.rd)) { if (!S.dl) S.dl = now + E.BJ_BET; if (act.every(p => p.rd)) E.bjDeal(S); } else S.dl = 0;
  }
  if (S.g === 'pk' && S.ph === 'bet') { for (let g = 0; g < 8 && S.ph === 'bet'; g++) { const p = S.seats[S.to]; if (p && p.bot < 0 && p.lv) E.pkAct(S, S.to, 'f'); else break; } }
  if (S.g === 'bj' && S.ph === 'ins') for (const p of S.seats) if (p && p.in && p.ins < 0 && (p.lv || p.gone)) E.bjAct(S, S.seats.indexOf(p), 'n');
  if (S.g === 'bj' && S.ph === 'play') { for (let g = 0; g < 12 && S.ph === 'play'; g++) { const p = S.seats[S.to]; if (p && p.lv) E.bjAct(S, S.to, 's'); else break; } }
  if (force || JSON.stringify(S) !== before) commit(t); else drive(t);
}
function action(c, t, m) {
  const S = t.S, i = S.seats.findIndex(p => p && p.c === c.cid);
  if (i < 0 || m.tk !== S.tk || !['f', 'x', 'c', 'r', 'h', 's', 'd', 'p', 'u', 'i', 'n'].includes(m.k)) return;
  const ok = S.g === 'pk' ? E.pkAct(S, i, m.k, num(m.a)) : E.bjAct(S, i, m.k);
  if (ok) { S.seats[i].mt = 0; commit(t); }
}
function bots(c, t, add) {
  const S = t.S; if (S.g !== 'pk' || !S.seats.some(p => p && p.c === c.cid)) return;
  if (add) {
    const j = S.seats.indexOf(null); if (j < 0) return;
    const used = new Set(S.seats.filter(p => p && p.bot >= 0).map(p => p.bot)), k = [0, 1, 2, 3, 4].find(x => !used.has(x));
    if (k == null) return; S.seats[j] = E.pkSeat('bot:' + k, E.BOTS[k].n, k, E.BUY);
  } else {
    let j = S.seats.length - 1;
    for (; j >= 0; j--) { const p = S.seats[j]; if (p && p.bot >= 0 && !(p.in && (S.ph === 'bet' || S.ph === 'run'))) break; }
    if (j < 0) return send(c, { t: 'err', m: 'Bots in the current hand leave after it ends.' });
    S.seats[j] = null;
  }
  commit(t); lobbySoon();
}

/* Poker buy-in: 400 to 2,000 to sit down, or top up between hands to at most 2,000 on the table. */
function buyIn(c, t, amt, bal) {
  const S = t.S; c.bal = bal || c.bal;
  let i = S.seats.findIndex(p => p && p.c === c.cid);
  const p = i >= 0 ? S.seats[i] : null;
  if (p && p.in && (S.ph === 'bet' || S.ph === 'run')) return send(c, { t: 'err', m: 'You can add chips between hands.' });
  const have = p ? p.s : 0, min = p ? 1 : E.PK_MIN, max = E.PK_MAX - have;
  if (amt < min || amt > max || amt > c.bal) return send(c, { t: 'err', m: p ? `You can have at most ${E.PK_MAX.toLocaleString('en-US')} on the table.` : `Buy in for ${E.PK_MIN} to ${E.PK_MAX.toLocaleString('en-US')} pearls.` });
  if (!p) { i = S.seats.indexOf(null); if (i < 0) return send(c, { t: 'err', m: 'All 6 seats are taken.' }); S.seats[i] = E.pkSeat(c.cid, c.nm, -1, 0); S.seats[i].wid = c.wid; c.sit = true; }
  S.seats[i].s += amt; c.bal -= amt;
  send(c, { t: 'bought', amt, id: 'b' + E.rid() + E.rid() });
  sync(t, true); lobbySoon();
}
function cashOut(t, p, c) {
  if (!(p.s > 0)) return;
  if (!c || c.ws.readyState !== 1) for (const o of clients) if (o.cid === p.c && o.ws.readyState === 1) c = o;
  const msg = { t: 'cashout', amt: p.s, code: t.code, id: 'c' + E.rid() + E.rid() };
  if (c && c.ws.readyState === 1) { c.sit = false; send(c, msg); }
  else if (p.wid) { const q = pending.get(p.wid) || []; q.push(msg); pending.set(p.wid, q.slice(-20)); }
  p.s = 0;
}

/* Publish: everyone gets the table, but only their own hole cards. */
function commit(t) {
  const S = t.S;
  if (S.g === 'pk' && S.ph === 'idle') { const n = E.pkEligible(S).length; if (n >= 2 && !S.at) S.at = Date.now() + 1500; if (n < 2) S.at = 0; }
  const json = JSON.stringify(S), now = Date.now();
  for (const c of t.members) send(c, { t: 'state', code: t.code, now, n: t.members.size, S: view(JSON.parse(json), c.cid) });
  drive(t);
}
function view(v, cid) {
  v.dk = ''; v.sh = '';
  v.seats = v.seats.map((p, i) => {
    if (!p) return null;
    delete p.wid;
    const mine = p.c === cid;
    if (v.g === 'pk' && !mine && p.hc && !p.sh) p.hc = '????';
    if (p.bot < 0) p.c = mine ? 'me' : 's' + i;
    return p;
  });
  if (v.g === 'bj' && v.hide && v.dc.length >= 4) v.dc = v.dc.slice(0, 2) + '??' + v.dc.slice(4);
  return v;
}

/* Timers: bot thinking, turn clocks, dealing and the gap between hands. */
function drive(t) {
  clearTimeout(t.timer); t.timer = 0;
  const S = t.S; if (!t.members.size) return;
  const now = Date.now(); let when = Infinity, fn = null;
  const at = (w, f) => { if (w < when) { when = w; fn = f; } };
  if (S.at) at(S.at, () => tick(t));
  if (S.g === 'bj' && (S.ph === 'bet' || S.ph === 'ins') && S.dl) at(S.dl, () => tick(t));
  if ((S.g === 'pk' && S.ph === 'bet') || (S.g === 'bj' && S.ph === 'play')) {
    const p = S.seats[S.to];
    if (p && p.bot >= 0) {
      if (t.botTk !== S.tk) { t.botTk = S.tk; t.botAt = now + 650 + Math.random() * 750; }
      const tk = S.tk;
      at(t.botAt, () => { if (S.tk !== tk || S.ph !== 'bet') return; const m = E.botMove(S, S.to, 200); E.pkAct(S, S.to, m[0], m[1]); commit(t); });
    } else if (p) {
      let d = S.dl || Infinity;
      if (p.lv || p.gone) { if (t.awayTk !== S.tk) { t.awayTk = S.tk; t.awayAt = now + 2000; } d = Math.min(d, t.awayAt); }
      if (d < Infinity) at(d, () => timeout(t));
    }
  }
  if (fn) t.timer = setTimeout(() => { try { fn(); } catch (e) { console.error('table timer failed:', e); } }, Math.max(0, when - now));
}
function tick(t) {
  const S = t.S, now = Date.now();
  if (S.g === 'pk') {
    if (S.ph === 'run') E.pkNext(S);
    else if ((S.ph === 'idle' || S.ph === 'end') && S.at) { S.at = 0; refresh(t); if (!E.pkStart(S)) S.ph = 'idle'; }
    else S.at = 0;
  } else {
    if (S.ph === 'deal' || S.ph === 'dealer') E.bjTick(S);
    else if (S.ph === 'end') E.bjNewRound(S);
    else if (S.ph === 'bet' && S.dl && now >= S.dl - 50) { S.dl = 0; E.bjDeal(S); }
    else if (S.ph === 'ins' && S.dl && now >= S.dl - 50) E.bjInsTimeout(S);
    else S.at = 0;
  }
  sync(t, true);
}
function timeout(t) {
  const S = t.S, p = S.seats[S.to]; if (!p) return;
  if (S.g === 'pk') { if (S.ph !== 'bet') return; if (!p.lv && !p.gone) { p.mt = (p.mt || 0) + 1; if (p.mt >= 2) { p.out = 1; p.oh = S.h; } } E.pkAct(S, S.to, S.cur - p.b <= 0 ? 'x' : 'f'); }
  else { if (S.ph !== 'play') return; E.bjAct(S, S.to, 's'); }
  sync(t, true);
}
function refresh(t) { if (t.S.g !== 'bj') return; const pm = new Map([...t.members].map(c => [c.cid, c])); for (const p of t.S.seats) if (p && p.bot < 0) { const c = pm.get(p.c); if (c) p.s = c.bal; } }

/* The open-tables list everyone sees in the lobby. */
function lobbyList() {
  const out = [];
  for (const t of tables.values()) {
    if (!t.members.size) continue;
    const humans = t.S.seats.filter(p => p && p.bot < 0);
    out.push({ code: t.code, g: t.g, n: humans.length, w: t.members.size, bots: t.S.seats.filter(p => p && p.bot >= 0).length, names: humans.slice(0, 3).map(p => p.n) });
  }
  return out.sort((a, b) => b.w - a.w).slice(0, 30);
}
let lobbyT = 0;
function lobbySoon() { if (lobbyT) return; lobbyT = setTimeout(() => { lobbyT = 0; const list = lobbyList(); for (const c of clients) if (!c.tb && c.cid) send(c, { t: 'lobby', tables: list }); }, 400); }

/* On a redeploy or restart, hand every poker player back their chips (plus anything in the current pot) before going down. */
function shutdown() {
  for (const t of tables.values()) {
    if (t.g !== 'pk') continue; const S = t.S, pm = new Map([...t.members].map(c => [c.cid, c]));
    for (const p of S.seats) if (p && p.bot < 0) { if (S.ph === 'bet' || S.ph === 'run') p.s += p.t; cashOut(t, p, pm.get(p.c)); }
  }
  setTimeout(() => process.exit(0), 400);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
process.on('uncaughtException', e => console.error('uncaught:', e));
process.on('unhandledRejection', e => console.error('unhandled:', e));
server.listen(PORT, () => console.log(`Deepdive Casino on :${PORT}`));
