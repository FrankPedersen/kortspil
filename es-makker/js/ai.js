/* =============================================================
   ai.js
   Digitale modspillere: håndevaluering, melding, valg af trumf,
   makkeres, bytte og kortvalg i spilfasen.
   ============================================================= */

import { SUITS, cardsOfSuit } from './card.js';
import {
  Bid, VARIANTS, SPECIALS, legalBids, resolveTrick
} from './game.js';

const SUIT_KEYS = SUITS.map(s => s.key);

/* -------------------------------------------------------------
   PERSONLIGHEDER
   Giver botterne lidt forskellig temperament, så meldingerne
   ikke bliver mekaniske.
   ------------------------------------------------------------- */
export const PERSONALITIES = [
  { name: 'Forsigtig',  aggression: -0.45, soloNerve: 0.00, likesVip: 0.25, likesHalve: 0.05 },
  { name: 'Balanceret', aggression:  0.00, soloNerve: 0.15, likesVip: 0.45, likesHalve: 0.20 },
  { name: 'Frisk',      aggression:  0.45, soloNerve: 0.30, likesVip: 0.60, likesHalve: 0.35 },
  { name: 'Vovehals',   aggression:  0.80, soloNerve: 0.45, likesVip: 0.75, likesHalve: 0.50 }
];

export function personalityFor(seat) {
  return PERSONALITIES[seat % PERSONALITIES.length];
}

/* =============================================================
   1. HÅNDEVALUERING
   ============================================================= */

/** Grupperer hånden i kulører, sorteret højest først. */
export function groupBySuit(hand, aceLow = false) {
  const out = {};
  for (const k of SUIT_KEYS) {
    out[k] = cardsOfSuit(hand, k).sort((a, b) => b.value(aceLow) - a.value(aceLow));
  }
  return out;
}

/** Tæller de rå styrkeelementer på hånden. */
export function countHonours(hand) {
  return {
    jokers: hand.filter(c => c.isJoker).length,
    aces:   hand.filter(c => c.rank === 'A').length,
    kings:  hand.filter(c => c.rank === 'K').length,
    queens: hand.filter(c => c.rank === 'Q').length
  };
}

/**
 * Estimerer hvor mange stik hånden kan tage med en given trumf.
 * Modellen er bevidst simpel: honnører, længde og trumfning.
 * @param {Card[]} hand
 * @param {string|null} trump
 * @param {boolean} aceLow
 * @returns {number} forventet antal stik (0-13)
 */
export function estimateTricks(hand, trump, aceLow = false) {
  const by = groupBySuit(hand, aceLow);
  const jokers = hand.filter(c => c.isJoker).length;
  const trumpLen = trump ? by[trump].length : 0;

  let total = jokers;                       // en joker udspillet er et sikkert stik

  for (const suit of SUIT_KEYS) {
    const cards = by[suit];
    const len = cards.length;
    if (len === 0 && suit !== trump) {
      if (trump && trumpLen >= 4) total += 1.1;      // renonce giver trumfstik
      continue;
    }

    if (suit === trump) {
      // Trumfhonnører tæller næsten fuldt, og lange trumfer sluger småkort.
      let t = 0;
      cards.forEach((c, i) => {
        const v = c.value(aceLow);
        if (v >= 14 - i) t += 1;                     // topkort i ubrudt række
        else if (v >= 11) t += 0.55;
      });
      t += Math.max(0, len - 4) * 0.85;
      total += Math.min(t, len);
    } else {
      let t = 0;
      if (cards.some(c => c.rank === 'A') && !aceLow) t += 1;
      if (cards.some(c => c.rank === 'K')) t += len >= 2 ? 0.75 : 0.3;
      if (cards.some(c => c.rank === 'Q')) t += len >= 3 ? 0.45 : 0.12;
      if (cards.some(c => c.rank === 'J')) t += len >= 4 ? 0.2 : 0;
      t += Math.max(0, len - 4) * 0.55;              // lang kulør bliver god til sidst
      if (trump && trumpLen >= 4) {
        if (len === 1) t += 0.65;
        else if (len === 2) t += 0.25;
      }
      total += t;
    }
  }
  return Math.max(0, Math.min(13, total));
}

/** Den kulør der giver flest estimerede stik. */
export function bestTrump(hand, forbidden = []) {
  let best = null, bestVal = -1;
  for (const k of SUIT_KEYS) {
    if (forbidden.includes(k)) continue;
    const v = estimateTricks(hand, k) + cardsOfSuit(hand, k).length * 0.05;
    if (v > bestVal) { bestVal = v; best = k; }
  }
  return { suit: best, value: bestVal };
}

/**
 * Forventede stik under en given meldetype.
 *  - Almindelige : egen bedste trumf
 *  - Gode        : klør tvunget
 *  - Vip         : trumfen er ukendt, så vi bruger gennemsnittet og trækker lidt fra
 *  - Halve       : makkeren vælger trumf, hvilket koster sikkerhed men giver bytte
 */
/**
 * Tillaeg for makkeren. Spilfoereren spiller ikke alene: makkeresset plus
 * makkerens oevrige kort er statistisk et par stik vaerd, og det er dem man
 * regner med naar man vover sig op paa 7.
 */
export const PARTNER_ALLOWANCE = 2.6;

export function expectedTricks(hand, variant) {
  return PARTNER_ALLOWANCE + rawExpectedTricks(hand, variant);
}

/** Spilfoererens egne stik uden hjaelp fra makkeren. */
export function rawExpectedTricks(hand, variant) {
  switch (variant) {
    case VARIANTS.GODE:
      return estimateTricks(hand, 'clubs');
    case VARIANTS.VIP: {
      const all = SUIT_KEYS.map(k => estimateTricks(hand, k));
      const avg = all.reduce((a, b) => a + b, 0) / all.length;
      return avg + 0.35;                               // man bytter altid i Vip
    }
    case VARIANTS.HALVE: {
      const b = bestTrump(hand);
      return b.value - 0.45;
    }
    default:
      return bestTrump(hand).value;
  }
}

/**
 * Hvor farlig er hånden til en misère (Sol og opefter)?
 * Esset er lavest, så det er de høje kort og de lange kulører der vælter én.
 * @returns {number} 0 = helt renset hånd, højere = farligere
 */
export function misereRisk(hand) {
  const by = groupBySuit(hand, true);
  let risk = 0;
  for (const suit of SUIT_KEYS) {
    const cards = by[suit];
    if (!cards.length) continue;
    for (const c of cards) {
      const v = c.value(true);                         // A = 1
      if (v >= 12) risk += 1.5;                        // Dame/Konge
      else if (v >= 10) risk += 0.8;                   // 10/Knægt
      else if (v >= 8) risk += 0.3;
    }
    if (cards.length >= 5) risk += 1.2;                // lang kulør bliver god til sidst
    if (cards.length === 1 && cards[0].value(true) >= 9) risk += 0.6;
  }
  return risk;
}

/* =============================================================
   2. MELDING
   ============================================================= */

/**
 * Vælger bottens melding.
 * @param {Card[]} hand
 * @param {object} ctx  { current: Bid|null, seat: number }
 * @returns {Bid}
 */
export function decideBid(hand, ctx = {}) {
  const p = ctx.personality || personalityFor(ctx.seat || 0);
  const current = ctx.current || null;
  const options = legalBids(current);
  const risk = misereRisk(hand);

  for (const bid of options) {                        // sorteret fra svagest til stærkest
    if (bid.isSpecial) {
      if (acceptsSpecial(bid.special, risk, p)) return bid;
      continue;
    }
    if (bid.variant === VARIANTS.VIP   && Math.random() > p.likesVip)   continue;
    if (bid.variant === VARIANTS.HALVE && Math.random() > p.likesHalve) continue;

    const value = expectedTricks(hand, bid.variant);
    if (value + p.aggression >= bid.tricks) return bid;
  }
  return Bid.pass();
}

/** Tør botten binde an med en given specialmelding? */
function acceptsSpecial(special, risk, p) {
  const thresholds = {
    [SPECIALS.SOL]:   1.30,
    [SPECIALS.REN]:   0.70,
    [SPECIALS.BORD]:  0.30,
    [SPECIALS.SUPER]: 0.00
  };
  return risk <= thresholds[special] + p.soloNerve;
}

/* =============================================================
   3. TRUMF OG MAKKERES
   ============================================================= */

export function decideTrump(hand, forbidden = []) {
  return bestTrump(hand, forbidden).suit;
}

/**
 * Vælger makkeresset. Man melder helst til et es i en kulør hvor man selv
 * har et par kort, så makkeren kan komme af med det uden at spilde stikket.
 * @param {Card[]} hand
 * @param {{rank:string, suit:string, id:string}[]} candidates
 * @param {string|null} trump
 */
export function decidePartnerCard(hand, candidates, trump) {
  if (!candidates.length) return null;
  const by = groupBySuit(hand);

  let best = candidates[0], bestScore = -Infinity;
  for (const c of candidates) {
    const len = by[c.suit].length;
    let score = 0;
    if (len === 0) score -= 2.5;              // renonce: esset gør ingen gavn
    else if (len === 1) score += 0.5;
    else score += 1.5 + len * 0.3;            // længde bag esset er godt
    if (by[c.suit].some(x => x.rank === 'K')) score += 1.2;   // konge bag esset
    if (trump && c.suit === trump) score -= 99;               // må ikke meldes
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best.id;
}

/* =============================================================
   4. BYTTEFASE
   ============================================================= */

/**
 * Botten bytter altid når den må, og beholder de 13 bedste af de 16 kort.
 * @returns {{take:boolean, discardIds:string[]}}
 */
export function decideExchange(hand, kitty, ctx = {}) {
  const { mustSwap = false, trump = null, aceLow = false } = ctx;
  if (!mustSwap && Math.random() < 0.03) return { take: false, discardIds: [] };

  const combined = hand.concat(kitty);
  const by = groupBySuit(combined, aceLow);
  const trumpLen = trump ? by[trump].length : 0;

  const scored = combined.map(card => ({ card, score: keepScore(card, by, trump, trumpLen, aceLow) }));
  scored.sort((a, b) => a.score - b.score);

  return { take: true, discardIds: scored.slice(0, 3).map(s => s.card.id) };
}

/** Hvor gerne vil vi beholde kortet? Lav score = smid ud. */
function keepScore(card, by, trump, trumpLen, aceLow) {
  if (card.isJoker) return 1000;
  const v = card.value(aceLow);
  if (trump && card.suit === trump) return 500 + v;

  const len = by[card.suit].length;
  let s = v;
  if (card.rank === 'A') s += 12;
  if (card.rank === 'K') s += 7;
  if (card.rank === 'Q') s += 3;
  s += len * 1.6;                              // hold sammen på lange kulører
  // Med lang trumf er det værdifuldt at blive renonce i en kort kulør.
  if (trumpLen >= 5 && len <= 2 && v < 12) s -= 9;
  return s;
}

/* =============================================================
   5. KORTVALG I SPILFASEN
   ============================================================= */

/**
 * Vælger hvilket kort botten spiller.
 * @param {number} seat
 * @param {object} ctx  { legal, hand, trick, snapshot }
 * @returns {string} kort-id
 */
export function decideCard(seat, ctx) {
  const st = ctx.snapshot.state;
  const legal = ctx.legal;
  if (legal.length === 1) return legal[0].id;

  const aceLow = st.aceLow;
  const trump = st.trump;
  const solo = !!(st.contract && st.contract.isSolo);

  /* ---------- Misère: Sol, Ren Sol, Bordlægger, Super Bordlægger ---------- */
  if (solo) {
    // Både spilfører og modspillere vil helst lægge det lavest mulige kort:
    // spilføreren for ikke at vinde, modspillerne for at lade ham vinde.
    const leading = st.trick.length === 0;
    const jokers = legal.filter(c => c.isJoker);
    // Jokeren vinder aldrig naar den IKKE spilles ud - men spilles den ud,
    // tager den stikket, og saa er spilfoereren vaeltet med det samme.
    if (!leading && seat === st.declarer && jokers.length) return jokers[0].id;
    const safe = leading ? legal.filter(c => !c.isJoker) : legal;
    return lowest(safe.length ? safe : legal, aceLow).id;
  }

  const side = knownSide(seat, ctx.hand, st);

  /* ---------- Udspil ---------- */
  if (st.trick.length === 0) {
    return chooseLead(seat, legal, ctx.hand, st, side, aceLow, trump).id;
  }

  /* ---------- Bekendelse ---------- */
  const winnerSeat = resolveTrick(st.trick, trump, aceLow);
  const winnerSide = knownSide(winnerSeat, null, st);
  const partnerLeading = side !== 'unknown' && winnerSide === side;
  const lastToPlay = st.trick.length === 3;

  // Makkeren har allerede stikket: spar på kortene.
  if (partnerLeading && lastToPlay) return lowest(legal, aceLow).id;

  const winners = legal.filter(c => beatsCurrent(c, st.trick, trump, aceLow));
  if (winners.length === 0) return lowest(legal, aceLow).id;

  if (partnerLeading) {
    // Overtag kun hvis det er gratis (fx et lille trumfkort er unødvendigt).
    const cheap = lowest(winners, aceLow);
    return (cheap.value(aceLow) >= 13 || Math.random() < 0.25) ? cheap.id : lowest(legal, aceLow).id;
  }

  // Vind så billigt som muligt – men brug ikke joker til at følge med.
  const nonJoker = winners.filter(c => !c.isJoker);
  const pool = nonJoker.length ? nonJoker : winners;
  return lowest(pool, aceLow).id;
}

/** Vælger udspil. */
function chooseLead(seat, legal, hand, st, side, aceLow, trump) {
  const by = groupBySuit(legal, aceLow);

  // 1) Har vi jokere og er det ikke 1. runde, er et jokerudspil et sikkert stik.
  const joker = legal.find(c => c.isJoker);
  if (joker && st.trickNumber > 0 && Math.random() < 0.6) return joker;

  // 2) Spilførersiden trækker trumfen ud først.
  if (side === 'declaring' && trump) {
    const myTrumps = by[trump];
    if (myTrumps.length >= 4) return myTrumps[0];
  }

  // 3) Modspillerne prøver at trække makkeresset ud af skjul.
  if (side !== 'declaring' && st.partnerCard && !st.partnerRevealed) {
    const suit = st.partnerCard.suit;
    const mine = by[suit] || [];
    if (mine.length && mine[0].value(aceLow) < 14) return mine[mine.length - 1];
  }

  // 4) Ellers: es eller top i den længste sidekulør.
  let best = null, bestScore = -Infinity;
  for (const k of SUIT_KEYS) {
    const cards = by[k];
    if (!cards.length) continue;
    const top = cards[0];
    let score = top.value(aceLow) + cards.length * 1.2;
    if (k === trump) score -= 6;                      // spar på trumfen
    if (score > bestScore) { bestScore = score; best = top; }
  }
  return best || legal[0];
}

/** Slår kortet det nuværende bedste kort i stikket? */
function beatsCurrent(card, trick, trump, aceLow) {
  const test = trick.concat([{ player: -1, card }]);
  return resolveTrick(test, trump, aceLow) === -1;
}

/** Laveste kort (jokere regnes som lavest, da de kun vinder ved udspil). */
function lowest(cards, aceLow) {
  const jokers = cards.filter(c => c.isJoker);
  const rest = cards.filter(c => !c.isJoker);
  if (!rest.length) return jokers[0];
  return rest.reduce((a, b) => (b.value(aceLow) < a.value(aceLow) ? b : a));
}

/**
 * Hvad botten VED om sin egen side. Modspillerne kender først makkeren
 * når makkeresset er faldet - præcis som ved et rigtigt bord. I Halve
 * afslører makkeren sig allerede ved at vælge trumf.
 */
function knownSide(seat, hand, st) {
  if (seat === st.declarer) return 'declaring';
  if (st.contract && st.contract.isSolo) return 'defending';

  // Sin egen haand kender man altid. `hand` sendes kun med for botten selv.
  if (hand && st.partnerCard && hand.some(c => c.id === st.partnerCard.id)) return 'declaring';

  // st.selfPartner er det offentlige billede og er kun sand, naar hele bordet
  // kan se det. Ellers maa botten leve med uvisheden - praecis som ved bordet.
  if (st.selfPartner) return 'defending';
  if (st.partnerRevealed || st.partnerKnown) return seat === st.partnerSeat ? 'declaring' : 'defending';
  return 'unknown';
}

/* -------------------------------------------------------------
   SAMLET BOT-INTERFACE
   Bruges af app.js som io-implementation for de digitale spillere.
   ------------------------------------------------------------- */
export function createBot(seat) {
  const personality = personalityFor(seat);
  return {
    seat,
    personality,
    name: personality.name,
    bid:      (hand, ctx)      => decideBid(hand, { ...ctx, seat, personality }),
    trump:    (hand, ctx)      => decideTrump(hand, ctx.forbidden || []),
    partner:  (hand, ctx)      => decidePartnerCard(hand, ctx.candidates, ctx.trump),
    exchange: (hand, kitty, c) => decideExchange(hand, kitty, c),
    card:     (ctx)            => decideCard(seat, ctx)
  };
}
