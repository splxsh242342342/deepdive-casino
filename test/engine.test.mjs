// Plays thousands of hands against the rules engine and checks that no pearls appear or vanish.
// Run with: npm test
import fs from 'fs';
import assert from 'assert/strict';
const src = fs.readFileSync(new URL('../public/engine.js', import.meta.url), 'utf8');
const E = new Function(src + '\nreturn {pkNew,pkSeat,pkStart,pkAct,pkNext,botMove,ev,score,describe,cards,bjNew,bjSeat,bjDeal,bjTick,bjAct,bjCan,bjInsTimeout,hv,RAKE_CAP};')();

/* hand rankings */
const P = s => E.cards(s, 't');
const name = s => E.describe(E.ev(P(s)));
assert.equal(name('AhKhQhJhTh2c3d'), 'Royal flush');
assert.equal(name('As2d3h4c5sKdKh'), 'Straight, Five high');
assert.equal(name('9s9h9d4c4s4h2d'), 'Nines full of Fours');
assert.equal(name('KsKh7d7c2s2hAd'), 'Two pair, Kings and Sevens');
assert.ok(E.score(E.ev(P('AhAdKc7s2d3c9h'))) > E.score(E.ev(P('AhAdQc7s2d3c9h'))), 'kicker decides');

/* hold'em: every pot is paid out in full, minus a capped rake */
let hands = 0;
for (let game = 0; game < 40; game++) {
  const S = E.pkNew(6, 0), n = 2 + game % 5;
  for (let i = 0; i < n; i++) S.seats[i] = E.pkSeat('p' + i, 'P' + i, i % 2 ? i % 5 : -1, 30 + Math.floor(Math.random() * 1500));
  for (let h = 0; h < 30 && E.pkStart(S); h++) {
    hands++;
    for (let guard = 0; S.ph !== 'end'; guard++) {
      assert.ok(guard < 500, 'hand never finished');
      if (S.ph === 'run') { E.pkNext(S); continue; }
      const i = S.to, p = S.seats[i], r = Math.random(), toCall = S.cur - p.b;
      const m = p.bot >= 0 ? E.botMove(S, i, 40) : r < .2 ? ['f'] : r < .6 ? [toCall ? 'c' : 'x'] : ['r', S.cur + S.mr + Math.floor(Math.random() * 300)];
      assert.ok(E.pkAct(S, i, m[0], m[1]), 'legal move refused');
    }
    const won = S.seats.reduce((a, p) => a + (p ? p.w : 0), 0), put = S.seats.reduce((a, p) => a + (p ? p.t : 0), 0);
    assert.equal(won + S.rk, put, 'pot not paid out exactly');
    assert.ok(S.rk <= E.RAKE_CAP, 'rake over the cap');
  }
}

/* blackjack: bets, doubles, splits, insurance and surrender all settle */
let rounds = 0;
for (let g = 0; g < 1500; g++) {
  const S = E.bjNew(5, 0);
  for (let i = 0; i < 5; i++) { S.seats[i] = E.bjSeat('c' + i, 'P' + i, 1000); S.seats[i].bet = 10 * (1 + Math.floor(Math.random() * 20)); S.seats[i].rd = 1; }
  if (!E.bjDeal(S)) continue; rounds++;
  for (let guard = 0; S.ph !== 'end'; guard++) {
    assert.ok(guard < 400, 'round never finished');
    if (S.ph === 'deal' || S.ph === 'dealer') { E.bjTick(S); continue; }
    if (S.ph === 'ins') { const i = S.seats.findIndex(p => p && p.in && p.ins < 0); if (i < 0) E.bjInsTimeout(S); else E.bjAct(S, i, Math.random() < .5 ? 'i' : 'n'); continue; }
    const opts = ['h', 's', 'd', 'p', 'u'].filter(k => E.bjCan(S, S.to, k));
    assert.ok(E.bjAct(S, S.to, opts[Math.floor(Math.random() * opts.length)]), 'legal move refused');
  }
  for (const p of S.seats) {
    if (!p.in) continue;
    assert.equal(p.hs.reduce((a, h) => a + h.b, 0) + (p.ins > 0 ? p.ins : 0), p.t, 'stake mismatch');
    for (const h of p.hs) assert.ok(h.r, 'hand not settled');
    assert.equal(p.s, 1000 - p.t + p.w, 'balance mismatch');
  }
  const live = S.seats.some(p => p.in && p.hs.some(h => !h.su && E.hv(h.cs) <= 21));
  if (live) assert.ok(E.hv(S.dc) >= 17, 'dealer stopped before 17');
}
console.log(`ok: ${hands} Hold'em hands and ${rounds} Blackjack rounds, every pearl accounted for`);
