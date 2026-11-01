/* =============================================================
   benchmark.mjs
   Maaler Monte Carlo-botten mod heuristikken. Plads 0 og 2 spiller
   Monte Carlo, plads 1 og 3 spiller heuristisk. Regnskabet er nulsum,
   saa de to siders point er hinandens spejlbillede.

   Kor med:  node test/benchmark.mjs [antal runder]
   ============================================================= */

const JS = p => new URL(`../js/${p}`, import.meta.url).href;
const { Game } = await import(JS('game.js'));
const { createBot } = await import(JS('ai.js'));
const { createMcBot } = await import(JS('mc.js'));

const ROUNDS = Number(process.argv[2] || 80);
const MC_SEATS = [0, 2];

// yieldEvery saettes hoejt, fordi der ikke er nogen browser der skal tegne.
const opts = { yieldEvery: 1e9 };

const players = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, isHuman: false }));
const bots = {};
players.forEach((p, i) => {
  bots[i] = MC_SEATS.includes(i) ? createMcBot(i, opts) : createBot(i);
});

const timing = { bid: [], card: [] };
const measure = async (bucket, seat, work) => {
  const t = process.hrtime.bigint();
  const result = await work();
  if (MC_SEATS.includes(seat)) timing[bucket].push(Number(process.hrtime.bigint() - t) / 1e6);
  return result;
};

const io = {
  askBid:      (s, c) => measure('bid', s, () => bots[s].bid(c.hand, c)),
  askTrump:    (s, c) => bots[s].trump(c.hand, c),
  askPartner:  (s, c) => bots[s].partner(c.hand, c),
  askExchange: (s, c) => bots[s].exchange(c.hand, c.kitty, c),
  askCard:     (s, c) => measure('card', s, async () => {
    const id = await bots[s].card(c);
    if (!c.legal.some(x => x.id === id)) throw new Error(`ulovligt kort fra plads ${s}: ${id}`);
    return id;
  }),
  askContinue: () => true,
  showResult:  () => {}
};

const game = new Game({ players, hostIndex: 0, io, pace: 0, target: { mode: 'rounds', value: ROUNDS } });
// normaliseTarget() begraenser rundetallet til UI'ets 200. Benchmarken maa gerne
// gaa laengere - ellers stopper den ved 200 og deler alligevel med ROUNDS.
game.target = { mode: 'rounds', value: ROUNDS };
let declaredByMc = 0;

game.on('roundScored', ({ record }) => {
  if (MC_SEATS.includes(record.declarer)) declaredByMc++;
  if (Math.abs(record.delta.reduce((a, b) => a + b, 0)) > 1e-9) {
    throw new Error('regnskabet gaar ikke i nul');
  }
  const n = game.history.length;
  if (n % 20 === 0) {
    const mc = MC_SEATS.reduce((a, s) => a + game.scores[s], 0);
    console.log(`  ...${n} runder, Monte Carlo ${mc > 0 ? '+' : ''}${Math.round(mc)}`);
  }
});

const t0 = Date.now();
await game.start();
const secs = (Date.now() - t0) / 1000;

const mc = MC_SEATS.reduce((a, s) => a + game.scores[s], 0);
const heur = game.scores.reduce((a, b) => a + b, 0) - mc;
const stat = a => {
  if (!a.length) return 'ingen maalinger';
  const sorted = [...a].sort((x, y) => x - y);
  const avg = a.reduce((x, y) => x + y, 0) / a.length;
  return `snit ${avg.toFixed(1)} ms, p95 ${sorted[Math.floor(a.length * 0.95)].toFixed(0)} ms`;
};

const played = game.roundsPlayed;
console.log(`\n${played} runder paa ${secs.toFixed(1)}s  (${(secs / played * 1000).toFixed(0)} ms/runde)`);
console.log(`Monte Carlo (plads ${MC_SEATS.join('+')}): ${mc > 0 ? '+' : ''}${Math.round(mc)} point`);
console.log(`Heuristik:                 ${heur > 0 ? '+' : ''}${Math.round(heur)} point`);
console.log(`Forskel pr. runde:         ${(mc / played).toFixed(2)} point til Monte Carlo`);
console.log(`Spilfoerer:                Monte Carlo ${declaredByMc} af ${played} runder`);
console.log(`Taenketid melding:         ${stat(timing.bid)}`);
console.log(`Taenketid kortvalg:        ${stat(timing.card)}`);

const dist = game.history.reduce((m, r) => { m[r.contract.label] = (m[r.contract.label] || 0) + 1; return m; }, {});
console.log(`Meldinger:                 ${Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}x${v}`).join(', ')}`);
