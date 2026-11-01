/* =============================================================
   verify.mjs
   Kontrollerer pointtabellen mod kildetabellen, regellogikken,
   pip-opstillingen og hele spillede partier.

   Kor med:  node test/verify.mjs
   ============================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS = p => new URL(`../js/${p}`, import.meta.url).href;

const { Card, Deck } = await import(JS('card.js'));
const {
  Game, Bid, SPECIALS, PLAYER_COUNT, SCORE_TABLE, lookupScore,
  resolveTrick, legalCards, normaliseTarget, TARGET_LIMITS, knowsSelfPartner, VARIANTS
} = await import(JS('game.js'));
const { createBot } = await import(JS('ai.js'));
const { createMcBot } = await import(JS('mc.js'));
const { buildConstraints, sampleWorld, makeSimState, ownSide } = await import(JS('rollout.js'));

let fails = 0;
const chk = (ok, msg) => { if (!ok) { console.log(`   FEJL: ${msg}`); fails++; } };
const head = t => console.log(`\n${t}`);
const card = (rank, suit) => new Card(suit, rank);

/* ---------------------------------------------------------------
   1. Pointtabellen mod kildetabellen
   --------------------------------------------------------------- */
head('1) Pointtabel');
{
  const rows = fs.readFileSync(path.join(HERE, 'table.txt'), 'utf8').trim().split('\n');
  let cells = 0, bad = 0;
  for (const line of rows) {
    const [t, variant, vals] = line.split('|');
    const tricks = Number(t);
    const expected = vals.trim().split(/\s+/).map(Number);
    chk(expected.length === 14, `${t} ${variant}: raekken skal have 14 tal`);
    chk(!!SCORE_TABLE[tricks]?.[variant], `${t} ${variant} findes i SCORE_TABLE`);
    for (let won = 0; won <= 13; won++) {
      const got = lookupScore(tricks, variant, won).points;
      cells++;
      if (got !== expected[won]) {
        console.log(`   AFVIGELSE ${t} ${variant}: ${won} stik -> forventet ${expected[won]}, fik ${got}`);
        bad++; fails++;
      }
    }
  }
  console.log(`   ${cells} celler kontrolleret, ${bad} afvigelser`);
  chk(lookupScore(7, 'alm', 7).made, '7 stik paa en 7-melding holder');
  chk(!lookupScore(7, 'alm', 6).made, '6 stik paa en 7-melding gaar ned');
  chk(lookupScore(13, 'halve', 13).points === 56, '13 Halve alle stik hjem = 56');
}

/* ---------------------------------------------------------------
   2. Meldehierarki
   --------------------------------------------------------------- */
head('2) Meldehierarki');
{
  chk(Bid.normal(7, 'vip').beats(Bid.normal(7, 'alm')), 'Vip slaar Almindelige');
  chk(Bid.normal(7, 'gode').beats(Bid.normal(7, 'vip')), 'Gode slaar Vip');
  chk(Bid.normal(7, 'halve').beats(Bid.normal(7, 'gode')), 'Halve slaar Gode');
  chk(Bid.normal(8, 'alm').beats(Bid.normal(7, 'halve')), '8 Alm slaar 7 Halve');
  chk(!Bid.pass().beats(null) === false || Bid.pass().rank === -1, 'pas har laveste rang');
  for (const [special, need] of [[SPECIALS.SOL, 9], [SPECIALS.REN, 10], [SPECIALS.BORD, 11], [SPECIALS.SUPER, 12]]) {
    const s = Bid.special(special);
    chk(Bid.normal(need, 'vip').beats(s), `${s.label} slaas af ${need} Vip`);
    chk(s.beats(Bid.normal(need, 'alm')), `${s.label} slaar ${need} Alm`);
    chk(!Bid.normal(need, 'alm').beats(s), `${need} Alm slaar IKKE ${s.label}`);
    chk(s.aceLow, `esset er lavest i ${s.label}`);
  }
}

/* ---------------------------------------------------------------
   3. Kortbunke
   --------------------------------------------------------------- */
head('3) Kortbunke');
{
  const d = new Deck();
  chk(d.size === 55, 'bunken har 55 kort');
  chk(d.cards.filter(c => c.isJoker).length === 3, 'tre jokere');
  chk(new Set(d.cards.map(c => c.id)).size === 55, 'alle kort er unikke');
  const { hands, kitty } = d.shuffle().deal(PLAYER_COUNT, 13, 3);
  chk(hands.length === 4 && hands.every(h => h.length === 13), '13 kort til hver af fire');
  chk(kitty.length === 3, 'tre kort i katten');
  chk(card('A', 'spades').value(false) === 14, 'esset er hoejest normalt');
  chk(card('A', 'spades').value(true) === 1, 'esset er lavest i sol');
}

/* ---------------------------------------------------------------
   4. Stikafgoerelse
   --------------------------------------------------------------- */
head('4) Stikafgoerelse');
{
  const joker = new Card(null, null, 0);
  const t = (plays, trump, aceLow) => resolveTrick(plays, trump, aceLow);
  chk(t([{ player: 1, card: joker }, { player: 2, card: card('A', 'spades') }], 'hearts') === 1,
    'joker udspillet er et sikkert stik');
  chk(t([{ player: 1, card: card('A', 'spades') }, { player: 2, card: joker }], null) === 1,
    'joker vinder ikke naar den ikke er spillet ud');
  chk(t([{ player: 1, card: card('A', 'spades') }, { player: 2, card: card('2', 'hearts') }], 'hearts') === 2,
    'mindste trumf slaar es');
  chk(t([{ player: 1, card: card('A', 'spades') }, { player: 2, card: card('K', 'spades') }], null) === 1,
    'es over konge i samme kuloer');
  chk(t([{ player: 1, card: card('A', 'spades') }, { player: 2, card: card('2', 'spades') }], null, true) === 2,
    'esset taber i sol');
  chk(t([{ player: 1, card: card('5', 'spades') }, { player: 2, card: card('K', 'hearts') }], null) === 1,
    'kort uden for kuloeren kan ikke vinde');
}

/* ---------------------------------------------------------------
   5. Lovlige kort
   --------------------------------------------------------------- */
head('5) Lovlige kort');
{
  const joker = new Card(null, null, 0);
  const hand = [card('5', 'spades'), card('9', 'hearts'), joker];

  const lead1 = legalCards(hand, [], { trickNumber: 0 });
  chk(!lead1.some(c => c.isJoker), 'joker maa ikke spilles ud i 1. runde');
  const lead2 = legalCards(hand, [], { trickNumber: 3 });
  chk(lead2.some(c => c.isJoker), 'joker maa spilles ud senere');

  const follow = legalCards(hand, [{ player: 0, card: card('K', 'spades') }], { trickNumber: 2 });
  chk(follow.some(c => c.id === '5-spades') && !follow.some(c => c.id === '9-hearts'),
    'der skal bekendes kuloer');
  chk(follow.some(c => c.isJoker), 'joker maa altid laegges i');

  const ace = card('A', 'diamonds');
  const withAce = [ace, card('3', 'diamonds'), card('9', 'hearts')];
  const forced = legalCards(withAce, [{ player: 0, card: card('7', 'diamonds') }],
    { trickNumber: 1, partnerCard: ace, partnerRevealed: false });
  chk(forced.length === 1 && forced[0].id === ace.id,
    'makkeresset skal falde foerste gang kuloeren spilles');

  // Streng laesning: ogsaa naar indehaveren selv spiller kuloeren ud
  const leadOpts = legalCards(withAce, [], { trickNumber: 2, partnerCard: ace, partnerRevealed: false });
  const ids = leadOpts.map(c => c.id);
  chk(ids.includes(ace.id), 'esset maa spilles ud');
  chk(!ids.includes('3-diamonds'), 'en lille i makkeressets kuloer maa IKKE spilles ud');
  chk(ids.includes('9-hearts'), 'andre kuloerer maa frit spilles ud');

  // Naar esset er faldet, er kuloeren fri igen
  const after = legalCards(withAce, [], { trickNumber: 4, partnerCard: ace, partnerRevealed: true });
  chk(after.map(c => c.id).includes('3-diamonds'), 'efter esset er faldet er kuloeren fri');

  // Har man kun makkeressets kuloer, er esset det eneste lovlige udspil
  const onlySuit = [ace, card('2', 'diamonds')];
  const onlyLead = legalCards(onlySuit, [], { trickNumber: 3, partnerCard: ace, partnerRevealed: false });
  chk(onlyLead.length === 1 && onlyLead[0].id === ace.id, 'kun esset kan spilles ud i det tilfaelde');
}

/* ---------------------------------------------------------------
   5b. Hemmeligholdelse af selvmakker
   --------------------------------------------------------------- */
head('5b) Selvmakker er hemmelig');
{
  const base = { declarer: 1, selfPartnerTruth: true, selfPartnerKnown: false, declarerSawKitty: false };
  chk(!knowsSelfPartner(1, base), 'spilfoereren ved det ikke foer han har byttet');
  chk(!knowsSelfPartner(2, base), 'en modspiller ved det ikke');
  chk(knowsSelfPartner(1, { ...base, declarerSawKitty: true }), 'spilfoereren ved det naar han har set katten');
  chk(!knowsSelfPartner(2, { ...base, declarerSawKitty: true }), 'modspilleren ved det stadig ikke');
  chk(knowsSelfPartner(2, { ...base, selfPartnerKnown: true }), 'alle ved det naar det er offentligt');
  chk(!knowsSelfPartner(2, { ...base, selfPartnerTruth: false, selfPartnerKnown: true }),
    'ingen "ved" noget der ikke er sandt');
}

/* ---------------------------------------------------------------
   6. Pip-opstilling
   --------------------------------------------------------------- */
head('6) Pip-opstilling');
{
  const src = fs.readFileSync(path.join(HERE, '..', 'js', 'ui.js'), 'utf8');
  const body = src.match(/const PIP_LAYOUT = \{([\s\S]*?)\n\};/)[1] + '\n';
  const layout = {};
  for (const m of body.matchAll(/'([^']+)':\s*\[([\s\S]*?)\],?\n/g)) {
    layout[m[1]] = [...m[2].matchAll(/\[(\d+),\s*(\d+)\]/g)].map(p => [Number(p[1]), Number(p[2])]);
  }
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  chk(ranks.every(r => layout[r]), 'alle rangs har en opstilling');
  for (const rank of ranks) {
    const spots = layout[rank];
    const want = rank === 'A' ? 1 : Number(rank);
    chk(spots.length === want, `${rank} har ${want} pips (fik ${spots.length})`);
    chk(new Set(spots.map(s => s.join(','))).size === spots.length, `${rank}: ingen pips oven i hinanden`);
    chk(spots.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100), `${rank}: pips ligger paa kortet`);
    const rows = {};
    spots.forEach(([x, y]) => (rows[y] ||= []).push(x));
    for (const [y, xs] of Object.entries(rows)) {
      chk(xs.includes(25) === xs.includes(75), `${rank}: raekken ved y=${y} er symmetrisk`);
    }
  }
  console.log('   10 opstillinger kontrolleret for antal og symmetri');
}

/* ---------------------------------------------------------------
   7. Spillaengde
   --------------------------------------------------------------- */
head('7) Spillaengde');
{
  chk(PLAYER_COUNT === 4, 'spillet er laast til fire spillere');
  chk(normaliseTarget(null).mode === 'points', 'standard er pointspil');
  chk(normaliseTarget({ mode: 'rounds', value: 99999 }).value === TARGET_LIMITS.rounds.max, 'rundetal begraenses opad');
  chk(normaliseTarget({ mode: 'points', value: -5 }).value === TARGET_LIMITS.points.min, 'pointmaal begraenses nedad');
  chk(normaliseTarget({ mode: 'noget', value: 'abc' }).mode === 'points', 'ugyldigt input falder tilbage');
  let rejected = false;
  try { new Game({ players: Array.from({ length: 5 }, (_, i) => ({ name: `P${i}` })), io: {}, pace: 0 }); }
  catch { rejected = true; }
  chk(rejected, 'fem spillere afvises');
}

/* ---------------------------------------------------------------
   8. Hele partier
   --------------------------------------------------------------- */
let cutCalls = 0;

function makeGame(target, makeBot = createBot) {
  const players = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, isHuman: false }));
  const bots = {};
  players.forEach((p, i) => { bots[i] = makeBot(i); });
  const io = {
    askBid: (s, c) => bots[s].bid(c.hand, c),
    askTrump: (s, c) => bots[s].trump(c.hand, c),
    askPartner: (s, c) => bots[s].partner(c.hand, c),
    askExchange: (s, c) => bots[s].exchange(c.hand, c.kitty, c),
    askCard: async (s, c) => {
      const id = await bots[s].card(c);
      if (!c.legal.some(x => x.id === id)) throw new Error(`ulovligt kort fra plads ${s}: ${id}`);
      return id;
    },
    askContinue: () => true,
    showResult: () => {}
  };
  Object.defineProperty(io, 'askCut', { get() { cutCalls++; return undefined; } });
  const g = new Game({ players, hostIndex: 0, io, pace: 0, target });

  // Foer foerste stik maa bordet intet vide om makkeren - heller ikke at
  // spilfoereren i al hemmelighed har taget esset op fra katten.
  g.on('contractReady', snap => {
    const pub = snap.state;
    if (pub.contract.isSolo) return;
    chk(pub.partnerRevealed === false, 'intet makkeres er faldet foer foerste stik');
    chk(pub.partnerSeat === null || g.state.partnerKnown, 'makkeren er skjult foer foerste stik (undtagen i Halve)');
    if (g.state.selfPartner && !g.state.selfPartnerKnown) {
      chk(pub.selfPartner === false, 'hemmelig selvmakker vises ikke i snapshottet');
      secrecy.secret++;
      if (g.state.partnerRevealed) secrecy.pickedUp++;
    }
  });
  return g;
}

const secrecy = { total: 0, secret: 0, pickedUp: 0 };

function auditRound(g) {
  const st = g.state;
  const rec = g.history[g.history.length - 1];
  chk(st.seats.length === 4, 'fire aktive spillere');
  chk(Object.keys(st.tricksWon).length === 4, 'alle fire har en stikkonto');
  const solo = st.contract.isSolo;
  if (!solo) {
    chk(st.seats.reduce((a, s) => a + st.tricksWon[s], 0) === 13, 'der blev spillet 13 stik');
    chk(st.seats.every(s => st.hands[s].length === 0), 'ingen kort tilbage paa haanden');
    chk(!(st.partnerCard && st.trump && st.partnerCard.suit === st.trump), 'makkeres er ikke i trumfkuloeren');
    if (st.contract.variant === 'halve') {
      chk(st.partnerKnown === !st.selfPartner, 'i Halve er makkeren kendt naar han har valgt trumf');
    }
    chk(st.shownKitty.length === (st.contract.variant === 'vip' ? 3 : 0), 'katten vises kun for bordet i Vip');
  }
  chk(Math.abs(rec.delta.reduce((a, b) => a + b, 0)) < 1e-9, 'regnskabet gaar i nul');

  // Snapshottet maa ikke laekke en hemmelig selvmakker
  const pub = g.snapshot().state;
  if (st.selfPartner && !st.selfPartnerKnown) {
    chk(pub.selfPartner === false, 'hemmelig selvmakker vises heller ikke efter runden');
  }
  if (st.selfPartner) {
    secrecy.total++;
    if (st.contract.isSolo || st.contract.variant === VARIANTS.HALVE) {
      chk(st.selfPartnerKnown, 'selvmakker er offentlig i solo og Halve');
    }
  }
  if (!st.partnerFell && !st.partnerKnown) {
    chk(pub.partnerSeat === null, 'makkerens identitet er skjult indtil esset falder');
  }
  chk(pub.partnerRevealed === st.partnerFell, 'bordet ser kun et makkeres der faktisk er faldet');
  chk(rec.deals >= 1, 'hver runde har mindst en givning');
  return rec;
}

head('8) Partier paa antal runder');
for (const n of [1, 5, 12]) {
  const g = makeGame({ mode: 'rounds', value: n });
  g.on('roundScored', () => auditRound(g));
  await g.start();
  chk(g.roundsPlayed === n, `praecis ${n} runder (fik ${g.roundsPlayed})`);
  chk(g.history.length === n, 'historikken matcher');
  const top = Math.max(...g.scores);
  chk(g.winners.length >= 1 && g.winners.every(i => g.scores[i] === top), 'vinderen har flest point');
}
chk(cutCalls === 0, 'der tages aldrig af og bankes aldrig');
console.log('   ok');

head('9) Partier til pointmaal');
for (const target of [30, 60]) {
  const g = makeGame({ mode: 'points', value: target });
  g.on('roundScored', () => auditRound(g));
  await g.start();
  const top = Math.max(...g.scores);
  chk(top >= target, `maalet ${target} er naaet (top ${Math.round(top)})`);
  const before = g.history.length > 1 ? g.history[g.history.length - 2].totals : g.scores.map(() => 0);
  chk(Math.max(...before) < target, 'partiet stoppede i den rigtige runde');
  console.log(`   maal ${String(target).padStart(3)}: ${String(g.roundsPlayed).padStart(3)} runder, slutstilling ${g.scores.map(v => Math.round(v)).join(' / ')}`);
}

head('10) Lang simulering og meldefordeling');
{
  const g = makeGame({ mode: 'rounds', value: 200 });
  g.on('roundScored', () => auditRound(g));
  await g.start();
  const dealers = new Set(g.history.map(r => r.dealer));
  chk(dealers.size === 4, `giverturen gaar hele bordet rundt (${dealers.size} givere)`);
  const dist = g.history.reduce((m, r) => { m[r.contract.label] = (m[r.contract.label] || 0) + 1; return m; }, {});
  const made = g.history.filter(r => r.made).length;
  const specials = g.history.filter(r => r.contract.isSolo).length;
  console.log(`   200 runder: ${made} holdt, ${200 - made} gik ned, ${specials} specialmeldinger`);
  console.log(`   hyppigste: ${Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}x${v}`).join(', ')}`);
  chk(Object.keys(dist).length >= 4, 'der meldes varieret');
  chk(specials < 60, 'specialmeldinger er ikke overrepraesenteret');

  // Rundenumre skal vaere sammenhaengende 1..200, uanset omgivninger
  const nums = g.history.map(r => r.round);
  const expected = Array.from({ length: nums.length }, (_, i) => i + 1);
  chk(nums.join(',') === expected.join(','), 'rundenumrene er sammenhaengende uden huller');
  const redealt = g.history.filter(r => r.deals > 1);
  chk(g.roundNo === g.roundsPlayed, 'roundNo og roundsPlayed er i trit');
  console.log(`   ${redealt.length} runder kraevede omgivning, hoejeste antal givninger: ${Math.max(...g.history.map(r => r.deals))}`);
  console.log(`   selvmakker ${secrecy.total} gange, heraf ${secrecy.secret} hemmeligt ved foerste stik, ` +
    `${secrecy.pickedUp} gange med esset taget op i det skjulte`);
  chk(secrecy.total === 0 || secrecy.secret > 0, 'selvmakker forekommer ogsaa hemmeligt');
}

/* ---------------------------------------------------------------
   11. Hvad botterne ved - og ikke ved
   --------------------------------------------------------------- */
head('11) Viden i simuleringen');
{
  // Fast fordeling: plads 3 har makkeresset A♦, plads 1 og 2 hver et lille ruder.
  const deck = Deck.buildFullDeck();
  const byId = id => deck.find(c => c.id === id);
  const fixed = { 1: ['2-diamonds'], 2: ['3-diamonds'], 3: ['A-diamonds'] };
  const fixedIds = new Set(Object.values(fixed).flat());
  const pool = deck.filter(c => !fixedIds.has(c.id));
  const hands = {};
  let k = 0;
  for (const s of [0, 1, 2, 3]) {
    const own = (fixed[s] || []).map(byId);
    hands[s] = own.concat(pool.slice(k, k + 13 - own.length));
    k += 13 - own.length;
  }
  const kitty = pool.slice(k);
  const ace = byId('A-diamonds');

  const state = (extra = {}) => ({
    seats: [0, 1, 2, 3], declarer: 0, discarded: [], openHands: [], shownKitty: [],
    hands: Object.fromEntries(Object.entries(hands).map(([s, h]) => [s, h.slice()])),
    partnerCard: ace, partnerSeat: null, selfPartner: false, partnerRevealed: false, partnerKnown: false,
    exchanged: false, played: [], trick: [], trickNumber: 1, ...extra
  });
  const play = (st, seat, id) => {
    const c = byId(id);
    st.hands[seat] = st.hands[seat].filter(x => x.id !== id);
    st.played.push({ seat, card: c, trickNumber: st.trickNumber });
    st.trick.push({ player: seat, card: c });
  };
  /** Hvilke pladser lander et kort hos over mange gættede verdener? */
  const landings = (viewer, st, id, n = 300) => {
    const cons = buildConstraints(viewer, { state: st });
    const out = new Set();
    for (let i = 0; i < n; i++) {
      const world = sampleWorld(cons);
      const at = world.findIndex(h => h.some(c => c.id === id));
      out.add(at < 0 ? 'ingen' : (cons.slots[at].seat ?? 'kat'));
    }
    chk(!out.has('ingen'), `${id} skal vaere blandt de usete kort`);
    return out;
  };

  // Midt i foerste ruderstik: de der ikke har lagt til endnu, kan stadig have esset.
  const midTrick = state();
  play(midTrick, 1, '2-diamonds');
  chk(!buildConstraints(2, { state: midTrick }).pin[ace.id], 'makkeresset laases ikke til katten midt i stikket');
  const mid = landings(2, midTrick, ace.id);
  chk(mid.has(3), 'makkeresset kan stadig ligge hos en der ikke har lagt til');
  chk(!mid.has(1), 'den der spillede kuloeren ud uden esset, har det ikke');

  // Har nogen lagt til i kuloeren uden at esset faldt, har de det ikke.
  const followed = state();
  play(followed, 1, '2-diamonds');
  play(followed, 2, '3-diamonds');
  chk(!landings(0, followed, ace.id).has(2), 'den der har bekendt uden esset, har det ikke');

  // ... medmindre det er spilfoereren efter et bytte: han kan have taget esset
  // op fra katten i al hemmelighed, og saa skal det ikke falde.
  const pickedUp = state({ declarer: 1, exchanged: true });
  play(pickedUp, 1, '2-diamonds');
  play(pickedUp, 2, '3-diamonds');
  const pu = landings(0, pickedUp, ace.id);
  chk(pu.has(1) && !pu.has(2), 'spilfoereren kan stadig have esset efter et bytte');

  // Offentlig selvmakker (Vip): esset er i katten eller hos spilfoereren.
  const known = { declarer: 1, selfPartner: true, selfPartnerTruth: true, selfPartnerKnown: true };
  const vipSelf = landings(0, state({ ...known, exchanged: true }), ace.id);
  chk(!vipSelf.has(2) && !vipSelf.has(3), 'offentlig selvmakker: esset er ikke hos en modspiller');
  const noSwap = landings(0, state(known), ace.id);
  chk(noSwap.size === 1 && noSwap.has('kat'), 'offentlig selvmakker uden bytte: esset ligger i katten');

  // Hemmelig selvmakker: modspilleren aner intet og maa gaette bredt.
  const secret = landings(0, state({ declarer: 1, selfPartnerTruth: true, exchanged: true }), ace.id);
  chk(secret.has(2) && secret.has(3), 'hemmelig selvmakker: modspilleren kan ikke udelukke nogen');

  // Halve: makkeren afsloerede sig ved at vaelge trumf.
  const halve = landings(0, state({ partnerKnown: true, partnerSeat: 3 }), ace.id);
  chk(halve.size === 1 && halve.has(3), 'i Halve ligger makkeresset hos den der valgte trumf');

  // Makkeren skifter ikke side, fordi esset er spillet.
  const fell = state({ partnerRevealed: true, partnerSeat: 3 });
  play(fell, 3, 'A-diamonds');
  chk(ownSide(3, { state: fell }) === 'declaring', 'makkeren er stadig makker efter at have spillet esset');
  chk(ownSide(2, { state: fell }) === 'defending', 'modspilleren er stadig modspiller');

  // Misere: aabne haender er ikke gaettearbejde.
  const open = state({ openHands: [2], partnerCard: null, partnerSeat: null });
  const cons = buildConstraints(0, { state: open });
  chk(!hands[2].some(c => cons.unseen.some(u => u.id === c.id)), 'aabne kort regnes ikke som usete');
  const sim = makeSimState(0, { state: open }, sampleWorld(cons), cons);
  chk(sim.hands[2].map(c => c.id).join() === hands[2].map(c => c.id).join(), 'simuleringen bruger den aabne haand');

  // Vip: katten blev vist for hele bordet, saa den er hos spilfoereren eller i afkastet.
  const vip = state({ declarer: 1, shownKitty: kitty, partnerCard: null, partnerSeat: null });
  for (const c of kitty) {
    const at = landings(0, vip, c.id, 100);
    chk(!at.has(2) && !at.has(3), `${c.label} fra den viste kat havner ikke hos en modspiller`);
  }
}

/* ---------------------------------------------------------------
   12. Motoren haandhaever byttepligten
   --------------------------------------------------------------- */
head('12) Byttepligt i Vip');
{
  const g = makeGame({ mode: 'rounds', value: 1 });
  g.state = { seats: [0, 1, 2, 3], declarer: 0, contract: Bid.normal(7, 'vip'), kitty: [], hands: { 0: [] }, tricksWon: {} };
  g.io.askExchange = () => ({ take: false, discardIds: [] });
  let threw = false;
  try { await g.runExchange(); } catch { threw = true; }
  chk(threw, 'der SKAL byttes i Vip');
}

/* ---------------------------------------------------------------
   13. Monte Carlo-botterne spiller lovligt hele vejen
   --------------------------------------------------------------- */
head('13) Monte Carlo-partier');
{
  const fast = i => createMcBot(i, { cardWorlds: 6, bidWorlds: 6, yieldEvery: 1e9 });
  const g = makeGame({ mode: 'rounds', value: 6 }, fast);
  g.on('roundScored', () => auditRound(g));
  await g.start();
  chk(g.roundsPlayed === 6, `seks runder med Monte Carlo (fik ${g.roundsPlayed})`);
  console.log(`   ${g.roundsPlayed} runder: ${g.history.map(r => r.contract.label).join(', ')}`);
}

console.log(fails ? `\nRESULTAT: ${fails} fejl\n` : '\nRESULTAT: alle kontroller bestaaet\n');
process.exit(fails ? 1 : 0);
