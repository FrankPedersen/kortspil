/* =============================================================
   rollout.js
   Synkron mini-motor til Monte Carlo-simulering.

   Spilmotoren i game.js er asynkron og bundet op på UI'et, så den
   kan ikke bruges til at spille tusindvis af runder igennem. Her
   ligger en strippet, synkron udgave der genbruger de rigtige regler
   fra game.js (legalCards og resolveTrick) plus den viden-styrede
   fordeling af de kort man ikke kan se.
   ============================================================= */

import { Deck, SUITS } from './card.js';
import {
  legalCards, resolveTrick, lookupScore, SPECIAL_INFO, TOTAL_TRICKS, knowsSelfPartner
} from './game.js';
import { decideCard } from './ai.js';

const SUIT_KEYS = SUITS.map(s => s.key);
const FULL_DECK = Deck.buildFullDeck();

/* =============================================================
   1. VIDEN: hvad ved denne spiller egentlig?
   ============================================================= */

/**
 * Udleder hvem der er renonce i hvilke kulører ud fra de spillede kort.
 * Bemærk at en joker IKKE afslører noget: den må lægges oveni en kulør
 * man godt kunne have bekendt.
 */
export function deriveVoids(played) {
  const voids = {};
  const byTrick = new Map();
  for (const p of played) {
    if (!byTrick.has(p.trickNumber)) byTrick.set(p.trickNumber, []);
    byTrick.get(p.trickNumber).push(p);
  }
  for (const plays of byTrick.values()) {
    const lead = plays[0];
    if (lead.card.isJoker) continue;                 // ingen kulør at bekende
    const ledSuit = lead.card.suit;
    for (let i = 1; i < plays.length; i++) {
      const { seat, card } = plays[i];
      if (card.isJoker) continue;                    // joker er frit afkast
      if (card.suit !== ledSuit) (voids[seat] ||= new Set()).add(ledSuit);
    }
  }
  return voids;
}

/**
 * Hvem har spillet i et stik hvor makkeressets kulør var spillet ud?
 * Havde de haft esset, var de tvunget til at spille det - også udspilleren,
 * som kun må spille kuløren ud med esset (se legalCards). Det igangværende
 * stik tæller også, men kun for dem der allerede har lagt.
 */
function partnerSuitWitnesses(played, suit) {
  const out = new Set();
  let trick = null, ledSuit = null;
  for (const p of played) {
    if (p.trickNumber !== trick) {
      trick = p.trickNumber;
      ledSuit = p.card.isJoker ? null : p.card.suit;
    }
    if (ledSuit === suit) out.add(p.seat);
  }
  return out;
}

/**
 * Bygger den fordelingsopgave botten står med: hvilke kort er usete,
 * hvor mange skal hver plads have, og hvilke kulører er udelukket hvor.
 * @param {number} seat  den bot der tænker
 * @param {object} snap  snapshot fra spilmotoren
 */
export function buildConstraints(seat, snap) {
  const st = snap.state;
  const myHand = st.hands[seat] || [];

  const seen = new Set(myHand.map(c => c.id));
  for (const p of st.played) seen.add(p.card.id);
  // Spilføreren kender sine egne afkast; alle andre gør ikke.
  if (seat === st.declarer && st.discarded) for (const c of st.discarded) seen.add(c.id);

  // Hænder der ligger åbent (misère) skal ikke gættes - de bruges som de er.
  const open = (st.openHands || []).filter(s => s !== seat);
  for (const s of open) for (const c of st.hands[s] || []) seen.add(c.id);

  const unseen = FULL_DECK.filter(c => !seen.has(c.id));
  const voids = deriveVoids(st.played);

  const others = st.seats.filter(s => s !== seat && !open.includes(s));
  const slots = others.map(s => ({
    kind: 'seat',
    seat: s,
    capacity: (st.hands[s] || []).length,
    voids: voids[s] || new Set()
  }));

  const assigned = slots.reduce((a, s) => a + s.capacity, 0);
  slots.push({ kind: 'dead', seat: null, capacity: unseen.length - assigned, voids: new Set() });

  /* --- Særlig viden om makkeresset --- */
  const dead = slots[slots.length - 1];
  const pin = {};                                    // kort-id -> plads der SKAL have det
  const exclude = {};                                // kort-id -> pladser der IKKE kan have det
  const shut = (id, s) => (exclude[id] ||= new Set()).add(s);

  const pc = st.partnerCard;
  if (pc && !st.partnerRevealed && !seen.has(pc.id)) {
    const partnerSlot = slots.find(sl => sl.kind === 'seat' && sl.seat === st.partnerSeat);
    // Har spilføreren byttet, kan han i al hemmelighed have taget esset op fra
    // katten. Så falder det aldrig som makkeres, og han kan ikke udelukkes.
    const hidden = s => s === st.declarer && st.exchanged;

    if (st.partnerKnown && partnerSlot) pin[pc.id] = partnerSlot;   // Halve: han valgte trumf
    else if (knowsSelfPartner(seat, st)) {
      // Esset lå i katten: enten ligger det der stadig, eller han tog det op.
      for (const s of others) if (!hidden(s)) shut(pc.id, s);
    } else {
      // Makkeresset skal falde første gang kuløren spilles. Har nogen spillet
      // i kuløren uden at esset faldt, har de det ikke.
      for (const s of partnerSuitWitnesses(st.played, pc.suit)) if (!hidden(s)) shut(pc.id, s);
    }
  }

  /* --- Vip: katten blev vendt for hele bordet --- */
  // Spilføreren tog den op, så kortene er enten hos ham eller blandt hans afkast.
  for (const c of st.shownKitty || []) {
    if (seen.has(c.id)) continue;
    for (const s of others) if (s !== st.declarer) shut(c.id, s);
  }

  return { unseen, slots, pin, exclude, open };
}

/* =============================================================
   2. FORDELING AF DE USETE KORT
   ============================================================= */

/**
 * Deler de usete kort ud på en måde der er forenelig med alt botten ved.
 * De mest bundne kort placeres først, ellers maler man sig op i et hjørne.
 * @returns {Map<slot, Card[]>}
 */
export function sampleWorld(cons) {
  const { unseen, slots, pin, exclude = {} } = cons;

  for (let attempt = 0; attempt < 16; attempt++) {
    const cap = slots.map(s => s.capacity);
    const out = slots.map(() => []);

    const cards = unseen.slice();
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    cards.sort((a, b) => optionCount(a) - optionCount(b));

    let ok = true;
    for (const card of cards) {
      const opts = [];
      for (let i = 0; i < slots.length; i++) {
        if (cap[i] > 0 && allowsIdx(i, card)) opts.push(i);
      }
      if (!opts.length) { ok = false; break; }
      const pick = opts[Math.floor(Math.random() * opts.length)];
      out[pick].push(card);
      cap[pick]--;
    }
    if (ok) return out;

    function allowsIdx(i, card) {
      const forced = pin[card.id];
      if (forced) return forced === slots[i];
      if (exclude[card.id]?.has(slots[i].seat)) return false;
      if (card.isJoker) return true;
      return !slots[i].voids.has(card.suit);
    }
    function optionCount(card) {
      if (pin[card.id]) return 0;
      let n = 0;
      for (let i = 0; i < slots.length; i++) if (allowsIdx(i, card)) n++;
      return n;
    }
  }

  // Nødløsning: fordel uden hensyn til renoncer, så simuleringen aldrig går i stå.
  const out = slots.map(() => []);
  let i = 0;
  for (const s of slots) { out[slots.indexOf(s)] = unseen.slice(i, i + s.capacity); i += s.capacity; }
  return out;
}

/* =============================================================
   3. MINI-MOTOR
   ============================================================= */

/** Bygger en simulerbar tilstand ud fra et snapshot og en gættet verden. */
export function makeSimState(seat, snap, world, cons) {
  const st = snap.state;
  const hands = {};
  hands[seat] = st.hands[seat].slice();
  cons.slots.forEach((slot, i) => {
    if (slot.kind === 'seat') hands[slot.seat] = world[i].slice();
  });
  for (const s of cons.open || []) hands[s] = st.hands[s].slice();

  const sim = {
    seats: st.seats.slice(),
    hands,
    trump: st.trump,
    aceLow: st.aceLow,
    contract: st.contract,
    declarer: st.declarer,
    partnerCard: st.partnerCard,
    partnerSeat: null,
    selfPartner: false,                 // udfyldes nedenfor ud fra den gaettede verden
    partnerRevealed: st.partnerRevealed,
    partnerKnown: !!st.partnerKnown,
    trick: st.trick.map(p => ({ ...p })),
    trickNumber: st.trickNumber,
    tricksWon: { ...st.tricksWon },
    toppled: st.toppled,
    leader: st.leader
  };

  // Find hvem der i denne gættede verden sidder med makkeresset.
  if (sim.partnerCard) {
    sim.partnerSeat = st.partnerRevealed || st.partnerKnown
      ? st.partnerSeat
      : sim.seats.find(s => (hands[s] || []).some(c => c.id === sim.partnerCard.id)) ?? null;
    sim.selfPartner = sim.partnerSeat === null || sim.partnerSeat === sim.declarer;
    // Har spilføreren taget esset op fra katten, skal det ikke falde som makkeres.
    if (sim.partnerSeat === sim.declarer) sim.partnerRevealed = true;
  } else {
    sim.selfPartner = !!(st.contract && st.contract.isSolo);
  }
  return sim;
}

const nextSeat = (sim, seat) => sim.seats[(sim.seats.indexOf(seat) + 1) % sim.seats.length];

/**
 * Miserepolitik: den afgoerende del af en Sol eller Bordlaegger er, om
 * modspillerne aktivt kan vaelte spilfoereren. Uden det overvurderer
 * simuleringen hans chancer voldsomt, og botten melder Sol i tide og utide.
 *
 * Modspillerne spiller her med kendskab til spilfoererens haand. Det svarer
 * praecis til Bordlaegger og Super Bordlaegger, hvor kortene ligger aabent,
 * og er en bevidst forsigtig antagelse i almindelig Sol.
 */
function soloPolicy(seat, legal, sim) {
  const aceLow = sim.aceLow;
  const leading = sim.trick.length === 0;
  const low = cards => {
    const rest = cards.filter(c => !c.isJoker);
    const pool = rest.length ? rest : cards;
    return pool.reduce((a, b) => (b.value(aceLow) < a.value(aceLow) ? b : a));
  };

  /* --- Spilfoereren vil for alt i verden ikke vinde --- */
  if (seat === sim.declarer) {
    const jokers = legal.filter(c => c.isJoker);
    if (!leading && jokers.length) return jokers[0];       // vinder aldrig som medspil
    const safe = leading ? legal.filter(c => !c.isJoker) : legal;
    return low(safe.length ? safe : legal);
  }

  /* --- Modspillerne vil tvinge et stik ned over ham --- */
  const dHand = sim.hands[sim.declarer] || [];

  if (leading) {
    // Spil ud i den kuloer hvor spilfoererens LAVESTE kort er hoejest:
    // der er han tvunget til at laegge hoejt. Og spil selv under det.
    let best = null, bestGap = -Infinity;
    for (const card of legal) {
      if (card.isJoker) continue;                          // et jokerudspil forærer ham stikket
      const his = dHand.filter(c => !c.isJoker && c.suit === card.suit);
      if (!his.length) continue;                           // renonce: han smider bare et hoejt kort af
      const hisLow = his.reduce((a, b) => (b.value(aceLow) < a.value(aceLow) ? b : a));
      const gap = hisLow.value(aceLow) - card.value(aceLow);
      if (gap > 0 && gap > bestGap) { bestGap = gap; best = card; }
    }
    if (best) return best;
    const noJoker = legal.filter(c => !c.isJoker);
    return low(noJoker.length ? noJoker : legal);
  }

  // I bekendelsen gaelder det om at blive UNDER spilfoereren, saa hans kort
  // bliver det hoejeste i stikket.
  return low(legal);
}

/** Standardpolitik i udspilningen: den hurtige heuristik fra ai.js. */
function defaultPolicy(seat, legal, sim) {
  if (sim.contract && sim.contract.isSolo) return soloPolicy(seat, legal, sim);
  const id = decideCard(seat, {
    legal,
    hand: sim.hands[seat],
    trick: sim.trick,
    snapshot: { state: sim }
  });
  return legal.find(c => c.id === id) || legal[0];
}

/**
 * Spiller runden færdig fra den nuværende stilling.
 * @param {object} sim      tilstand fra makeSimState (muteres)
 * @param {function} policy valgfri politik
 * @returns {object} den færdigspillede tilstand
 */
export function playout(sim, policy = defaultPolicy) {
  const solo = !!(sim.contract && sim.contract.isSolo);

  for (let t = sim.trickNumber; t < TOTAL_TRICKS; t++) {
    sim.trickNumber = t;

    // Gør et halvspillet stik færdigt, ellers start forfra fra udspilleren.
    let seat = sim.trick.length
      ? nextSeat(sim, sim.trick[sim.trick.length - 1].player)
      : sim.leader;

    while (sim.trick.length < 4) {
      const hand = sim.hands[seat];
      if (!hand || !hand.length) return sim;
      const legal = legalCards(hand, sim.trick, {
        trickNumber: t,
        partnerCard: sim.partnerCard,
        partnerRevealed: sim.partnerRevealed
      });
      const card = policy(seat, legal, sim);
      sim.hands[seat] = hand.filter(c => c.id !== card.id);
      sim.trick.push({ player: seat, card });
      if (sim.partnerCard && card.id === sim.partnerCard.id) {
        sim.partnerRevealed = true;
        sim.partnerSeat = seat;
      }
      seat = nextSeat(sim, seat);
    }

    const winner = resolveTrick(sim.trick, sim.trump, sim.aceLow);
    sim.tricksWon[winner] = (sim.tricksWon[winner] || 0) + 1;
    sim.leader = winner;
    sim.trick = [];

    if (solo && winner === sim.declarer) { sim.toppled = true; return sim; }
  }
  return sim;
}

/* =============================================================
   4. VÆRDIANSÆTTELSE
   ============================================================= */

/** Hvilken side hører spilleren til? Det ved man altid om sig selv. */
export function ownSide(seat, snap) {
  const st = snap.state;
  if (seat === st.declarer) return 'declaring';
  if (st.contract?.isSolo) return 'defending';
  const pc = st.partnerCard;
  if (!pc) return 'defending';
  // Makker er man, hvis man har makkeresset på hånden - eller allerede har
  // spillet det. Det sidste må ikke glemmes, ellers skifter botten side
  // midt i runden, så snart esset er faldet.
  const hand = st.hands[seat] || [];
  if (hand.some(c => c.id === pc.id)) return 'declaring';
  if ((st.played || []).some(p => p.seat === seat && p.card.id === pc.id)) return 'declaring';
  return 'defending';
}

/**
 * Oversætter en færdigspillet simulering til point set fra spilførersiden.
 * Pointtabellen bruges direkte, så botten optimerer på det rigtige regnskab
 * og ikke bare på antal stik.
 */
export function scoreSim(sim) {
  const bid = sim.contract;
  if (bid.isSolo) {
    const pts = SPECIAL_INFO[bid.special].points * 3;   // alene mod tre
    return sim.toppled ? -pts : pts;
  }
  const declaring = [sim.declarer];
  if (sim.partnerSeat !== null && sim.partnerSeat !== sim.declarer) declaring.push(sim.partnerSeat);
  const won = declaring.reduce((a, s) => a + (sim.tricksWon[s] || 0), 0);
  const r = lookupScore(bid.tricks, bid.variant, won);
  const perDeclarer = r.points * ((4 - declaring.length) / declaring.length);
  return r.made ? perDeclarer : -perDeclarer;
}

/** Antal stik til spilførersiden i en færdigspillet simulering. */
export function declaringTricks(sim) {
  const declaring = [sim.declarer];
  if (sim.partnerSeat !== null && sim.partnerSeat !== sim.declarer) declaring.push(sim.partnerSeat);
  return declaring.reduce((a, s) => a + (sim.tricksWon[s] || 0), 0);
}

export { SUIT_KEYS, FULL_DECK };
