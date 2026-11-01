import React, { useState, useEffect, useRef } from 'react';

/* ================================================================== */
/*  KONSTANTER                                                        */
/* ================================================================== */

const SUITS = {
  SPADES:   { name: 'Spar',    symbol: '♠', isRed: false },
  HEARTS:   { name: 'Hjerter', symbol: '♥', isRed: true  },
  DIAMONDS: { name: 'Ruder',   symbol: '♦', isRed: true  },
  CLUBS:    { name: 'Klør',    symbol: '♣', isRed: false }
};

const SLOT_NAMES = { bottom: 'Syd', left: 'Vest', top: 'Nord', right: 'Øst' };

const TARGET_SCORE   = 21;
const CARDS_PER_DEAL = 4;
const BOARD_AT_START = 4;
const NETWORK_DELAY  = 700;
const BOT_THINK_MS   = 1300;
const MAX_LOG        = 100;
const TRICK_SHOW_MS  = 3000;   // hvor længe et taget stik vises, når auto er slået til

/* ================================================================== */
/*  KORT                                                              */
/* ================================================================== */

/**
 * Hvert kort har tre uafhængige værdisæt. Alle er lister, fordi flere kort
 * kan tælle som mere end én værdi:
 *   buildAs    - hvad kortet kan bidrage med INDE i et byggeri
 *   captureAs  - hvilke værdier kortet kan tage hjem MED (fra hånden)
 *   boardAs    - hvilke værdier kortet har, når det ligger på bordet som mål
 *
 * KORT-03  Es      = 1 eller 14 ved stik, men ALTID 1 ved byggeri
 * KORT-04  Sulan   = 10 eller 16 i alle sammenhænge
 * KORT-05  Krabben = 2 eller 15 i alle sammenhænge
 * KORT-07  Spar 5  = almindelig 5'er på bordet, men rydder bordet fra hånden
 */
function createDeck() {
  const deck = [];

  Object.entries(SUITS).forEach(([suitKey, suit]) => {
    for (let value = 1; value <= 13; value++) {
      let displayName = String(value);
      if (value === 1) displayName = 'A';
      else if (value === 11) displayName = 'J';
      else if (value === 12) displayName = 'Q';
      else if (value === 13) displayName = 'K';

      const isSulan   = suitKey === 'DIAMONDS' && value === 10;
      const isKrabben = suitKey === 'SPADES'   && value === 2;
      const isAce     = value === 1;
      const isSweeper = suitKey === 'SPADES'   && value === 5;

      let buildAs   = [value];
      let captureAs = [value];
      let boardAs   = [value];

      if (isAce) {
        buildAs   = [1];        // esset er altid 1 ved byggeri
        captureAs = [1, 14];
        boardAs   = [1, 14];
      }
      if (isSulan) {
        buildAs = captureAs = boardAs = [10, 16];
      }
      if (isKrabben) {
        buildAs = captureAs = boardAs = [2, 15];
      }

      deck.push({
        id: `${suitKey}_${value}`,
        suit: suitKey,
        value,
        displayName,
        symbol: suit.symbol,
        name: `${suit.name} ${displayName}`,
        buildAs,
        captureAs,
        boardAs,
        isSweeper
      });
    }
  });

  return deck;
}

const shuffle = (cards) => {
  const d = [...cards];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

function getCardPoints(card) {
  if (card.suit === 'DIAMONDS' && card.value === 10) return 2; // Sulan
  if (card.suit === 'SPADES'   && card.value === 2)  return 1; // Krabben
  if (card.value === 1) return 1;                              // Es
  return 0;
}

const flattenCards = (item) => (item.isBuild ? item.cards : [item]);

// Kort- og bordbeskrivelser til spilloggen
const cardLabel = (c) => `${c.displayName}${c.symbol}`;
const describeItems = (items) =>
  items
    .map(i => (i.isBuild
      ? `byggeri ${i.value} [${i.cards.map(cardLabel).join(' ')}]`
      : cardLabel(i)))
    .join(', ');

const boardOptions = (item) => (item.isBuild ? [item.value] : item.boardAs);
const buildOptions = (item) => (item.isBuild ? [item.value] : item.buildAs);

/* ================================================================== */
/*  REGELMOTOR                                                        */
/* ================================================================== */

/** Deler enheder i grupper, der HVER summer præcist til target. */
function partitionFixed(units, target) {
  if (!units.length || target <= 0) return null;

  const total = units.reduce((s, u) => s + u.v, 0);
  if (total % target !== 0) return null;

  const groupCount = total / target;
  const sorted = [...units].sort((a, b) => b.v - a.v);
  if (sorted[0].v > target) return null;

  const groups = Array.from({ length: groupCount }, () => ({ sum: 0, items: [] }));

  const place = (i) => {
    if (i === sorted.length) return true;
    const unit = sorted[i];
    const tried = new Set();

    for (const g of groups) {
      if (g.sum + unit.v > target) continue;
      if (tried.has(g.sum)) continue;   // symmetri-pruning
      tried.add(g.sum);

      g.sum += unit.v;
      g.items.push(unit.ref);
      if (place(i + 1)) return true;
      g.sum -= unit.v;
      g.items.pop();
    }
    return false;
  };

  return place(0) ? groups.map(g => g.items) : null;
}

/**
 * Som partitionFixed, men hvor enheder kan have flere mulige værdier
 * (esser er 1 eller 14). Prøver alle kombinationer.
 */
function partitionFlexible(entries, target) {
  const flexible = entries.filter(e => e.options.length > 1);
  if (flexible.length > 8) return null; // sikkerhedsloft

  const combos = 1 << flexible.length;
  for (let mask = 0; mask < combos; mask++) {
    const units = entries.map(e => {
      if (e.options.length === 1) return { v: e.options[0], ref: e.ref };
      const bit = (mask >> flexible.indexOf(e)) & 1;
      return { v: e.options[bit], ref: e.ref };
    });
    const groups = partitionFixed(units, target);
    if (groups) return groups;
  }
  return null;
}

/** Hvilke værdier kan handCard tage selectedItems hjem med? */
function captureTargets(handCard, selectedItems) {
  if (!selectedItems.length) return [];

  const entries = selectedItems.map(item => ({
    options: boardOptions(item),
    ref: item
  }));

  return handCard.captureAs.filter(t => partitionFlexible(entries, t) !== null);
}

const canCapture = (handCard, selectedItems) =>
  captureTargets(handCard, selectedItems).length > 0;

const BUILD_NAMES = { 1: 'Byggeri', 2: 'Dobbelt', 3: 'Tripel', 4: 'Firdobbelt', 5: 'Femdobbelt' };
const buildName = (groups) => BUILD_NAMES[groups] || `${groups}-dobbelt`;

/** Har spilleren et byggeri — enkelt eller låst — stående på bordet? */
const ownedBuild = (board, playerIndex) =>
  board.find(i => i.isBuild && i.owner === playerIndex) || null;

/**
 * Hvilke byggerier kan laves?
 *  - BYG-03: værdien skal stadig kunne tages hjem af et kort på hånden bagefter
 *  - 1 gruppe = enkelt byggeri, 2 = dobbelt, 3 = tripel, osv.
 *  - BYG-04: et låst byggeri kan ikke ændre værdi, men godt udvides med
 *    endnu en gruppe af samme værdi (dobbelt → tripel → firdobbelt ...)
 */
function analyzeBuilds(handCard, selectedItems, handAfterPlay) {
  if (!selectedItems.length) return [];
  if (handCard.isSweeper) return [];           // KORT-07: Spar 5 rydder altid

  const locked = selectedItems.filter(i => i.isBuild && i.groups >= 2);
  if (locked.length > 1) return [];            // to låste byggerier kan ikke slås sammen

  // BYG-03: Spar 5 tæller ikke som dækkort. Den kan kun rydde bordet,
  // aldrig tage et stik, så et byggeri dækket af Spar 5 ville være
  // umuligt at hente hjem.
  const cover = handAfterPlay.filter(c => !c.isSweeper);

  // --- Udvidelse af et låst byggeri: værdien ligger fast ---
  if (locked.length === 1) {
    const base = locked[0];
    const target = base.value;
    if (!cover.some(c => c.captureAs.includes(target))) return [];

    const entries = [
      ...selectedItems.filter(i => i !== base).map(i => ({ options: buildOptions(i), ref: i })),
      { options: handCard.buildAs, ref: handCard }
    ];
    const added = partitionFlexible(entries, target);
    if (!added) return [];

    return [{
      type: 'BYG_DOBBELT',
      buildValue: target,
      groupCount: base.groups + added.length
    }];
  }

  // --- Nyt byggeri ---
  const entries = [
    ...selectedItems.map(item => ({ options: buildOptions(item), ref: item })),
    { options: handCard.buildAs, ref: handCard }
  ];

  const reachable = [...new Set(cover.flatMap(c => c.captureAs))];
  const results = [];

  for (const target of reachable) {
    const groups = partitionFlexible(entries, target);
    if (!groups) continue;
    results.push({
      type: groups.length === 1 ? 'BYG_ENKELT' : 'BYG_DOBBELT',
      buildValue: target,
      groupCount: groups.length
    });
  }

  results.sort((a, b) => a.groupCount - b.groupCount || a.buildValue - b.buildValue);
  return results;
}

/* ================================================================== */
/*  LOVLIGE TRÆK / ROBOT                                              */
/* ================================================================== */

function subsetsUpTo(arr, maxSize) {
  const out = [];
  const walk = (start, cur) => {
    if (cur.length >= maxSize) return;
    for (let i = start; i < arr.length; i++) {
      cur.push(arr[i]);
      out.push([...cur]);
      walk(i + 1, cur);
      cur.pop();
    }
  };
  walk(0, []);
  return out;
}

function getAllLegalMoves(hand, board, me) {
  const moves = [];
  const subsets = subsetsUpTo(board, Math.min(4, Math.max(board.length, 1)));

  hand.forEach(handCard => {
    // KORT-07: Spar 5 har præcis ét lovligt træk — den rydder bordet
    if (handCard.isSweeper) {
      moves.push({ type: 'SPAR_FEM', handCard, boardItems: [...board] });
      return;
    }

    const rest = hand.filter(c => c.id !== handCard.id);

    subsets.forEach(subset => {
      if (canCapture(handCard, subset)) {
        moves.push({ type: 'STIK', handCard, boardItems: subset });
      }
      analyzeBuilds(handCard, subset, rest).forEach(b => {
        moves.push({
          type: b.type, handCard, boardItems: subset,
          buildValue: b.buildValue, groupCount: b.groupCount
        });
      });
    });

    moves.push({ type: 'SMID_UD', handCard, boardItems: [] });
  });

  // BYG-11: har man et byggeri stående, er der kun to lovlige træk —
  // tage det hjem eller bygge videre på det. Hverken smid-ud, andre stik
  // eller Spar 5 er tilladt, så længe byggeriet står.
  const mine = ownedBuild(board, me);
  if (mine) {
    const bound = moves.filter(m =>
      m.type !== 'SMID_UD' &&
      m.type !== 'SPAR_FEM' &&
      m.boardItems.some(i => i.id === mine.id)
    );
    if (bound.length) return bound;
  }

  return moves;
}

/* ================================================================== */
/*  ROBOT                                                             */
/* ================================================================== */

/**
 * Vægtene er tunet empirisk: 10.000 simulerede runder mod den forrige
 * version, med pladsbytte hver runde så positionsbias udlignes.
 * Resultat: +4,8 % point pr. runde.
 *
 * PT_WEIGHT er bevidst sat højt. Det er dét, der sikrer, at Ruder 10,
 * Spar 2 og esser altid går forud for alt andet: et enkelt es hjem
 * vejer tungere end en svaber, og Sulan vejer dobbelt så tungt igen.
 */
const PT_WEIGHT     = 40;   // pr. point i det, man tager hjem
const PT_DISCARD    = 24;   // straf pr. point man forærer væk ved at smide ud
const PT_EXPOSED    = 9;    // straf pr. point man blotter i et enkelt byggeri
const W_CAPTURE     = 15;   // basisværdi ved overhovedet at tage stik
const W_SWEEP       = 120;  // svaber: 1 point, men tvinger næste spiller til at forære et kort
const W_OWN_BUILD   = 60;   // hente sit eget byggeri hjem
const W_STEAL_BUILD = 35;   // snuppe en modstanders byggeri
const W_PER_CARD    = 2;    // bidrag til "flest kort"
const W_PER_SPADE   = 3;    // bidrag til "flest spar"

// Straf for at efterlade bordet svabervenligt. Den vokser med hvad der
// står på spil: at forære en svaber af Sulan væk er langt værre end at
// forære en svaber af to ligegyldige kort væk.
const SR_BASE   = 12;
const SR_POINT  = 15;
const SR_CARD   = 2;

const pointsIn = (cards) => cards.reduce((s, c) => s + getCardPoints(c), 0);

/** Hvordan ser bordet ud EFTER trækket? */
function boardAfterMove(move, board) {
  const { type, handCard, boardItems } = move;
  if (type === 'SPAR_FEM') return [];
  if (type === 'SMID_UD')  return [...board, { ...handCard, isBuild: false }];

  const ids = new Set(boardItems.map(i => i.id));
  const rest = board.filter(i => !ids.has(i.id));
  if (type === 'STIK') return rest;

  return [...rest, {
    id: 'preview',
    isBuild: true,
    groups: move.groupCount || (type === 'BYG_DOBBELT' ? 2 : 1),
    value: move.buildValue,
    cards: [handCard, ...boardItems.flatMap(flattenCards)]
  }];
}

/**
 * Hvor sårbart er bordet? Tæller hvor mange kortværdier der kunne rydde
 * HELE bordet i ét træk, og dermed give næste spiller en svaber.
 *
 * Det er dette, der forhindrer klassikeren: der ligger et byggeri på 10
 * og en løs 5'er, og robotten tager 5'eren — hvorefter byggeriet står
 * alene tilbage og forærer en svaber væk. Med straffen lægger den i
 * stedet et kort ud, så der er noget at rydde efter.
 *
 * Tomt bord straffes ikke: så er det os selv, der lige har svabret.
 */
function sweepRisk(board) {
  if (board.length === 0) return 0;
  if (board.length > 4) return 0;   // store borde er praktisk taget aldrig sårbare
  let risky = 0;
  for (let v = 1; v <= 16; v++) {
    if (canCapture({ captureAs: [v] }, board)) risky++;
  }
  return risky;
}

/* ---------- korthukommelse (sværhedsgrad "Mia") ---------- */

/**
 * Mia husker kun kort, der har LIGGET SYNLIGT på bordet — altså de fire
 * åbne startkort og alt, hvad der siden er spillet ud fra en hånd.
 * Det er præcis den viden, et opmærksomt menneske også kan samle, så
 * ingen har en fordel, der ikke kan opnås ved bordet.
 */
function buildMemory(revealedIds, myHand, opponentCardCount) {
  const myIds = new Set(myHand.map(c => c.id));
  const rem = new Array(17).fill(0);
  let unseen = 0;

  for (const card of createDeck()) {
    if (revealedIds.has(card.id) || myIds.has(card.id)) continue;
    unseen++;
    for (const v of card.captureAs) if (v <= 16) rem[v] += 1;
  }
  return { rem, unseen, oppCards: opponentCardCount };
}

/** Chance for at mindst én modstander sidder med et kort af værdien v. */
function pOpponentHas(mem, v) {
  const k = mem.rem[v] || 0;
  if (k <= 0 || mem.unseen <= 0) return 0;
  return 1 - Math.pow(1 - Math.min(mem.oppCards / mem.unseen, 1), k);
}

/**
 * `mem` er null for sværhedsgraden "Let", som ikke husker noget.
 * Med hukommelse erstattes den grove risikotælling af en sandsynlighed:
 * er alle fire 10'ere allerede væk, er et efterladt byggeri på 10 ufarligt.
 * Målt: 61,6 % vundne spil mod den hukommelsesløse robot.
 */
function scoreMove(move, board, me, mem = null) {
  const { type, handCard, boardItems, buildValue } = move;
  let score;

  if (type === 'SPAR_FEM') {
    const taken = boardItems.flatMap(flattenCards);
    score = W_SWEEP * 0.25
      + pointsIn(taken) * PT_WEIGHT
      + taken.filter(c => c.suit === 'SPADES').length * W_PER_SPADE
      + taken.length * W_PER_CARD;

  } else if (type === 'STIK') {
    const taken = [handCard, ...boardItems.flatMap(flattenCards)];
    score = W_CAPTURE
      + pointsIn(taken) * PT_WEIGHT
      + taken.filter(c => c.suit === 'SPADES').length * W_PER_SPADE
      + taken.length * W_PER_CARD;

    if (boardItems.some(i => i.isBuild && i.owner === me))  score += W_OWN_BUILD;
    if (boardItems.some(i => i.isBuild && i.owner !== me))  score += W_STEAL_BUILD;

    const takenIds = new Set(boardItems.map(i => i.id));
    if (board.length > 0 && board.every(i => takenIds.has(i.id))) score += W_SWEEP;

  } else if (type === 'BYG_DOBBELT') {
    score = 40 + pointsIn([handCard, ...boardItems.flatMap(flattenCards)]) * 6;

  } else if (type === 'BYG_ENKELT') {
    score = 22
      - pointsIn([handCard, ...boardItems.flatMap(flattenCards)]) * PT_EXPOSED
      + Math.min(buildValue, 14) * 0.4;

    // Med hukommelse: hvor sandsynligt er det, at nogen kan snuppe byggeriet?
    if (mem) {
      const cards = [handCard, ...boardItems.flatMap(flattenCards)];
      score -= pOpponentHas(mem, buildValue) * (40 + pointsIn(cards) * 10);
    }

  } else {
    score = 5 - getCardPoints(handCard) * PT_DISCARD;
    if (handCard.suit === 'SPADES') score -= 4;
    score -= Math.min(...handCard.buildAs) * 0.1;

    // Med hukommelse: bliver kortet taget med det samme?
    if (mem) {
      let p = 0;
      for (const v of handCard.boardAs) p = Math.max(p, pOpponentHas(mem, v));
      score -= p * 60;
    }
  }

  // Forær ikke en svaber væk til den næste
  const after = boardAfterMove(move, board);
  const risk = sweepRisk(after);
  if (risk === 0) return score;

  const exposed = after.flatMap(flattenCards);
  const stake = SR_BASE + pointsIn(exposed) * SR_POINT + exposed.length * SR_CARD;

  if (!mem) return score - risk * stake;

  // Vægt risikoen efter hvor sandsynligt det faktisk er
  let p = 0;
  for (let v = 1; v <= 16; v++) {
    if (!canCapture({ captureAs: [v] }, after)) continue;
    p = Math.max(p, pOpponentHas(mem, v));
  }
  return score - p * stake;
}

function evaluateBotMove(hand, board, me, mem = null) {
  const moves = getAllLegalMoves(hand, board, me);
  if (!moves.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = scoreMove(move, board, me, mem);
    if (score > bestScore) { bestScore = score; best = move; }
  }
  return best;
}

/* ================================================================== */
/*  MOCK SOCKET                                                       */
/* ================================================================== */

class MockSocket {
  constructor() { this.listeners = {}; }
  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }
  off(event, cb) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(x => x !== cb);
    }
  }
  emit(event, data) {
    setTimeout(() => (this.listeners[event] || []).forEach(cb => cb(data)), NETWORK_DELAY);
  }
}
const mockSocket = new MockSocket();

/* ================================================================== */
/*  KOMPONENT                                                         */
/* ================================================================== */

const LEVELS = {
  let: { name: 'Let',  desc: 'Spiller på det, den kan se lige nu.' },
  mia: { name: 'Mia',  desc: 'Husker alle kort, der har ligget på bordet.' }
};


/* Pip-placeringer i procent inde i midterfeltet. [x, y, vendt] */
const PIP_LAYOUTS = {
  2:  [[50,0],[50,100,1]],
  3:  [[50,0],[50,50],[50,100,1]],
  4:  [[0,0],[100,0],[0,100,1],[100,100,1]],
  5:  [[0,0],[100,0],[50,50],[0,100,1],[100,100,1]],
  6:  [[0,0],[100,0],[0,50],[100,50],[0,100,1],[100,100,1]],
  7:  [[0,0],[100,0],[50,25],[0,50],[100,50],[0,100,1],[100,100,1]],
  8:  [[0,0],[100,0],[50,25],[0,50],[100,50],[50,75,1],[0,100,1],[100,100,1]],
  9:  [[0,0],[100,0],[0,33],[100,33],[50,50],[0,67,1],[100,67,1],[0,100,1],[100,100,1]],
  10: [[0,0],[100,0],[50,17],[0,33],[100,33],[0,67,1],[100,67,1],[50,83,1],[0,100,1],[100,100,1]]
};

const STYLES = `
:root{
  --felt-dark:#0b3d24; --felt:#14603a; --felt-light:#1c7d4c;
  --wood:#5b3a21; --wood-light:#7a4f2d;
  --paper:#fdfdf8; --paper-dim:#e9e9df;
  --gold:#e2b53f; --gold-dim:#a9862c;
  --red:#d4261a; --black:#1a1a1a;
  --accent:#3fa9e2; --ok:#4caf50;
  --card-w:74px; --card-h:106px; --pip-size:calc(var(--card-w)*.19); --radius:8px;
  --shadow-lo:0 1px 3px rgba(0,0,0,.35);
  --shadow-md:0 4px 12px rgba(0,0,0,.4);
  --shadow-hi:0 10px 28px rgba(0,0,0,.5);
  --font-ui:"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --font-card:Georgia,"Times New Roman",serif;
}
*{box-sizing:border-box}
html,body,#root{height:100%;margin:0}
body{
  font-family:var(--font-ui); color:var(--paper); overflow:hidden;
  background:radial-gradient(circle at 50% 0%,#2a2118 0%,#17110c 60%,#0d0a07 100%);
}

/* ---------- TOPBAR ---------- */
#topbar{
  height:54px; display:flex; align-items:center; gap:18px; padding:0 18px;
  background:linear-gradient(180deg,var(--wood-light),var(--wood));
  border-bottom:2px solid #2e1c0f; box-shadow:var(--shadow-md); position:relative; z-index:40;
}
.logo{margin:0;font-size:20px;letter-spacing:2px;text-transform:uppercase;color:var(--gold);text-shadow:0 1px 0 #000}
.contract-banner{
  flex:1; text-align:center; font-size:13px; font-weight:600;
  background:rgba(0,0,0,.28); border:1px solid rgba(226,181,63,.4);
  border-radius:999px; padding:5px 16px; max-width:640px; margin:0 auto;
}
.topbar-actions{margin-left:auto;display:flex;gap:8px}

/* ---------- KNAPPER ---------- */
.btn{
  font-family:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:6px;
  border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:var(--paper);
  cursor:pointer;transition:transform .08s ease,background .15s ease,filter .15s ease;
}
.btn:hover{background:rgba(255,255,255,.18)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.38;cursor:not-allowed}
.btn-primary{
  background:linear-gradient(180deg,var(--gold),var(--gold-dim));
  border-color:#6d5518;color:#24190a;text-shadow:0 1px 0 rgba(255,255,255,.3);
}
.btn-primary:hover:not(:disabled){filter:brightness(1.08)}
.btn-ghost{background:rgba(0,0,0,.22)}
.act-build{background:linear-gradient(180deg,#7f8fe0,#4a5bb5);border-color:#2f3c86;color:#0d1030}
.act-lock{background:linear-gradient(180deg,#b98ce6,#7c4fbb);border-color:#4d2b7d;color:#160a25}
.act-sweep{background:linear-gradient(180deg,#e8776b,#c33f31);border-color:#8a2419;color:#fff}
.act-discard{background:rgba(255,255,255,.14);color:var(--paper);border-color:rgba(255,255,255,.2);text-shadow:none}

/* ---------- LAYOUT ---------- */
#layout{display:flex;height:calc(100% - 54px)}
#table-wrap{flex:1;position:relative;display:flex;flex-direction:column;min-width:0;padding:14px 14px 8px}

/* ---------- BORDET ---------- */
#table{
  position:relative;flex:1 1 auto;min-height:300px;border-radius:180px/120px;
  background:radial-gradient(ellipse at 50% 42%,var(--felt-light) 0%,var(--felt) 52%,var(--felt-dark) 100%);
  border:12px solid var(--wood);
  box-shadow:inset 0 0 60px rgba(0,0,0,.55),0 12px 34px rgba(0,0,0,.6);
}

/* ---------- SÆDER ---------- */
.seat{position:absolute;display:flex;flex-direction:column;align-items:center;gap:6px}
.seat-top{top:10px;left:50%;transform:translateX(-50%)}
.seat-left{left:12px;top:50%;transform:translateY(-50%)}
.seat-right{right:12px;top:50%;transform:translateY(-50%)}
.seat-plate{
  display:flex;flex-direction:column;align-items:center;min-width:130px;padding:6px 12px;
  border-radius:8px;background:rgba(0,0,0,.42);border:1px solid rgba(255,255,255,.12);
  box-shadow:var(--shadow-lo);transition:box-shadow .2s ease,border-color .2s ease;
}
.seat-plate .seat-name{font-weight:700;font-size:13px;letter-spacing:.4px}
.seat-plate .seat-meta{font-size:11px;opacity:.78;min-height:14px}
.card-count{
  font-size:10px;font-weight:700;letter-spacing:.6px;
  background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.12);
  border-radius:999px;padding:1px 8px;opacity:.85;
}
.seat-left .card-count,.seat-right .card-count{margin-top:2px}
.seat.is-turn .seat-plate{border-color:var(--gold);box-shadow:0 0 0 2px rgba(226,181,63,.4),0 0 18px rgba(226,181,63,.45)}
.seat.is-thinking .seat-plate{animation:think-pulse 1.1s ease-in-out infinite;border-color:var(--accent)}
.seat.is-thinking .seat-meta::after{content:" · tænker…";color:var(--accent)}
@keyframes think-pulse{0%,100%{box-shadow:0 0 0 0 rgba(63,169,226,0)}50%{box-shadow:0 0 0 3px rgba(63,169,226,.3),0 0 16px rgba(63,169,226,.35)}}

.hand-bot{display:flex}
.hand-bot .card-back{margin-left:-30px}
.hand-bot .card-back:first-child{margin-left:0}
.seat-left .hand-bot,.seat-right .hand-bot{flex-direction:column}
.seat-left .hand-bot .card-back,.seat-right .hand-bot .card-back{margin-left:0;margin-top:-46px}
.seat-left .hand-bot .card-back:first-child,.seat-right .hand-bot .card-back:first-child{margin-top:0}

/* ---------- KORT ---------- */
.card{
  position:relative;width:var(--card-w);height:var(--card-h);border-radius:var(--radius);
  background:linear-gradient(160deg,#fff 0%,var(--paper) 55%,var(--paper-dim) 100%);
  border:1px solid #b9b9ac;box-shadow:var(--shadow-md);
  font-family:var(--font-card);color:var(--black);user-select:none;flex:0 0 auto;
  transition:transform .18s ease,box-shadow .18s ease,filter .18s ease;
}
.card.red,.card.red .corner,.card.red .pip-mark,.card.red .court-letter,.card.red .court-suit{color:var(--red)}
.card .corner{position:absolute;display:flex;flex-direction:column;align-items:center;line-height:1;font-weight:700}
.card .corner .r{font-size:15px}
.card .corner .s{font-size:13px}
.card .corner.tl{top:5px;left:6px}
.card .corner.br{bottom:5px;right:6px;transform:rotate(180deg)}
.card .pips{position:absolute;inset:13% 38%}
.card .pip-mark{position:absolute;transform:translate(-50%,-50%);font-size:var(--pip-size);line-height:1}
.card .pip-mark.flip{transform:translate(-50%,-50%) rotate(180deg)}
.card .pips.ace{inset:13% 17%}
.card .pips.ace .pip-mark{font-size:calc(var(--card-w)*.46)}
.card .pips.court-panel{inset:16% 26%;display:flex;align-items:center;justify-content:center}
.card .court-inner{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  width:100%;height:96%;border:1px solid currentColor;border-radius:3px;background:rgba(0,0,0,.03);
}
.card .court-letter{font-size:calc(var(--card-w)*.36);font-weight:700;line-height:1}
.card .court-suit{font-size:calc(var(--card-w)*.2);line-height:1}
.card-note{
  position:absolute;top:4px;right:3px;
  font-family:var(--font-ui);font-size:7.5px;font-weight:700;letter-spacing:.2px;
  color:#7a7a6d;background:rgba(0,0,0,.07);border:1px solid rgba(0,0,0,.12);
  border-radius:3px;padding:0 3px;line-height:12px;
}
.card-note.sweeper{background:var(--red);color:#fff;border-color:#8d1810}
.card-sm{--card-w:46px;--card-h:66px;--pip-size:calc(var(--card-w)*.2)}
.card-sm .corner .r{font-size:10px}
.card-sm .corner .s{font-size:9px}
.card-sm .pips{inset:14% 36%}
.card-sm .pips.ace{inset:14% 16%}
.card-sm .card-note{font-size:6.5px;top:3px;right:3px;line-height:10px;padding:0 2px}

.card-back{
  position:relative;width:var(--card-w);height:var(--card-h);border-radius:var(--radius);
  border:2px solid var(--gold-dim);
  background:repeating-linear-gradient(45deg,#1e3a63 0 6px,#16294a 6px 12px);
  box-shadow:inset 0 0 0 1px rgba(226,181,63,.5),inset 0 0 14px rgba(0,0,0,.45),var(--shadow-lo);
  flex:0 0 auto;
}
.card-back::after{content:"";position:absolute;inset:4px;border:1px solid rgba(226,181,63,.45);border-radius:4px}
.card-sm.card-back::after{inset:3px}

/* ---------- MIDTERFELT ---------- */
#board-area{
  position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);
  /* Bredden er sat så der er plads til seks kort pr. række.
     Bliver der flere, ombryder de automatisk til række to. */
  width:min(62%,560px);
  display:flex;flex-wrap:wrap;gap:9px 10px;
  align-items:center;justify-content:center;
}
.board-empty{margin:0;font-size:13px;font-style:italic;opacity:.4}
.card.pickable{cursor:pointer}
.card.pickable:hover{transform:translateY(-6px);box-shadow:var(--shadow-hi)}
.card.selected{box-shadow:0 0 0 3px var(--gold),var(--shadow-hi);transform:translateY(-6px);cursor:pointer}

.build{
  display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:8px 10px;border-radius:10px;cursor:pointer;
  background:rgba(0,0,0,.45);border:2px solid var(--gold-dim);
  box-shadow:var(--shadow-md);transition:transform .15s ease,box-shadow .15s ease;
}
.build:hover{transform:translateY(-4px)}
.build.locked{border-color:#8f6bc4;background:rgba(46,26,72,.6)}
.build.selected{box-shadow:0 0 0 3px var(--accent),var(--shadow-hi)}
.build-head{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--gold);display:flex;align-items:center;gap:5px}
.build-head b{background:var(--gold);color:#231a08;border-radius:3px;padding:0 5px;font-size:12px}
.build-cards{display:flex;flex-wrap:wrap;gap:3px;justify-content:center;max-width:150px}
.build-cards .mini{
  font-family:var(--font-card);font-size:11px;font-weight:700;
  background:var(--paper);color:var(--black);border-radius:3px;padding:1px 4px;
}
.build-cards .mini.red{color:var(--red)}
.build-owner{font-size:9px;opacity:.55}

/* ---------- BUNKE ---------- */
.deck-pile-wrap{position:absolute;right:26px;bottom:18px;display:flex;align-items:center;gap:8px}
.deck-pile{
  width:46px;height:66px;border-radius:6px;
  background:repeating-linear-gradient(45deg,#1e3a63 0 5px,#16294a 5px 10px);
  border:2px solid var(--gold-dim);
  box-shadow:inset 0 0 0 1px rgba(226,181,63,.45),2px 2px 0 #16294a,4px 4px 0 #12213c,var(--shadow-lo);
}
.deck-empty{width:46px;height:66px;border-radius:6px;border:1px dashed rgba(255,255,255,.2)}
.deck-count{font-size:12px;font-weight:700;opacity:.7}

/* ---------- BANNER + STIKVISNING ---------- */
.final-banner{
  position:absolute;left:50%;top:16px;transform:translateX(-50%);
  padding:7px 20px;border-radius:999px;white-space:nowrap;z-index:15;
  background:linear-gradient(180deg,var(--gold),var(--gold-dim));color:#231a08;
  font-weight:700;font-size:12px;letter-spacing:.4px;box-shadow:var(--shadow-md);
}
.reveal-catch{position:absolute;inset:0;z-index:25;cursor:pointer}
.trick-reveal{
  position:absolute;z-index:30;cursor:pointer;
  padding:10px 14px;border-radius:12px;
  background:rgba(6,14,10,.94);border:2px solid var(--gold);
  box-shadow:var(--shadow-hi);animation:toast-pop .25s ease;
}
.reveal-top{top:96px;left:50%;transform:translateX(-50%)}
.reveal-bottom{bottom:20px;left:50%;transform:translateX(-50%)}
.reveal-left{top:50%;left:20px;transform:translateY(-50%)}
.reveal-right{top:50%;right:20px;transform:translateY(-50%)}
.reveal-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:var(--gold);text-align:center;margin-bottom:8px}
.reveal-cards{display:flex;gap:5px;align-items:center;justify-content:center;flex-wrap:wrap;max-width:300px}
.reveal-cards .card.played{box-shadow:0 0 0 2px var(--gold),var(--shadow-md)}
.reveal-plus{color:var(--gold);font-weight:700;font-size:16px;padding:0 2px}
.reveal-foot{font-size:10px;opacity:.55;text-align:center;margin-top:7px}
@keyframes toast-pop{from{opacity:0;transform:scale(.9) translate(var(--tx,0),0)}to{opacity:1}}

/* ---------- EGEN HÅND ---------- */
.seat-south{position:static;transform:none;margin-top:10px;flex-direction:column;flex:0 0 auto}
.hand-mine{display:flex;justify-content:center;padding:6px 0 2px;min-height:calc(var(--card-h) + 18px)}
.hand-mine .card{margin-left:-22px;cursor:default}
.hand-mine .card:first-child{margin-left:0}
.hand-mine .card.playable{cursor:pointer}
.hand-mine .card.playable:hover{transform:translateY(-18px);box-shadow:var(--shadow-hi);z-index:5}
.hand-mine .card.blocked{filter:grayscale(.75) brightness(.72)}
.hand-mine .card.selected{transform:translateY(-16px);box-shadow:0 0 0 3px var(--accent),var(--shadow-hi);z-index:6}

/* ---------- HANDLINGSLINJE ---------- */
#action-bar{
  flex:0 0 auto;
  display:flex;align-items:center;gap:12px;min-height:52px;margin-top:4px;padding:8px 14px;
  border-radius:10px;background:rgba(0,0,0,.34);border:1px solid rgba(255,255,255,.1);
}
.action-hint{font-size:13px;opacity:.75;flex:1;min-width:0}
.action-buttons{display:flex;gap:8px;flex-wrap:wrap}

/* ---------- SIDEPANEL ---------- */
#sidebar{width:300px;flex:0 0 300px;display:flex;flex-direction:column;gap:10px;padding:14px 14px 14px 0;min-height:0;overflow:hidden}
.panel{background:rgba(0,0,0,.34);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px 12px;box-shadow:var(--shadow-lo);min-height:0}
.panel-grow{flex:0 0 auto;display:flex;flex-direction:column}
.panel-title{margin:0 0 8px;font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:var(--gold)}
.panel-title small{color:var(--paper);opacity:.5;letter-spacing:.4px;text-transform:none;font-size:10px}
.panel-fill{flex:1;overflow-y:auto}

#scoreboard{width:100%;border-collapse:collapse;font-size:12px}
#scoreboard td{padding:5px 4px}
#scoreboard td.num{text-align:right;opacity:.6;font-size:11px}
#scoreboard td.total{opacity:1;font-weight:700;font-size:15px;width:36px}
#scoreboard tr.is-turn td{color:var(--gold)}
#scoreboard tr+tr td{border-top:1px solid rgba(255,255,255,.07)}

.match-status{margin-top:10px}
.match-bar{height:5px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,.1)}
.match-bar-fill{height:100%;background:linear-gradient(90deg,var(--gold-dim),var(--gold));transition:width .45s cubic-bezier(.2,.8,.3,1)}
.match-text{margin-top:5px;font-size:11px;opacity:.6}

#log{list-style:none;margin:0;padding:0;overflow-y:auto;height:118px;font-size:11.5px;line-height:1.35}
#log li{padding:2px 0;border-bottom:1px dashed rgba(255,255,255,.07)}
#log li.hl{color:var(--gold);font-weight:600}
#log li.dim{opacity:.55}

/* ---------- OVERLAY / MODAL ---------- */
.overlay{
  position:fixed;inset:0;background:rgba(4,8,6,.72);backdrop-filter:blur(3px);
  display:flex;align-items:center;justify-content:center;z-index:100;animation:fade-in .18s ease;padding:16px;
}
.modal{
  width:min(620px,92vw);max-height:88vh;overflow-y:auto;
  background:linear-gradient(180deg,#1d2c22,#14201a);
  border:1px solid rgba(226,181,63,.35);border-radius:12px;padding:22px 24px;
  box-shadow:var(--shadow-hi);animation:modal-in .22s cubic-bezier(.2,.9,.3,1.2);
}
.modal-title{margin:0 0 6px;font-size:18px;color:var(--gold);letter-spacing:.5px}
.modal-text{margin:0 0 14px;font-size:13px;line-height:1.55;opacity:.85}
.modal-body{display:flex;flex-direction:column;gap:10px}
.modal-actions{display:flex;gap:10px;justify-content:flex-end;align-items:center;margin-top:18px;flex-wrap:wrap}
.seat-count{margin-right:auto;font-size:12px;opacity:.55}
@keyframes fade-in{from{opacity:0}to{opacity:1}}
@keyframes modal-in{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}

.seat-setup{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  padding:10px 12px;border-radius:8px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.1);
}
.seat-setup.off{opacity:.42}
.toggle{
  width:34px;height:34px;border-radius:7px;cursor:pointer;font-size:15px;font-weight:700;
  border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:var(--paper);
}
.toggle.on{background:var(--ok);border-color:#2f7a33;color:#08210b}
.setup-main{flex:1;min-width:120px;display:flex;flex-direction:column;gap:2px}
.setup-main input{
  font-family:inherit;font-size:14px;padding:5px 8px;border-radius:5px;
  border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.3);color:var(--paper);width:100%;
}
.setup-pos{font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:.45}
.setup-choice{display:flex;gap:5px}
.setup-choice.level{flex-basis:100%;padding-left:44px}
.chip{
  font-family:inherit;font-size:12px;font-weight:600;padding:6px 11px;border-radius:5px;cursor:pointer;
  border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:var(--paper);
}
.chip:disabled{opacity:.3;cursor:not-allowed}
.chip.on{background:var(--gold);border-color:#6d5518;color:#24190a}
.chip.on.green{background:var(--ok);border-color:#2f7a33;color:#08210b}

.rules-body{font-size:13px;line-height:1.6}
.rules-body h4{margin:14px 0 4px;color:var(--gold);font-size:13px}
.rules-body ul{margin:0;padding-left:18px}
.rules-body p{margin:0 0 6px}

.winner-line{text-align:center;font-size:20px;color:var(--gold);margin:4px 0 14px}
.standings{width:100%;border-collapse:collapse;font-size:14px}
.standings th,.standings td{padding:7px 9px;border-bottom:1px solid rgba(255,255,255,.1);text-align:right}
.standings th:first-child,.standings td:first-child{text-align:left}
.standings tr.is-winner td{background:rgba(226,181,63,.14);font-weight:700}

/* ---------- RESPONSIVT ---------- */
@media (max-width:1180px){
  :root{--card-w:62px;--card-h:90px}
  #sidebar{width:260px;flex-basis:260px}
}
@media (max-width:900px){
  #layout{flex-direction:column}
  #sidebar{width:auto;flex:0 0 152px;padding:0 14px 12px;flex-direction:row}
  .panel,.panel-fill,.panel-grow{flex:1;min-width:0}
  #log{height:96px}
  #board-area{width:86%}
}
@media (max-height:760px){
  :root{--card-w:66px;--card-h:95px}
  #log{height:92px}
  #board-area{width:min(66%,520px)}
}
`;

const DEFAULT_SEATS = [
  { slot: 'bottom', active: true, type: 'human', name: 'Dig',     level: 'let' },
  { slot: 'left',   active: true, type: 'bot',   name: 'Robot 1', level: 'let' },
  { slot: 'top',    active: true, type: 'bot',   name: 'Mia',     level: 'mia' },
  { slot: 'right',  active: true, type: 'bot',   name: 'Robot 3', level: 'let' }
];

export default function App() {
  const [screen, setScreen]   = useState('LOBBY');
  const [seats, setSeats]     = useState(DEFAULT_SEATS);
  const [players, setPlayers] = useState([]);

  const [deck, setDeck]   = useState([]);
  const [board, setBoard] = useState([]);
  const [hands, setHands] = useState({});
  const [turn, setTurn]   = useState(0);
  const [lastTaker, setLastTaker] = useState(null);
  const [revealed, setRevealed] = useState(() => new Set());
  const [lastTrick, setLastTrick] = useState(null);
  const [roundNumber, setRoundNumber] = useState(1);

  const [captured, setCaptured] = useState({});
  const [sweeps, setSweeps]     = useState({});
  const [scores, setScores]     = useState({});
  const baselineRef = useRef({}); // point fra afsluttede runder

  const [selectedHandCard, setSelectedHandCard] = useState(null);
  const [selectedBoardItems, setSelectedBoardItems] = useState([]);
  const [gameLog, setGameLog] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [winner, setWinner] = useState(null);
  const [showRules, setShowRules] = useState(false);
  const [showStrategy, setShowStrategy] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const activeSeats = seats.filter(s => s.active);
  const canStart = activeSeats.length >= 2;

  /* ---------- lyd ---------- */
  const audioCtxRef = useRef(null);
  const playSound = (type) => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      // Lavpasfilter tager de skarpe overtoner af, så tonen bliver blød
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1200, now);

      osc.type = 'sine';
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      const p = {
        click:   { from: 320, to: null, g: 0.025, d: 0.09 },
        capture: { from: 420, to: 620,  g: 0.035, d: 0.22 },
        sweep:   { from: 330, to: 780,  g: 0.045, d: 0.40 },
        build:   { from: 260, to: 380,  g: 0.030, d: 0.26 }
      }[type] || { from: 320, to: null, g: 0.025, d: 0.09 };

      osc.frequency.setValueAtTime(p.from, now);
      if (p.to) osc.frequency.linearRampToValueAtTime(p.to, now + p.d * 0.7);

      // Blød indtoning og udtoning — ingen hårde klik i start og slut
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(p.g, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + p.d);

      osc.start(now);
      osc.stop(now + p.d + 0.02);
    } catch (e) { /* lyd er ikke kritisk */ }
  };

  const addLog = (text, type = 'info') =>
    setGameLog(prev => [{ text, type, time: new Date().toLocaleTimeString() }, ...prev].slice(0, MAX_LOG));

  /* ---------- lobby ---------- */

  const toggleSeat = (idx) => {
    setSeats(prev => {
      const next = prev.map((s, i) => (i === idx ? { ...s, active: !s.active } : s));
      // SETUP-01: minimum 2 deltagere
      return next.filter(s => s.active).length >= 2 ? next : prev;
    });
  };

  const setSeatType = (idx, type) =>
    setSeats(prev => prev.map((s, i) => (i === idx ? { ...s, type } : s)));

  const setSeatName = (idx, name) =>
    setSeats(prev => prev.map((s, i) => (i === idx ? { ...s, name } : s)));

  const setSeatLevel = (idx, level) =>
    setSeats(prev => prev.map((s, i) => (i === idx ? { ...s, level } : s)));

  const buildRoster = () =>
    seats.filter(s => s.active).map((s, i) => ({
      id: i,
      name: s.name.trim() || `Spiller ${i + 1}`,
      type: s.type,
      level: s.level || 'let',
      slot: s.slot,
      position: SLOT_NAMES[s.slot]
    }));

  /* ---------- uddeling ---------- */

  const dealRound = (roster, keepScores) => {
    const count = roster.length;
    // RUNDE-07: hver runde bruger et helt, nyblandet spil på 52 kort
    const fresh = shuffle(createDeck());

    const newHands = {};
    for (let p = 0; p < count; p++) newHands[p] = fresh.splice(0, CARDS_PER_DEAL);
    const newBoard = fresh.splice(0, BOARD_AT_START).map(c => ({ ...c, isBuild: false }));

    const zero  = Object.fromEntries(roster.map(p => [p.id, 0]));
    const empty = Object.fromEntries(roster.map(p => [p.id, []]));

    setDeck(fresh);
    setHands(newHands);
    setBoard(newBoard);
    setRevealed(new Set(newBoard.map(c => c.id)));   // kun de åbne startkort
    setLastTrick(null);
    setTurn(0);
    setLastTaker(null);
    setSelectedHandCard(null);
    setSelectedBoardItems([]);
    setCaptured(empty);
    setSweeps(zero);

    if (keepScores) {
      setRoundNumber(r => r + 1);
    } else {
      baselineRef.current = { ...zero };
      setScores(zero);
      setRoundNumber(1);
      setWinner(null);
      setGameLog([]);
    }
  };

  const startNewGame = () => {
    if (!canStart) return;
    const roster = buildRoster();
    setPlayers(roster);
    dealRound(roster, false);
    setScreen('GAME');
    addLog(`Nyt spil med ${roster.length} spillere. Første til ${TARGET_SCORE} point vinder.`, 'success');
  };

  /* ---------- point ---------- */

  const computeScores = (capturedMap, sweepMap, baseline) => {
    const out = {};
    Object.keys(capturedMap).forEach(key => {
      const p = Number(key);
      const cards = capturedMap[p] || [];
      let s = baseline[p] || 0;
      if (cards.some(c => c.suit === 'DIAMONDS' && c.value === 10)) s += 2; // Sulan
      if (cards.some(c => c.suit === 'SPADES'   && c.value === 2))  s += 1; // Krabben
      s += cards.filter(c => c.value === 1).length;                          // Esser
      s += sweepMap[p] || 0;                                                 // Svabere
      out[p] = s;
    });
    return out;
  };

  const findWinner = (scoreMap, roster) => {
    let best = null;
    Object.keys(scoreMap).forEach(key => {
      const p = Number(key);
      if (scoreMap[p] < TARGET_SCORE) return;
      if (best === null || scoreMap[p] > scoreMap[best]) best = p;
    });
    return best === null
      ? null
      : { player: best, name: roster[best].name, score: scoreMap[best] };
  };

  /* ---------- træk ---------- */

  const executeTurn = (action) => {
    if (winner || isProcessing || !action) return;
    setIsProcessing(true);
    mockSocket.emit('turn_played', {
      playerId: turn,
      type: action.type,
      handCard: action.handCard,
      targetItems: action.boardItems || [],
      buildValue: action.buildValue,
      groupCount: action.groupCount
    });
  };

  useEffect(() => {
    const onTurnPlayed = (data) => {
      const { playerId, type, handCard, targetItems, buildValue } = data;
      const actor = players[playerId];
      if (!actor) { setIsProcessing(false); return; }

      let nextBoard = [...board];
      const nextHands    = { ...hands };
      const nextCaptured = { ...captured };
      const nextSweeps   = { ...sweeps };
      let nextLastTaker  = lastTaker;

      nextHands[playerId] = (nextHands[playerId] || []).filter(c => c.id !== handCard.id);

      // Alt hvad der spilles ud, har ligget synligt på bordet
      setRevealed(prev => new Set(prev).add(handCard.id));

      const targetIds = new Set(targetItems.map(i => i.id));
      const collected = targetItems.flatMap(flattenCards);

      if (type === 'SPAR_FEM') {
        // KORT-07: rydder ALT på bordet, inkl. byggerier, og tæller altid
        // som svaber — også ved tomt bord og på rundens sidste stik.
        const nextBoardBefore = [...nextBoard];
        const swept = nextBoard.flatMap(flattenCards);
        nextCaptured[playerId] = [...nextCaptured[playerId], handCard, ...swept];
        setLastTrick({ by: playerId, name: actor.name, played: handCard, taken: swept });
        nextBoard = [];
        nextLastTaker = playerId;
        setLastTaker(playerId);
        nextSweeps[playerId] = (nextSweeps[playerId] || 0) + 1;

        addLog(
          swept.length
            ? `♠5 SVABER! ${actor.name} ryddede bordet med Spar 5 og tog: ${describeItems(nextBoardBefore)} (+1 point).`
            : `♠5 SVABER! ${actor.name} spillede Spar 5 på tomt bord (+1 point).`,
          'success'
        );
        playSound('sweep');

      } else if (type === 'SMID_UD') {
        nextBoard.push({ ...handCard, isBuild: false });
        addLog(`${actor.name} lagde ${handCard.name} på bordet.`);
        playSound('click');

      } else if (type === 'STIK') {
        nextCaptured[playerId] = [...nextCaptured[playerId], handCard, ...collected];
        nextBoard = nextBoard.filter(i => !targetIds.has(i.id));
        nextLastTaker = playerId;
        setLastTaker(playerId);
        setLastTrick({ by: playerId, name: actor.name, played: handCard, taken: collected });

        const moreToPlay = deck.length > 0 || Object.values(nextHands).some(h => h.length);
        if (nextBoard.length === 0 && moreToPlay) {
          nextSweeps[playerId] = (nextSweeps[playerId] || 0) + 1;
          addLog(
            `💥 SVABER! ${actor.name} ryddede bordet med ${cardLabel(handCard)} og tog: ${describeItems(targetItems)} (+1 point).`,
            'success'
          );
          playSound('sweep');
        } else {
          const stolen = targetItems.some(i => i.isBuild && i.owner !== playerId);
          addLog(
            `${actor.name} tog ${describeItems(targetItems)} med ${cardLabel(handCard)}${stolen ? ' (snuppede et byggeri)' : ''}.`,
            'capture'
          );
          playSound('capture');
        }

      } else {
        const groups = data.groupCount || (type === 'BYG_DOBBELT' ? 2 : 1);
        nextBoard = nextBoard.filter(i => !targetIds.has(i.id));
        nextBoard.push({
          id: `build_${playerId}_${Date.now()}`,
          isBuild: true,
          groups,
          value: buildValue,
          owner: playerId,
          cards: [handCard, ...collected]
        });
        addLog(
          groups === 1
            ? `${actor.name} byggede til ${buildValue}.`
            : `${actor.name} lavede et ${buildName(groups).toUpperCase()} byggeri på ${buildValue}.`,
          groups === 1 ? 'info' : 'success'
        );
        playSound('build');
      }

      setBoard(nextBoard);
      setHands(nextHands);
      setCaptured(nextCaptured);
      setSweeps(nextSweeps);
      setSelectedHandCard(null);
      setSelectedBoardItems([]);

      const live = computeScores(nextCaptured, nextSweeps, baselineRef.current);
      setScores(live);

      const liveWinner = findWinner(live, players);
      if (liveWinner) {
        setWinner(liveWinner);
        addLog(`🏆 ${liveWinner.name} nåede ${liveWinner.score} point og har vundet!`, 'victory');
        setIsProcessing(false);
        return;
      }

      const nextTurn = (playerId + 1) % players.length;
      const handsEmpty = Object.values(nextHands).every(h => h.length === 0);

      if (!handsEmpty) {
        setTurn(nextTurn);
        setIsProcessing(false);
        return;
      }

      if (deck.length > 0) {
        const rest = [...deck];
        const dealt = {};
        for (let p = 0; p < players.length; p++) dealt[p] = rest.splice(0, CARDS_PER_DEAL);
        setDeck(rest);
        setHands(dealt);
        setTurn(nextTurn);
        addLog(`${CARDS_PER_DEAL} nye kort til hver.`, 'success');
        setIsProcessing(false);
        return;
      }

      /* ---- runden er slut: bunken og alle hænder er tomme ---- */

      const finalCaptured = { ...nextCaptured };

      // RUNDE-02: sidste stik giver resten af bordet
      if (nextLastTaker !== null && nextBoard.length > 0) {
        const rest = nextBoard.flatMap(flattenCards);
        finalCaptured[nextLastTaker] = [...finalCaptured[nextLastTaker], ...rest];
        addLog(`${players[nextLastTaker].name} fik de sidste ${rest.length} kort fra bordet.`);
      }

      const roundScores = computeScores(finalCaptured, nextSweeps, baselineRef.current);

      // POINT-11: sidste stik i runden giver 1 point
      if (nextLastTaker !== null) {
        roundScores[nextLastTaker] += 1;
        addLog(`${players[nextLastTaker].name} tog sidste stik (+1 point).`, 'success');
      }

      const awardMost = (label, valueOf) => {
        let best = -1, leaders = [];
        players.forEach(p => {
          const v = valueOf(finalCaptured[p.id] || []);
          if (v > best) { best = v; leaders = [p]; }
          else if (v === best) leaders.push(p);
        });
        if (best > 0 && leaders.length === 1) {
          roundScores[leaders[0].id] += 1;
          addLog(`${leaders[0].name} fik flest ${label} (${best}) og får 1 point.`, 'success');
        } else if (leaders.length > 1) {
          addLog(`Uafgjort om flest ${label} (${best}) — ingen point.`);
        }
      };

      awardMost('kort', c => c.length);
      awardMost('spar', c => c.filter(x => x.suit === 'SPADES').length);

      setCaptured(finalCaptured);
      setBoard([]);
      setScores(roundScores);
      baselineRef.current = { ...roundScores };

      const roundWinner = findWinner(roundScores, players);
      if (roundWinner) {
        setWinner(roundWinner);
        addLog(`🏆 ${roundWinner.name} vandt med ${roundWinner.score} point!`, 'victory');
      } else {
        addLog(`Runde ${roundNumber} er slut. Nyt spil kort blandes...`, 'info');
        setTimeout(() => dealRound(players, true), 2500);
      }

      setIsProcessing(false);
    };

    mockSocket.on('turn_played', onTurnPlayed);
    return () => mockSocket.off('turn_played', onTurnPlayed);
  }, [board, hands, deck, captured, sweeps, lastTaker, players, winner, roundNumber]);

  // Vis det tagne stik, før det forsvinder i bunken.
  // Med auto slået fra bliver det stående, til der klikkes.
  useEffect(() => {
    if (!lastTrick || !autoAdvance) return;
    const t = setTimeout(() => setLastTrick(null), TRICK_SHOW_MS);
    return () => clearTimeout(t);
  }, [lastTrick, autoAdvance]);

  /* ---------- robotter ---------- */

  useEffect(() => {
    if (screen !== 'GAME' || winner || isProcessing) return;
    if (lastTrick) return;          // lad spilleren nå at se stikket
    const actor = players[turn];
    if (!actor || actor.type !== 'bot') return;
    if (!hands[turn] || hands[turn].length === 0) return;

    const timer = setTimeout(() => {
      const mem = actor.level === 'mia'
        ? buildMemory(
            revealed,
            hands[turn],
            players.reduce((n, p) => n + (p.id === turn ? 0 : (hands[p.id] || []).length), 0)
          )
        : null;
      const move = evaluateBotMove(hands[turn], board, turn, mem);
      executeTurn(move || { type: 'SMID_UD', handCard: hands[turn][0], boardItems: [] });
    }, BOT_THINK_MS);

    return () => clearTimeout(timer);
  }, [screen, turn, hands, board, winner, isProcessing, players, revealed, lastTrick]);

  /* ---------- interaktion ---------- */

  const activeSeat = players[turn]?.type === 'human'
    ? turn
    : (players.find(p => p.type === 'human')?.id ?? 0);

  const viewHand = hands[activeSeat] || [];
  const isMyTurn = turn === activeSeat && !isProcessing && !winner;

  const toggleBoardSelection = (item) => {
    if (!isMyTurn) return;
    playSound('click');
    setSelectedBoardItems(prev =>
      prev.some(i => i.id === item.id)
        ? prev.filter(i => i.id !== item.id)
        : [...prev, item]
    );
  };

  const myBuild = ownedBuild(board, activeSeat);

  const legal = (() => {
    if (!selectedHandCard) {
      return {
        hint: myBuild
          ? `Du har et ${buildName(myBuild.groups).toLowerCase()} byggeri på ${myBuild.value}. Du skal enten tage det hjem eller bygge videre på det.`
          : 'Vælg først et kort fra din hånd.',
        actions: []
      };
    }

    const rest = viewHand.filter(c => c.id !== selectedHandCard.id);
    const actions = [];

    // BYG-11: med et eget byggeri på bordet er kun to træk lovlige.
    // Det gælder også Spar 5 — den må ikke bruges til at omgå forpligtelsen.
    const mustUseBuild = myBuild !== null;
    const usesBuild = selectedBoardItems.some(i => i.id === myBuild?.id);

    if (selectedHandCard.isSweeper) {
      if (mustUseBuild) {
        return {
          hint: `Spar 5 kan ikke spilles nu. Du har et byggeri på ${myBuild.value}, som skal tages hjem eller bygges videre på først.`,
          actions: []
        };
      }
      // KORT-07: ellers har Spar 5 kun ét træk, uanset hvad der er valgt
      return {
        hint: null,
        actions: [{
          type: 'SPAR_FEM',
          tone: 'sweep',
          label: board.length ? `Ryd bordet (${board.length} ting)` : 'Ryd bordet (tomt)'
        }]
      };
    }

    if (mustUseBuild && !usesBuild) {
      return {
        hint: `Vælg dit ${buildName(myBuild.groups).toLowerCase()} byggeri på ${myBuild.value} — du skal enten tage det hjem eller bygge videre på det.`,
        actions: []
      };
    }

    if (!selectedBoardItems.length) {
      actions.push({
        type: 'SMID_UD',
        tone: 'discard',
        label: `Læg ${selectedHandCard.displayName} på bordet`
      });
      return { hint: null, actions };
    }

    captureTargets(selectedHandCard, selectedBoardItems).forEach(target => {
      actions.push({
        type: 'STIK',
        buildValue: target,
        label: selectedHandCard.value === 1 ? `Tag stik (es = ${target})` : 'Tag stik'
      });
    });

    analyzeBuilds(selectedHandCard, selectedBoardItems, rest).forEach(b => {
      actions.push({
        type: b.type,
        buildValue: b.buildValue,
        groupCount: b.groupCount,
        tone: b.groupCount === 1 ? 'build' : 'lock',
        label: b.groupCount === 1
          ? `Byg til ${b.buildValue}`
          : `${buildName(b.groupCount)}byg til ${b.buildValue}`
      });
    });

    if (!actions.length) {
      return {
        hint: mustUseBuild
          ? `Det kan du ikke med dit byggeri på ${myBuild.value}. Tag det hjem, eller byg videre på det.`
          : 'Ingen lovlige træk. Husk: du skal beholde byggeriets værdi på hånden.',
        actions: []
      };
    }
    return { hint: null, actions };
  })();

  const standings = [...players].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
  const seatOf = (slot) => players.find(p => p.slot === slot);

  // Sidste omgang: bunken er tom, men der er stadig kort på hænderne.
  // Det er her, sidste stik afgøres (1 point + resten af bordet).
  const isFinalDeal =
    screen === 'GAME' &&
    deck.length === 0 &&
    Object.values(hands).some(h => h.length > 0);

  /* ================================================================ */
  /*  RENDER                                                          */
  /* ================================================================ */

  const suitClass = (suit) => (SUITS[suit].isRed ? 'red' : '');

  const Card = ({ card, className = '', onClick, small }) => {
    // Esset har ét stort midterfelt og plads til begge værdier.
    // Sulan og Krabben viser kun deres ekstra værdi, så mærket kan
    // være i hjørnet uden at dække en pip.
    const note = card.isSweeper ? 'RYD'
      : card.value === 1 ? '1/14'
      : (card.captureAs.length > 1 || card.captureAs[0] !== card.value)
        ? String(Math.max(...card.captureAs))
        : null;

    return (
      <div
        className={`card ${suitClass(card.suit)} ${small ? 'card-sm' : ''} ${className}`}
        onClick={onClick}
      >
        <span className="corner tl"><span className="r">{card.displayName}</span><span className="s">{card.symbol}</span></span>
        <span className="corner br"><span className="r">{card.displayName}</span><span className="s">{card.symbol}</span></span>

        {card.value === 1 ? (
          <span className="pips ace"><span className="pip-mark" style={{ left: '50%', top: '50%' }}>{card.symbol}</span></span>
        ) : card.value >= 11 ? (
          <span className="pips court-panel">
            <span className="court-inner">
              <span className="court-letter">{card.displayName}</span>
              <span className="court-suit">{card.symbol}</span>
            </span>
          </span>
        ) : (
          <span className="pips">
            {(PIP_LAYOUTS[card.value] || []).map(([x, y, f], i) => (
              <span key={i} className={`pip-mark ${f ? 'flip' : ''}`} style={{ left: `${x}%`, top: `${y}%` }}>
                {card.symbol}
              </span>
            ))}
          </span>
        )}

        {note && <span className={`card-note ${card.isSweeper ? 'sweeper' : ''}`}>{note}</span>}
      </div>
    );
  };

  const Seat = ({ slot }) => {
    const p = seatOf(slot);
    if (!p || p.id === activeSeat) return null;
    const cards = hands[p.id] || [];
    const thinking = turn === p.id && p.type === 'bot';

    return (
      <div className={`seat seat-${slot} ${turn === p.id ? 'is-turn' : ''} ${thinking ? 'is-thinking' : ''}`}>
        <div className="seat-plate">
          <span className="seat-name">{p.name}</span>
          <span className="seat-meta">
            {scores[p.id] || 0} p · {cards.length} kort
            {p.type === 'bot' ? ` · ${LEVELS[p.level || 'let'].name}` : ''}
          </span>
        </div>
        <div className="hand-bot">
          {cards.map(c => <span key={c.id} className="card-back card-sm" />)}
        </div>
        <span className="card-count">
          {cards.length === 0 ? 'ingen kort' : `${cards.length} kort`}
        </span>
      </div>
    );
  };

  const Build = ({ item }) => {
    const sel = selectedBoardItems.some(i => i.id === item.id);
    return (
      <div
        className={`build ${item.groups >= 2 ? 'locked' : ''} ${sel ? 'selected' : ''}`}
        onClick={() => toggleBoardSelection(item)}
      >
        <span className="build-head">
          {item.groups >= 2 && '🔒 '}{buildName(item.groups)}
          <b>{item.value}</b>
        </span>
        <span className="build-cards">
          {item.cards.map(c => (
            <span key={c.id} className={`mini ${suitClass(c.suit)}`}>{c.displayName}{c.symbol}</span>
          ))}
        </span>
        <span className="build-owner">{players[item.owner]?.name}</span>
      </div>
    );
  };

  return (
    <>
      <style>{STYLES}</style>

      <div id="topbar">
        <h1 className="logo">Kasino</h1>

        {screen === 'GAME' && (
          <div className="contract-banner">
            Runde {roundNumber} · {players[turn]?.name}
            {players[turn]?.type === 'bot' ? ' tænker…' : (turn === activeSeat ? ' — din tur' : ' spiller')}
            {' · '}første til {TARGET_SCORE} point
          </div>
        )}

        <div className="topbar-actions">
          {screen === 'GAME' && (
            <>
              <button className="btn btn-ghost" onClick={() => setAutoAdvance(!autoAdvance)}
                title={autoAdvance ? `Stik forsvinder efter ${TRICK_SHOW_MS / 1000} sek.` : 'Stik bliver stående til du klikker'}>
                {autoAdvance ? 'Auto' : 'Klik'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowStrategy(true)}>Strategi</button>
            </>
          )}
          <button className="btn btn-ghost" onClick={() => setSoundEnabled(!soundEnabled)}>
            {soundEnabled ? '♪ Lyd' : '✕ Lyd'}
          </button>
          <button className="btn btn-ghost" onClick={() => setShowRules(true)}>Regler</button>
        </div>
      </div>

      <div id="layout">
        <div id="table-wrap">
          <div id="table" className={lastTrick ? 'is-revealing' : ''}>

            <Seat slot="top" />
            <Seat slot="left" />
            <Seat slot="right" />

            <div className="deck-pile-wrap">
              {deck.length > 0 ? <span className="deck-pile" /> : <span className="deck-empty" />}
              <span className="deck-count">{deck.length}</span>
            </div>

            {isFinalDeal && (
              <div className="final-banner">
                Sidste omgang · sidste stik giver 1 point og resten af bordet
              </div>
            )}

            <div id="board-area">
              {board.length === 0
                ? <p className="board-empty">Bordet er tomt</p>
                : board.map(item => item.isBuild
                    ? <Build key={item.id} item={item} />
                    : <Card
                        key={item.id}
                        card={item}
                        className={selectedBoardItems.some(i => i.id === item.id) ? 'selected' : 'pickable'}
                        onClick={() => toggleBoardSelection(item)}
                      />)}
            </div>

            {lastTrick && (
              <>
                <div className="reveal-catch" onClick={() => setLastTrick(null)} />
                <div className={`trick-reveal reveal-${players[lastTrick.by]?.slot || 'bottom'}`}
                     onClick={() => setLastTrick(null)}>
                  <div className="reveal-title">{lastTrick.name} tog stikket</div>
                  <div className="reveal-cards">
                    <Card card={lastTrick.played} small className="played" />
                    {lastTrick.taken.length > 0 && <span className="reveal-plus">+</span>}
                    {lastTrick.taken.map(c => <Card key={c.id} card={c} small />)}
                  </div>
                  <div className="reveal-foot">{lastTrick.taken.length + 1} kort · klik for at fortsætte</div>
                </div>
              </>
            )}
          </div>

          <div id="south-seat" className={`seat seat-south ${turn === activeSeat ? 'is-turn' : ''}`}>
            <div className="seat-plate">
              <span className="seat-name">{players[activeSeat]?.name}</span>
              <span className="seat-meta">{scores[activeSeat] || 0} p · {viewHand.length} kort</span>
            </div>
            <div className="hand-mine">
              {viewHand.map(card => (
                <Card
                  key={card.id}
                  card={card}
                  className={`${isMyTurn ? 'playable' : 'blocked'} ${selectedHandCard?.id === card.id ? 'selected' : ''}`}
                  onClick={() => {
                    if (!isMyTurn) return;
                    playSound('click');
                    setSelectedHandCard(selectedHandCard?.id === card.id ? null : card);
                  }}
                />
              ))}
            </div>
          </div>

          <div id="action-bar">
            <span className="action-hint">
              {!isMyTurn
                ? (players[turn]?.type === 'bot' ? `${players[turn]?.name} tænker…` : `Venter på ${players[turn]?.name}`)
                : (legal.hint || 'Vælg en handling')}
            </span>
            <span className="action-buttons">
              {isMyTurn && legal.actions.map(a => (
                <button
                  key={`${a.type}_${a.buildValue ?? 0}`}
                  className={`btn btn-primary act-${a.tone || 'default'}`}
                  onClick={() => executeTurn({
                    type: a.type,
                    handCard: selectedHandCard,
                    boardItems: a.type === 'SPAR_FEM' ? [...board] : selectedBoardItems,
                    buildValue: a.buildValue,
                    groupCount: a.groupCount
                  })}
                >
                  {a.label}
                </button>
              ))}
            </span>
          </div>
        </div>

        <div id="sidebar">
          <div className="panel panel-fill">
            <h3 className="panel-title">Stilling <small>mål {TARGET_SCORE}</small></h3>
            <table id="scoreboard">
              <tbody>
                {standings.map(p => (
                  <tr key={p.id} className={turn === p.id ? 'is-turn' : ''}>
                    <td>{p.name}</td>
                    <td className="num">{sweeps[p.id] || 0} sv.</td>
                    <td className="num">{(captured[p.id] || []).length} k.</td>
                    <td className="num total">{scores[p.id] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="match-status">
              <div className="match-bar">
                <div className="match-bar-fill"
                     style={{ width: `${Math.min((Math.max(0, ...Object.values(scores)) / TARGET_SCORE) * 100, 100)}%` }} />
              </div>
              <div className="match-text">Bunke: {deck.length} kort tilbage</div>
            </div>
          </div>

          <div className="panel panel-grow">
            <h3 className="panel-title">Spillog</h3>
            <ul id="log">
              {gameLog.map((l, i) => (
                <li key={i} className={l.type === 'victory' ? 'hl' : l.type === 'info' ? 'dim' : ''}>
                  {l.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ---------- LOBBY ---------- */}
      {screen === 'LOBBY' && (
        <div className="overlay">
          <div className="modal">
            <h2 className="modal-title">Kasino — opsætning</h2>
            <p className="modal-text">
              Slå pladser til og fra. Der skal være mindst to deltagere. Robotter kan spille
              på to niveauer: <b>Let</b> husker intet, <b>Mia</b> husker alle kort, der har ligget på bordet.
            </p>

            <div className="modal-body">
              {seats.map((seat, idx) => (
                <div key={seat.slot} className={`seat-setup ${seat.active ? '' : 'off'}`}>
                  <button className={`toggle ${seat.active ? 'on' : ''}`} onClick={() => toggleSeat(idx)}>
                    {seat.active ? '✓' : '✕'}
                  </button>

                  <div className="setup-main">
                    <input value={seat.name} disabled={!seat.active}
                           onChange={(e) => setSeatName(idx, e.target.value)} />
                    <span className="setup-pos">{SLOT_NAMES[seat.slot]}</span>
                  </div>

                  <div className="setup-choice">
                    {['human', 'bot'].map(t => (
                      <button key={t} disabled={!seat.active}
                              className={`chip ${seat.type === t ? 'on' : ''}`}
                              onClick={() => setSeatType(idx, t)}>
                        {t === 'human' ? 'Menneske' : 'Robot'}
                      </button>
                    ))}
                  </div>

                  {seat.active && seat.type === 'bot' && (
                    <div className="setup-choice level">
                      {Object.entries(LEVELS).map(([key, lvl]) => (
                        <button key={key} title={lvl.desc}
                                className={`chip ${(seat.level || 'let') === key ? 'on green' : ''}`}
                                onClick={() => setSeatLevel(idx, key)}>
                          {lvl.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <span className="seat-count">{activeSeats.length} deltagere</span>
              <button className="btn btn-ghost" onClick={() => setShowRules(true)}>Regler</button>
              <button className="btn btn-primary" disabled={!canStart} onClick={startNewGame}>
                Start spillet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- REGLER ---------- */}
      {showRules && (
        <div className="overlay" onClick={() => setShowRules(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Regler</h2>
            <div className="rules-body">
              <p>
                2-4 spillere, alle mod alle. Hver runde bruger et helt spil på 52 kort: fire kort
                til hver plus fire på bordet, og derefter fire nye ad gangen, til bunken er tom.
                Første spiller til {TARGET_SCORE} point vinder.
              </p>

              <h4>Kortværdier</h4>
              <ul>
                <li><b>Es:</b> 1 eller 14 ved stik — men altid 1 i et byggeri.</li>
                <li><b>Sulan (Ruder 10):</b> 10 eller 16.</li>
                <li><b>Krabben (Spar 2):</b> 2 eller 15.</li>
                <li><b>Spar 5:</b> rydder altid hele bordet, også når det er tomt. Kan dog ikke spilles,
                    mens du selv har et låst byggeri stående. Ligger den på bordet, er den en almindelig 5'er.</li>
                <li>Øvrige kort har deres pålydende værdi (J=11, Q=12, K=13).</li>
              </ul>

              <h4>Point</h4>
              <ul>
                <li>Sulan 2 · Krabben 1 · hvert es 1 · hver svaber 1</li>
                <li>Sidste stik: 1 point, og du får alle kort der er tilbage på bordet</li>
                <li>Flest kort og flest spar: 1 point hver ved rundens slutning. Uafgjort giver intet.</li>
              </ul>

              <h4>Byggeri</h4>
              <ul>
                <li>Du skal beholde byggeriets værdi på hånden efter trækket.</li>
                <li>Ét sæt kort der summer til værdien = enkelt byggeri. Flere sæt = dobbelt, tripel, firdobbelt.</li>
                <li>Et låst byggeri kan ikke skifte værdi, men godt udvides med endnu en gruppe.</li>
                <li>Har du et byggeri stående, må du kun tage det hjem eller bygge videre på det — du kan hverken smide ud, tage andre stik eller spille Spar 5.</li>
                <li>Alle andre må tage dit byggeri, hvis de har det matchende kort.</li>
              </ul>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowRules(false)}>Luk</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- STRATEGI ---------- */}
      {showStrategy && (
        <div className="overlay" onClick={() => setShowStrategy(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Spilstrategi</h2>
            <div className="rules-body">
              <h4>Hvor pointene ligger</h4>
              <p>
                Der er kun omkring 11 faste point i en runde plus ét pr. svaber, og seks kort bærer
                syv af dem: Ruder 10 (2), de fire esser (4) og Spar 2 (1). Jagt dem frem for store bunker.
              </p>

              <h4>Efterlad aldrig et ryddeligt bord</h4>
              <p>
                Ligger der et byggeri på 10 og en løs 5'er, og du tager femeren, står byggeriet alene
                tilbage — næste spiller med en 10'er får en gratis svaber. Læg hellere et kort ud.
                Husk også, at Krabben tæller 15 og kan tage byggeri 10 og en 5'er i ét greb.
              </p>

              <h4>Hold på de høje kort</h4>
              <p>
                Smid lavt. Lave kort er lette for modstanderne at kombinere i summer; en konge kan kun
                tages af en anden konge eller en sum, der rammer 13 præcist. Målt over 6.000 runder
                koster det 8,5 % af pointene at smide de høje først.
              </p>

              <h4>Byg kun det du kan forsvare</h4>
              <p>
                Et enkelt byggeri er en åben invitation — alle må bygge videre eller snuppe det.
                Byg aldrig med pointkort i. Et låst byggeri kan derimod kun tages med den præcise værdi
                og er stedet at parkere point, du vil sikre.
              </p>

              <h4>Spar er lettere end kort</h4>
              <p>Syv af de 13 spar sikrer pointet. "Flest kort" kræver omkring 27 af 52. Ved lige valg: tag sparret.</p>

              <h4>Sidste stik er to point værd</h4>
              <p>Ét for stikket plus alle kort på bordet — ofte nok til at afgøre "flest kort". Gem et sikkert stik til sidste omgang.</p>

              <h4>Tæl de fire vigtige</h4>
              <p>
                Er Sulan, Krabben og esserne allerede væk, er der kun kort- og spar-flertal samt svabere
                tilbage at spille om — og så skifter strategien fra at jagte enkeltkort til at samle bunke.
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowStrategy(false)}>Luk</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- VINDER ---------- */}
      {winner && (
        <div className="overlay">
          <div className="modal">
            <h2 className="modal-title">Spillet er slut</h2>
            <p className="winner-line">★ {winner.name} vandt med {winner.score} point</p>

            <table className="standings">
              <thead>
                <tr><th>Spiller</th><th>Svabere</th><th>Kort</th><th>Point</th></tr>
              </thead>
              <tbody>
                {standings.map(p => (
                  <tr key={p.id} className={p.id === winner.player ? 'is-winner' : ''}>
                    <td>{p.name}</td>
                    <td>{sweeps[p.id] || 0}</td>
                    <td>{(captured[p.id] || []).length}</td>
                    <td>{scores[p.id] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="modal-text" style={{ marginTop: 14 }}>Efter {roundNumber} runde{roundNumber > 1 ? 'r' : ''}.</p>

            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => { setWinner(null); setPlayers([]); setScreen('LOBBY'); }}>
                Til opsætning
              </button>
              <button className="btn btn-primary" onClick={startNewGame}>Spil igen</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
