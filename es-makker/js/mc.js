/* =============================================================
   mc.js
   Monte Carlo-botten.

   I stedet for at gætte på hvor mange stik hånden er værd, spiller
   botten runden færdig nogle hundrede gange mod gættede modstanderhænder
   og vælger det kort eller den melding der i gennemsnit giver flest
   POINT efter den rigtige pointtabel.
   ============================================================= */

import { SUITS, findCard } from './card.js';
import {
  Bid, VARIANTS, VARIANT_ORDER, SPECIALS, SPECIAL_INFO,
  legalBids, lookupScore, KITTY_SIZE
} from './game.js';
import {
  bestTrump, decidePartnerCard, decideExchange, misereRisk, decideCard
} from './ai.js';
import {
  buildConstraints, sampleWorld, makeSimState, playout,
  ownSide, scoreSim, declaringTricks
} from './rollout.js';

const SUIT_KEYS = SUITS.map(s => s.key);

/** Standardbudget. Skru op for stærkere spil, ned for hurtigere svar. */
export const MC_DEFAULTS = {
  cardWorlds: 60,     // gættede verdener pr. kortvalg
  bidWorlds:  50,     // gættede verdener pr. meldetype
  yieldEvery: 8,      // giv browseren luft med dette interval
  evFloor:    0.0,    // meld kun hvis forventet point er over dette
  soloRiskLimit: 2.0  // haanden skal ligne en misere, foer Sol m.fl. simuleres
};

/** Lader browseren tegne imellem tunge løkker. */
const tick = () => new Promise(r => setTimeout(r, 0));

/* =============================================================
   1. KORTVALG
   ============================================================= */

/**
 * Vælger kort ved at prøve hvert lovligt kort af i en række gættede verdener.
 * @returns {Promise<string>} kort-id
 */
export async function mcChooseCard(seat, ctx, opts = {}) {
  const o = { ...MC_DEFAULTS, ...opts };
  const legal = ctx.legal;
  if (legal.length === 1) return legal[0].id;

  const snap = ctx.snapshot;
  const cons = buildConstraints(seat, snap);
  const sign = ownSide(seat, snap) === 'declaring' ? 1 : -1;

  const total = new Map(legal.map(c => [c.id, 0]));
  let worlds = 0;

  for (let w = 0; w < o.cardWorlds; w++) {
    const world = sampleWorld(cons);
    for (const card of legal) {
      const sim = makeSimState(seat, snap, world, cons);
      forcePlay(sim, seat, card);
      playout(sim);
      total.set(card.id, total.get(card.id) + sign * scoreSim(sim));
    }
    worlds++;
    if (w % o.yieldEvery === o.yieldEvery - 1) await tick();
  }

  let bestId = legal[0].id, bestVal = -Infinity;
  for (const card of legal) {
    const v = total.get(card.id) / worlds;
    if (v > bestVal) { bestVal = v; bestId = card.id; }
  }
  return bestId;
}

/** Lægger et bestemt kort for en spiller, inden resten simuleres. */
function forcePlay(sim, seat, card) {
  const hand = sim.hands[seat] || [];
  sim.hands[seat] = hand.filter(c => c.id !== card.id);
  sim.trick.push({ player: seat, card });
  if (sim.partnerCard && card.id === sim.partnerCard.id) {
    sim.partnerRevealed = true;
    sim.partnerSeat = seat;
  }
}

/* =============================================================
   2. MELDING
   ============================================================= */

/** Muligt makkerkort efter samme stige som i game.js. */
export function partnerCandidates(hand, trump) {
  const holds = new Set(hand.map(c => c.id));
  const pool = SUIT_KEYS.filter(k => !trump || k !== trump);
  for (const rank of ['A', 'K', 'Q', 'J', '10']) {
    const cand = pool.map(k => ({ rank, suit: k, id: `${rank}-${k}` })).filter(c => !holds.has(c.id));
    if (cand.length) return cand;
  }
  return [];
}

/** Vip: katten vender trumfen, joker satser på forrige kort, 3 jokere = uden trumf. */
export function vipTrumpFrom(kitty) {
  let trump = null, jokers = 0;
  for (const c of kitty) {
    if (c.isJoker) jokers++;
    else trump = c.suit;
  }
  return jokers === 3 ? null : trump;
}

/**
 * Stiller en hel runde op i simuleringen ud fra en meldetype og en gættet kat.
 * Trumf, makkeres og bytte afgøres efter de samme regler som i spilmotoren.
 */
function setupSimContract(sim, seat, variant, kitty) {
  const myHand = sim.hands[seat];
  let trump = null;
  let candidates, partnerId;

  if (variant === VARIANTS.HALVE) {
    // Makkeresset meldes først; den der har det, vælger trumf.
    candidates = partnerCandidates(myHand, null);
    partnerId = decidePartnerCard(myHand, candidates, null);
    const chosen = candidates.find(c => c.id === partnerId) || candidates[0];
    const holder = sim.seats.find(s => (sim.hands[s] || []).some(c => c.id === chosen.id)) ?? null;
    const chooserHand = holder !== null && holder !== seat ? sim.hands[holder] : myHand;
    trump = bestTrump(chooserHand, [chosen.suit]).suit;
    sim.partnerCard = { ...chosen, isJoker: false };
  } else {
    if (variant === VARIANTS.GODE) trump = 'clubs';
    else if (variant === VARIANTS.VIP) trump = vipTrumpFrom(kitty);
    else trump = bestTrump(myHand).suit;

    candidates = partnerCandidates(myHand, trump);
    partnerId = decidePartnerCard(myHand, candidates, trump);
    const chosen = candidates.find(c => c.id === partnerId) || candidates[0];
    sim.partnerCard = { ...chosen, isJoker: false };
  }

  sim.trump = trump;
  sim.aceLow = false;
  sim.declarer = seat;
  sim.contract = Bid.normal(7, variant);        // trickniveauet betyder intet for spillet

  /* --- Byttefasen --- */
  const swap = decideExchange(myHand, kitty, { mustSwap: variant === VARIANTS.VIP, trump });
  let deadPile = kitty;
  if (swap.take) {
    const combined = myHand.concat(kitty);
    const out = new Set(swap.discardIds);
    sim.hands[seat] = combined.filter(c => !out.has(c.id));
    deadPile = combined.filter(c => out.has(c.id));
  }

  /* --- Hvor endte makkeresset? --- */
  const pcId = sim.partnerCard.id;
  let holder = null;
  for (const s of sim.seats) if ((sim.hands[s] || []).some(c => c.id === pcId)) { holder = s; break; }
  sim.partnerSeat = holder;
  sim.selfPartner = holder === null || holder === seat;
  sim.partnerRevealed = holder === seat;         // taget op fra katten: falder aldrig som makkeres
  sim.partnerKnown = variant === VARIANTS.HALVE && !sim.selfPartner;   // makkeren valgte trumf

  // Erstat den skitserede makkeres med det rigtige kortobjekt hvis det findes.
  for (const s of sim.seats) {
    const real = findCard(sim.hands[s] || [], pcId);
    if (real) { sim.partnerCard = real; break; }
  }

  sim.trick = [];
  sim.trickNumber = 0;
  sim.toppled = false;
  sim.seats.forEach(s => { sim.tricksWon[s] = 0; });
  return { deadPile, trump };
}

/** Spiller runden igennem N gange for én meldetype og opsamler resultatet. */
async function simulateVariant(seat, snap, variant, worlds, yieldEvery) {
  const cons = buildConstraints(seat, snap);
  const out = [];
  for (let w = 0; w < worlds; w++) {
    const world = sampleWorld(cons);
    const sim = makeSimState(seat, snap, world, cons);
    // Den sidste plads i fordelingen er katten.
    const kitty = world[world.length - 1].slice(0, KITTY_SIZE);
    cons.slots.forEach((slot, i) => { if (slot.kind === 'seat') sim.hands[slot.seat] = world[i].slice(); });
    setupSimContract(sim, seat, variant, kitty);
    playout(sim);
    const declaring = sim.partnerSeat !== null && sim.partnerSeat !== seat ? 2 : 1;
    out.push({ won: declaringTricks(sim), k: declaring });
    if (w % yieldEvery === yieldEvery - 1) await tick();
  }
  return out;
}

/** Spiller en misère igennem N gange og måler hvor ofte spilføreren holder. */
async function simulateSpecial(seat, snap, special, worlds, yieldEvery) {
  const cons = buildConstraints(seat, snap);
  let held = 0;
  for (let w = 0; w < worlds; w++) {
    const world = sampleWorld(cons);
    const sim = makeSimState(seat, snap, world, cons);
    cons.slots.forEach((slot, i) => { if (slot.kind === 'seat') sim.hands[slot.seat] = world[i].slice(); });
    sim.declarer = seat;
    sim.contract = Bid.special(special);
    sim.trump = null;
    sim.aceLow = true;
    sim.partnerCard = null;
    sim.partnerSeat = null;
    sim.selfPartner = true;
    sim.partnerRevealed = false;
    sim.partnerKnown = false;
    sim.trick = [];
    sim.trickNumber = 0;
    sim.toppled = false;
    sim.seats.forEach(s => { sim.tricksWon[s] = 0; });
    playout(sim);
    if (!sim.toppled) held++;
    if (w % yieldEvery === yieldEvery - 1) await tick();
  }
  const p = held / worlds;
  return p * SPECIAL_INFO[special].points * 3 - (1 - p) * SPECIAL_INFO[special].points * 3;
}

/** Gennemsnitligt point for en konkret melding ud fra en simuleret fordeling. */
function evOf(tricks, variant, samples) {
  let sum = 0;
  for (const s of samples) {
    const r = lookupScore(tricks, variant, s.won);
    const per = r.points * ((4 - s.k) / s.k);
    sum += r.made ? per : -per;
  }
  return sum / samples.length;
}

/**
 * Vælger melding ved at simulere hver meldetype og slå resultatet op
 * i pointtabellen. Botten melder det der giver flest point - ikke det
 * den lige akkurat tror den kan holde.
 * @returns {Promise<Bid>}
 */
export async function mcDecideBid(seat, ctx, opts = {}) {
  const o = { ...MC_DEFAULTS, ...opts };
  const snap = ctx.snapshot;
  const options = legalBids(ctx.current || null);
  if (!options.length) return Bid.pass();

  const hand = ctx.hand;
  const wantedVariants = new Set(options.filter(b => b.isNormal).map(b => b.variant));
  const samples = {};
  for (const v of VARIANT_ORDER) {
    if (wantedVariants.has(v)) samples[v] = await simulateVariant(seat, snap, v, o.bidWorlds, o.yieldEvery);
  }

  // Misère koster tid, så den simuleres kun hvis hånden overhovedet ligner en.
  const risk = misereRisk(hand);
  const specialEv = {};
  for (const b of options) {
    if (!b.isSpecial) continue;
    if (risk > o.soloRiskLimit) { specialEv[b.special] = -Infinity; continue; }
    specialEv[b.special] = await simulateSpecial(seat, snap, b.special, Math.ceil(o.bidWorlds * 0.7), o.yieldEvery);
  }

  let best = null, bestEv = o.evFloor;
  for (const b of options) {
    const ev = b.isSpecial ? specialEv[b.special] : evOf(b.tricks, b.variant, samples[b.variant]);
    if (ev > bestEv) { bestEv = ev; best = b; }
  }
  return best || Bid.pass();
}

/* =============================================================
   3. BOT-INTERFACE
   ============================================================= */

/**
 * Monte Carlo-bot med samme grænseflade som createBot i ai.js.
 * Trumf, makkeres og bytte klares stadig af heuristikken - de valg
 * påvirker regnskabet langt mindre end kortspillet og meldingen.
 */
export function createMcBot(seat, opts = {}) {
  const o = { ...MC_DEFAULTS, ...opts };
  return {
    seat,
    kind: 'mc',
    name: 'Monte Carlo',
    bid:      (hand, ctx)       => mcDecideBid(seat, { ...ctx, hand }, o),
    trump:    (hand, ctx)       => bestTrump(hand, ctx.forbidden || []).suit,
    partner:  (hand, ctx)       => decidePartnerCard(hand, ctx.candidates, ctx.trump),
    exchange: (hand, kitty, c)  => decideExchange(hand, kitty, c),
    card:     (ctx)             => mcChooseCard(seat, ctx, o)
  };
}
