/* =============================================================
   game.js
   Spilmotor: giverrotation, meldeproces, trumf/makkeres, byttefase,
   stikafvikling og den fulde pointtabel.
   ============================================================= */

import { Deck, SUITS, SUIT_BY_KEY, RANK_NAMES, cardsOfSuit, findCard } from './card.js';

/* -------------------------------------------------------------
   KONSTANTER
   ------------------------------------------------------------- */

export const VARIANTS = {
  ALM:   'alm',
  VIP:   'vip',
  GODE:  'gode',
  HALVE: 'halve'
};

export const VARIANT_ORDER = [VARIANTS.ALM, VARIANTS.VIP, VARIANTS.GODE, VARIANTS.HALVE];

export const VARIANT_LABEL = {
  [VARIANTS.ALM]:   'Almindelige',
  [VARIANTS.VIP]:   'Vip',
  [VARIANTS.GODE]:  'Gode',
  [VARIANTS.HALVE]: 'Halve'
};

export const SPECIALS = {
  SOL:   'sol',
  REN:   'rensol',
  BORD:  'bordlaegger',
  SUPER: 'superbordlaegger'
};

/**
 * Specialmeldinger.
 *  points      - fast pointgevinst
 *  beatenBy    - den melding der lige akkurat slår den (bruges til rangberegning)
 *  revealAfter - efter hvilket stik spilførerens kort lægges op (0 = fra start)
 *  toppleTrick - hvilket stik spilføreren senest skal væltes på
 */
export const SPECIAL_INFO = {
  [SPECIALS.SOL]:   { label: 'Sol',               points: 3,  beatenBy: { tricks: 9,  variant: VARIANTS.VIP }, revealAfter: 2, toppleTrick: 2, allTableOpen: false, talkAllowed: false },
  [SPECIALS.REN]:   { label: 'Ren Sol',           points: 6,  beatenBy: { tricks: 10, variant: VARIANTS.VIP }, revealAfter: 1, toppleTrick: 1, allTableOpen: false, talkAllowed: false },
  [SPECIALS.BORD]:  { label: 'Bordlægger',        points: 12, beatenBy: { tricks: 11, variant: VARIANTS.VIP }, revealAfter: 1, toppleTrick: 1, allTableOpen: false, talkAllowed: false },
  [SPECIALS.SUPER]: { label: 'Super Bordlægger',  points: 24, beatenBy: { tricks: 12, variant: VARIANTS.VIP }, revealAfter: 0, toppleTrick: 1, allTableOpen: true,  talkAllowed: true  }
};

/** Spillet afvikles altid med fire spillere, der alle er med i hver runde. */
export const PLAYER_COUNT = 4;

/** Standard spillængde hvis intet andet angives. */
export const DEFAULT_TARGET = { mode: 'points', value: 25 };

/** Rimelige grænser, så en tastefejl ikke giver et uendeligt parti. */
export const TARGET_LIMITS = {
  points: { min: 10,  max: 5000, step: 5  },
  rounds: { min: 1,   max: 200,  step: 1  }
};

/** Renser og afgrænser et spillængde-valg. */
export function normaliseTarget(target) {
  const t = target && target.mode ? target : DEFAULT_TARGET;
  const mode = t.mode === 'rounds' ? 'rounds' : 'points';
  const lim = TARGET_LIMITS[mode];
  const raw = Number(t.value);
  const value = Number.isFinite(raw)
    ? Math.min(lim.max, Math.max(lim.min, Math.round(raw)))
    : DEFAULT_TARGET.value;
  return { mode, value };
}

/** Afrunder de brøkdele der kan opstå når en selvmakker ganges op. */
export const round2 = n => Math.round(n * 100) / 100;

/**
 * Ved denne spiller at spilføreren er selvmakker?
 *
 * Ved et rigtigt bord er det en hemmelighed: ingen siger noget, når
 * makkeresset meldes, og spilføreren opdager det først, hvis han bytter og
 * finder esset i katten. Tre gange er det alligevel offentligt:
 *   - specialmeldinger, hvor spilføreren altid spiller alene
 *   - Halve, hvor den med makkeresset melder trumf og dermed afslører sig
 *   - Vip, hvor katten vendes åbent, så alle ser om esset ligger der
 * Og spiller han selv esset, kan alle se det fra det øjeblik.
 *
 * @param {number} seat  den spiller der spørges på
 * @param {object} st    state eller snapshot.state
 */
export function knowsSelfPartner(seat, st) {
  if (!st.selfPartnerTruth) return false;
  if (st.selfPartnerKnown) return true;
  return seat === st.declarer && !!st.declarerSawKitty;
}

export const HAND_SIZE  = 13;
export const KITTY_SIZE = 3;
export const TOTAL_TRICKS = 13;

/**
 * Slå til hvis en joker i katten skal "satse" (fordoble) i Vip.
 * Slået fra som standard, da pointtabellen ikke indregner en fordobling.
 */
export const VIP_JOKER_DOUBLES = false;

/* -------------------------------------------------------------
   POINTTABEL
   Rækkerne er indekseret efter differencen  diff = vundne stik - meldte stik.
   Indeks 0 svarer til diff = -meldte stik (dvs. nul stik hjem),
   sidste indeks svarer til diff = 13 - meldte stik (alle stik hjem).
   Alle rækker har derfor præcis 14 værdier.
   ------------------------------------------------------------- */
export const SCORE_TABLE = {
  7: {
    alm:   [4, 4, 3, 3, 2, 2, 1, 1, 1, 2, 2, 3, 3, 4],
    vip:   [5, 5, 4, 3, 3, 2, 1, 1, 1, 2, 3, 3, 4, 4],
    gode:  [6, 5, 5, 4, 3, 2, 2, 1, 2, 2, 3, 4, 5, 5],
    halve: [8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]
  },
  8: {
    alm:   [9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6],
    vip:   [11, 10, 9, 8, 6, 5, 4, 3, 1, 3, 4, 5, 6, 8],
    gode:  [14, 12, 11, 9, 8, 6, 5, 3, 2, 3, 5, 6, 8, 9],
    halve: [16, 14, 12, 11, 9, 7, 5, 4, 2, 4, 5, 7, 9, 11]
  },
  9: {
    alm:   [20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 4, 6, 8, 10],
    vip:   [25, 23, 20, 18, 15, 13, 10, 8, 5, 3, 5, 8, 10, 13],
    gode:  [30, 27, 24, 21, 18, 15, 12, 9, 6, 3, 6, 9, 12, 15],
    halve: [35, 32, 28, 25, 21, 18, 14, 11, 7, 4, 7, 11, 14, 18]
  },
  10: {
    alm:   [44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 8, 12, 16],
    vip:   [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 10, 15, 20],
    gode:  [66, 60, 54, 48, 42, 36, 30, 24, 18, 12, 6, 12, 18, 24],
    halve: [77, 70, 63, 56, 49, 42, 35, 28, 21, 14, 7, 14, 21, 28]
  },
  11: {
    alm:   [96, 88, 80, 72, 64, 56, 48, 40, 32, 24, 16, 8, 16, 24],
    vip:   [120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 20, 30],
    gode:  [144, 132, 120, 108, 96, 84, 72, 60, 48, 36, 24, 12, 24, 36],
    halve: [168, 154, 140, 126, 112, 98, 84, 70, 56, 42, 28, 14, 28, 42]
  },
  12: {
    alm:   [208, 192, 176, 160, 144, 128, 112, 96, 80, 64, 48, 32, 16, 32],
    vip:   [260, 240, 220, 200, 180, 160, 140, 120, 100, 80, 60, 40, 20, 40],
    gode:  [312, 288, 264, 240, 216, 192, 168, 144, 120, 96, 72, 48, 24, 48],
    halve: [364, 336, 308, 280, 252, 224, 196, 168, 140, 112, 84, 56, 28, 56]
  },
  13: {
    alm:   [448, 416, 384, 352, 320, 288, 256, 224, 192, 160, 128, 96, 64, 32],
    vip:   [560, 520, 480, 440, 400, 360, 320, 280, 240, 200, 160, 120, 80, 40],
    gode:  [672, 624, 576, 528, 480, 432, 384, 336, 288, 240, 192, 144, 96, 48],
    halve: [784, 728, 672, 616, 560, 504, 448, 392, 336, 280, 224, 168, 112, 56]
  }
};

/**
 * Slår grundpointet op i tabellen.
 * @param {number} tricks   meldte stik (7-13)
 * @param {string} variant  'alm' | 'vip' | 'gode' | 'halve'
 * @param {number} won      antal stik spilførersiden fik hjem (0-13)
 * @returns {{points:number, diff:number, made:boolean}}
 */
export function lookupScore(tricks, variant, won) {
  const row = SCORE_TABLE[tricks]?.[variant];
  if (!row) throw new Error(`Ukendt melding: ${tricks} ${variant}`);
  const diff = won - tricks;
  const index = diff + tricks;               // 0 .. 13
  if (index < 0 || index >= row.length) throw new Error(`Stik uden for tabellen: ${won}`);
  return { points: row[index], diff, made: diff >= 0 };
}

/* -------------------------------------------------------------
   BID
   ------------------------------------------------------------- */
export class Bid {
  constructor({ kind, tricks = null, variant = null, special = null }) {
    this.kind    = kind;        // 'pass' | 'normal' | 'special'
    this.tricks  = tricks;
    this.variant = variant;
    this.special = special;
  }

  static pass() { return new Bid({ kind: 'pass' }); }
  static normal(tricks, variant) { return new Bid({ kind: 'normal', tricks, variant }); }
  static special(special) { return new Bid({ kind: 'special', special }); }

  get isPass()    { return this.kind === 'pass'; }
  get isSpecial() { return this.kind === 'special'; }
  get isNormal()  { return this.kind === 'normal'; }

  /** Sand hvis meldingen er en misère hvor spilføreren spiller alene. */
  get isSolo() { return this.isSpecial; }

  /** Esset er lavest i alle specialmeldinger. */
  get aceLow() { return this.isSpecial; }

  /**
   * Numerisk styrke. Almindelige 7 = 0, Halve 13 = 27.
   * Specialmeldinger lægger sig et halvt trin under den melding der slår dem.
   */
  get rank() {
    if (this.isPass) return -1;
    if (this.isNormal) return (this.tricks - 7) * 4 + VARIANT_ORDER.indexOf(this.variant);
    const b = SPECIAL_INFO[this.special].beatenBy;
    return (b.tricks - 7) * 4 + VARIANT_ORDER.indexOf(b.variant) - 0.5;
  }

  get label() {
    if (this.isPass)    return 'Pas';
    if (this.isSpecial) return SPECIAL_INFO[this.special].label;
    return `${this.tricks} ${VARIANT_LABEL[this.variant]}`;
  }

  beats(other) { return !other || this.rank > other.rank; }
}

/** Alle lovlige meldinger der slår `current` (null = alt er lovligt). */
export function legalBids(current) {
  const out = [];
  for (let t = 7; t <= 13; t++) {
    for (const v of VARIANT_ORDER) {
      const b = Bid.normal(t, v);
      if (b.beats(current)) out.push(b);
    }
  }
  for (const s of Object.values(SPECIALS)) {
    const b = Bid.special(s);
    if (b.beats(current)) out.push(b);
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/* -------------------------------------------------------------
   STIKLOGIK
   ------------------------------------------------------------- */

/**
 * Afgør hvem der vinder et stik.
 * Jokeren er et sikkert stik NÅR DEN SPILLES UD. Spilles den i et stik den
 * ikke har åbnet, kan den ikke vinde og fungerer som et frit afkast.
 * @param {{player:number, card:Card}[]} trick
 * @param {string|null} trump
 * @param {boolean} aceLow
 */
export function resolveTrick(trick, trump, aceLow = false) {
  const lead = trick[0];
  if (lead.card.isJoker) return lead.player;

  const ledSuit = lead.card.suit;
  let best = lead;

  for (let i = 1; i < trick.length; i++) {
    const play = trick[i];
    const c = play.card;
    if (c.isJoker) continue;

    const cTrump = !!trump && c.suit === trump;
    const bTrump = !!trump && best.card.suit === trump;

    if (cTrump && !bTrump) { best = play; continue; }
    if (!cTrump && bTrump) continue;
    if (c.suit !== best.card.suit) continue;      // hverken trumf eller udspilskulør
    if (c.suit !== ledSuit && !cTrump) continue;
    if (c.value(aceLow) > best.card.value(aceLow)) best = play;
  }
  return best.player;
}

/**
 * Hvilke kort må spilleren lægge?
 * @param {Card[]} hand
 * @param {{player:number, card:Card}[]} trick   igangværende stik
 * @param {object} ctx  { trickNumber, partnerCard, partnerRevealed }
 */
export function legalCards(hand, trick, ctx = {}) {
  const { trickNumber = 0, partnerCard = null, partnerRevealed = false } = ctx;

  const holdsPartner = partnerCard && !partnerRevealed
    ? findCard(hand, partnerCard.id)
    : null;

  // --- Udspil ---
  if (trick.length === 0) {
    let out = [...hand];

    // Joker må ikke spilles ud i 1. runde.
    if (trickNumber === 0) {
      const noJokers = out.filter(c => !c.isJoker);
      if (noJokers.length) out = noJokers;
    }

    // Makkeresset skal falde første gang kuløren SPILLES - også når det er
    // indehaveren selv der spiller ud. Han må gerne spille en anden kulør ud,
    // men vælger han makkeressets kulør, skal det være esset.
    if (holdsPartner) {
      const withoutSuit = out.filter(c =>
        c.isJoker || c.suit !== partnerCard.suit || c.id === partnerCard.id);
      if (withoutSuit.length) out = withoutSuit;
    }
    return out;
  }

  // --- Bekendelse ---
  const led = trick[0].card;
  if (led.isJoker) return [...hand];                   // ingen kulør at bekende

  const ledSuit = led.suit;

  // Makkeresset SKAL falde første gang kuløren spilles.
  if (holdsPartner && partnerCard.suit === ledSuit) return [holdsPartner];

  const follow = cardsOfSuit(hand, ledSuit);
  if (follow.length) return follow.concat(hand.filter(c => c.isJoker));
  return [...hand];
}

/* -------------------------------------------------------------
   HJÆLPERE
   ------------------------------------------------------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Emitter {
  constructor() { this._h = {}; }
  on(evt, fn)  { (this._h[evt] ||= []).push(fn); return this; }
  emit(evt, payload) { (this._h[evt] || []).forEach(fn => fn(payload)); }
}

/* -------------------------------------------------------------
   GAME
   ------------------------------------------------------------- */
export class Game extends Emitter {
  /**
   * @param {object} cfg
   *   players : [{name, isHuman}]  præcis 4
   *   hostIndex : hvem der fører regnskabet
   *   io : { askBid, askTrump, askPartner, askExchange, askCard, afterTrick, askContinue, showResult }
   *   target : { mode: 'points'|'rounds', value: number }
   *   pace : ms mellem AI-handlinger
   */
  constructor({ players, hostIndex = 0, io, pace = 650, target = null }) {
    super();
    if (players.length !== PLAYER_COUNT) {
      throw new Error(`Spillet kræver præcis ${PLAYER_COUNT} spillere.`);
    }
    this.players = players.map((p, i) => ({ index: i, name: p.name, isHuman: !!p.isHuman }));
    this.hostIndex = hostIndex;
    this.io = io;
    this.pace = pace;

    // Spillængde: enten et pointmål eller et fast antal runder.
    this.target = normaliseTarget(target);

    this.scores  = this.players.map(() => 0);
    this.history = [];                       // en post pr. spillet runde
    this.roundNo = 0;        // nummeret paa den runde der spilles nu
    this.dealNo = 0;         // hvilken givning inden for runden (omgivninger)
    this.roundsPlayed = 0;
    this.winners = [];

    // Første giver er personen efter værten. Turen går med uret.
    this.dealerIndex = (hostIndex + 1) % this.players.length;

    this.state = null;
    this.running = false;
  }

  /* ---------- små hjælpere ---------- */
  get playerCount() { return PLAYER_COUNT; }
  next(i) { return (i + 1) % this.playerCount; }
  prev(i) { return (i - 1 + this.playerCount) % this.playerCount; }
  name(i) { return this.players[i].name; }

  /**
   * Spillerne i den rækkefølge runden afvikles i: udspilleren først,
   * altså personen efter giveren, og derfra med uret.
   */
  activeSeats() {
    const seats = [];
    let i = this.next(this.dealerIndex);
    while (seats.length < PLAYER_COUNT) { seats.push(i); i = this.next(i); }
    return seats;
  }

  log(text, cls = '') { this.emit('log', { text, cls }); }

  async pause(mult = 1) { if (this.pace) await sleep(this.pace * mult); }

  /* =============================================================
     HOVEDLØKKE
     ============================================================= */
  async start() {
    this.running = true;
    this.emit('gameStart', { players: this.players, hostIndex: this.hostIndex, target: this.target });

    while (this.running) {
      await this.playRound();

      if (this.isOver()) {
        this.winners = this.leaders();
        this.log(this.finishText(), 'hl');
        this.emit('gameOver', this.snapshot());
        await this.io.showResult?.(this.snapshot());
        break;
      }

      const cont = await this.io.askContinue?.(this.snapshot());
      if (cont === false) break;
      this.dealerIndex = this.next(this.dealerIndex);   // giverturen går med uret
    }
    this.running = false;
  }

  stop() { this.running = false; }

  /* ---------- spillængde ---------- */

  /** Er partiet slut? Runden gøres altid færdig først. */
  isOver() {
    if (this.target.mode === 'rounds') return this.roundsPlayed >= this.target.value;
    return this.scores.some(v => v >= this.target.value);
  }

  /** Hvor langt er partiet? 0-1, til statuslinjen i UI'et. */
  progress() {
    if (this.target.mode === 'rounds') return Math.min(1, this.roundsPlayed / this.target.value);
    return Math.min(1, Math.max(0, Math.max(...this.scores) / this.target.value));
  }

  /** Spilleren eller spillerne med flest point. */
  leaders() {
    const top = Math.max(...this.scores);
    return this.players.filter(p => this.scores[p.index] === top).map(p => p.index);
  }

  finishText() {
    const names = this.winners.map(i => this.name(i)).join(' og ');
    const top = Math.max(...this.scores);
    const how = this.target.mode === 'rounds'
      ? `${this.target.value} runder er spillet`
      : `${this.target.value} point er nået`;
    return `Partiet er slut – ${how}. ${names} vinder med ${round2(top)} point.`;
  }

  /* =============================================================
     EN RUNDE
     ============================================================= */
  async playRound() {
    // En omgivning er ikke en ny runde. Rundenummeret taeller kun de runder
    // der faktisk bliver spillet, saa regnskabets raekker er sammenhaengende.
    this.roundNo++;
    this.dealNo = 0;
    let contract = null;

    // Der gives om så længe alle melder pas. Samme giver giver om.
    while (contract === null) {
      this.dealNo++;
      await this.dealRound();
      contract = await this.runBidding();
      if (contract === null) {
        this.log(
          `Alle meldte pas – ${this.name(this.dealerIndex)} giver om (${this.dealNo + 1}. givning).`,
          'hl'
        );
        this.emit('redeal', this.snapshot());
        await this.pause(1.4);
      }
    }

    await this.setupContract(contract);
    await this.playTricks();
    this.scoreRound();
    this.roundsPlayed++;
  }

  /* ---------- UDDELING ---------- */
  async dealRound() {
    const seats = this.activeSeats();

    // Der tages hverken af eller bankes: maskinen blander, og bunken bliver
    // aldrig lagt fra sig, så der er intet at tage af.
    const deck = new Deck().shuffle();
    const { hands, kitty } = deck.deal(PLAYER_COUNT, HAND_SIZE, KITTY_SIZE);

    this.state = {
      seats,
      dealer: this.dealerIndex,
      hands: {},              // seat -> Card[]
      kitty,
      discarded: [],
      bids: [],
      contract: null,
      declarer: null,
      partnerCard: null,
      partnerSeat: null,
      selfPartner: false,
      selfPartnerKnown: false,   // er selvmakker offentligt kendt ved bordet?
      declarerSawKitty: false,   // spilføreren byttede og har altså set katten
      partnerRevealed: false,    // makkeresset skal ikke længere falde (faldet, eller taget op af spilføreren)
      partnerFell: false,        // makkeresset er spillet - det kan hele bordet se
      partnerKnown: false,       // sandt i Halve, hvor makkeren afslører sig ved at vælge trumf
      trump: null,
      aceLow: false,
      exchanged: false,
      openHands: [],          // seats hvis kort er lagt op
      trick: [],
      trickNumber: 0,
      played: [],             // alle spillede kort i raekkefolge (til renonce-udledning)
      kittyRevealed: false,   // sandt i Vip, hvor katten vendes aabent
      shownKitty: [],         // kattens kort som alle så i Vip, før spilføreren byttede
      tricksWon: {},          // seat -> antal
      leader: this.next(this.dealerIndex),
      toppled: false,
      finished: false
    };
    seats.forEach((s, i) => {
      this.state.hands[s] = hands[i];
      this.state.tricksWon[s] = 0;
    });
    // Udspil i 1. stik foretages af personen efter kortgiveren.
    this.state.leader = seats[0];

    const again = this.dealNo > 1 ? ` (${this.dealNo}. givning)` : '';
    this.log(`— Runde ${this.roundNo}: ${this.name(this.dealerIndex)} giver${again} —`, 'hl');
    this.emit('dealt', this.snapshot());
    await this.pause(1.2);
  }

  /* ---------- MELDERUNDE (tilbage, ikke rundt) ---------- */
  async runBidding() {
    const st = this.state;
    const queue = [...st.seats];        // starter med spilleren efter giveren
    let holder = null;
    let high = null;

    this.emit('biddingStart', this.snapshot());

    while (queue.length) {
      const seat = queue.shift();
      this.emit('turn', { seat, phase: 'bidding' });

      const bid = await this.io.askBid(seat, {
        current: high,
        currentHolder: holder,
        hand: st.hands[seat],
        snapshot: this.snapshot()
      });

      st.bids.push({ seat, bid });
      this.log(`${this.name(seat)}: ${bid.label}`, bid.isPass ? 'dim' : '');
      this.emit('bid', { seat, bid, snapshot: this.snapshot() });
      await this.pause(0.6);

      if (bid.isPass) continue;                 // spilleren er ude af meldingen
      if (!bid.beats(high)) continue;           // sikkerhedsnet – bør ikke ske

      if (holder !== null) queue.unshift(holder);   // den forrige melder skal svare igen
      holder = seat;
      high = bid;
    }

    if (holder === null || high === null) return null;

    this.log(`${this.name(holder)} spiller ${high.label}.`, 'hl');
    return { seat: holder, bid: high };
  }

  /* ---------- TRUMF, MAKKERES OG BYTTE ---------- */
  async setupContract({ seat, bid }) {
    const st = this.state;
    st.contract = bid;
    st.declarer = seat;
    st.aceLow = bid.aceLow;

    this.emit('contract', this.snapshot());

    /* ----- Specialmeldinger: alene, ingen trumf, esset lavest ----- */
    if (bid.isSpecial) {
      const info = SPECIAL_INFO[bid.special];
      st.trump = null;
      st.selfPartner = true;
      // Spilfoereren spiller alene mod tre, og det er aabenlyst for hele bordet.
      st.selfPartnerKnown = true;
      if (info.allTableOpen) {
        st.openHands = [...st.seats];
        this.log('Super Bordlægger: alle lægger kortene op, og modspillerne må snakke sammen.', 'hl');
      } else if (info.revealAfter === 0) {
        st.openHands = [seat];
      }
      this.emit('contractReady', this.snapshot());
      await this.pause(1.2);
      return;
    }

    /* ----- Gode: klør er altid trumf ----- */
    if (bid.variant === VARIANTS.GODE) {
      st.trump = 'clubs';
      this.log('Gode – Klør er trumf.', 'hl');
    }

    /* ----- Vip: byttekortene vender trumf ét ad gangen ----- */
    if (bid.variant === VARIANTS.VIP) {
      st.trump = await this.revealVipTrump();
    }

    /* ----- Halve: makkeres først, derefter vælger makkeren trumf ----- */
    if (bid.variant === VARIANTS.HALVE) {
      await this.choosePartnerCard(seat, null);
      const chooser = st.selfPartner ? seat : st.partnerSeat;
      st.partnerKnown = !st.selfPartner;      // trumfvalget afslører makkeren for hele bordet
      const forbidden = st.partnerCard.suit;
      st.trump = await this.io.askTrump(chooser, {
        forbidden: [forbidden],
        hand: st.hands[chooser],
        snapshot: this.snapshot(),
        reason: st.selfPartner
          ? 'Makkeresset lå i katten – du er selvmakker og vælger selv trumf (ikke makkeressets kulør).'
          : 'Du har makkeresset og vælger trumf – dog ikke makkeressets egen kulør.'
      });
      this.log(`${this.name(chooser)} vælger ${SUIT_BY_KEY[st.trump].name} som trumf.`, 'hl');
    }

    /* ----- Almindelige: frit valg af trumf inkl. klør ----- */
    if (bid.variant === VARIANTS.ALM) {
      st.trump = await this.io.askTrump(seat, {
        forbidden: [],
        hand: st.hands[seat],
        snapshot: this.snapshot(),
        reason: 'Almindelige – vælg frit hvilken kulør der skal være trumf (klør er tilladt).'
      });
      this.log(`${this.name(seat)} melder ${SUIT_BY_KEY[st.trump].name} som trumf.`, 'hl');
    }

    /* ----- Makkeres for alle andre end Halve (der er den allerede valgt) ----- */
    if (bid.variant !== VARIANTS.HALVE) {
      await this.choosePartnerCard(seat, st.trump);
    }

    /* ----- Byttefasen ----- */
    await this.runExchange();

    this.emit('contractReady', this.snapshot());
    await this.pause(1);
  }

  /**
   * Vip: byttekortene vendes ét ad gangen og bestemmer trumf.
   * En joker "satser på" det forrige kort, dvs. trumfen bliver stående.
   * Tre jokere betyder uden trumf.
   */
  async revealVipTrump() {
    const st = this.state;
    let trump = null;
    let jokers = 0;
    st.kittyRevealed = true;
    st.shownKitty = st.kitty.slice();

    for (let i = 0; i < st.kitty.length; i++) {
      const card = st.kitty[i];
      this.emit('kittyFlip', { index: i, card, snapshot: this.snapshot() });
      await this.pause(0.9);

      if (card.isJoker) {
        jokers++;
        this.log(`Katten vender ${card.label} – satser på forrige kort.`, 'dim');
      } else {
        trump = card.suit;
        this.log(`Katten vender ${card.label} – ${SUIT_BY_KEY[trump].name} er trumf.`, 'dim');
      }
    }

    if (jokers === 3) {
      trump = null;
      this.log('Tre jokere i katten – der spilles UDEN trumf.', 'hl');
    } else {
      this.log(`Vip: ${SUIT_BY_KEY[trump].name} er trumf.`, 'hl');
    }
    st.vipJokers = jokers;
    if (VIP_JOKER_DOUBLES && jokers > 0) st.vipMultiplier = Math.pow(2, jokers);
    return trump;
  }

  /**
   * Spilføreren melder makkeres.
   * Man må ikke melde trumfkuløren og ikke et es man selv har.
   * Har man alle brugbare esser, meldes der til en konge.
   */
  async choosePartnerCard(seat, trump) {
    const st = this.state;
    const hand = st.hands[seat];
    const holdsId = new Set(hand.map(c => c.id));

    const suitPool = SUITS.map(s => s.key).filter(k => !trump || k !== trump);

    // Man melder til et es. Har man dem alle, rykker man ned til en konge -
    // og i de meget sjaeldne tilfaelde hvor de ogsaa ligger paa haanden, videre nedad.
    const ladder = ['A', 'K', 'Q', 'J', '10'];
    let candidates = [];
    let usedRank = 'A';
    for (const rank of ladder) {
      candidates = suitPool
        .map(k => ({ rank, suit: k, id: `${rank}-${k}` }))
        .filter(c => !holdsId.has(c.id));
      if (candidates.length) { usedRank = rank; break; }
    }
    const toKing = usedRank !== 'A';
    if (toKing) {
      const rankName = RANK_NAMES[usedRank]?.toLowerCase() ?? usedRank;
      this.log(`${this.name(seat)} har alle brugbare esser og melder til en ${rankName}.`, 'dim');
    }

    const chosenId = await this.io.askPartner(seat, {
      candidates,
      toKing,
      trump,
      hand,
      snapshot: this.snapshot()
    });

    const chosen = candidates.find(c => c.id === chosenId) || candidates[0];
    if (!chosen) throw new Error('Ingen mulige makkerkort - dette bør ikke kunne ske.');

    // Find det faktiske kortobjekt – enten på en hånd eller i katten.
    let partnerCard = null, partnerSeat = null;
    for (const s of st.seats) {
      const hit = findCard(st.hands[s], chosen.id);
      if (hit) { partnerCard = hit; partnerSeat = s; break; }
    }
    if (!partnerCard) partnerCard = findCard(st.kitty, chosen.id);

    st.partnerCard = partnerCard;
    st.partnerSeat = partnerSeat;
    st.selfPartner = partnerSeat === null || partnerSeat === seat;

    // Hvornår kan bordet se at spilføreren er selvmakker?
    const bid = st.contract;
    st.selfPartnerKnown = st.selfPartner && (
      bid.isSolo ||
      bid.variant === VARIANTS.HALVE ||
      (st.kittyRevealed && st.kitty.some(c => c.id === partnerCard.id))
    );

    this.log(`${this.name(seat)} melder til ${partnerCard.longLabel}.`, 'hl');
    if (st.selfPartnerKnown) {
      this.log('Makkeresset lå i katten – spilføreren er selvmakker.', 'hl');
    }

    this.emit('partnerChosen', this.snapshot());
    await this.pause(0.8);
  }

  /** Byttefasen: alt eller intet. Der SKAL byttes i Vip. */
  async runExchange() {
    const st = this.state;
    const seat = st.declarer;
    const mustSwap = st.contract.variant === VARIANTS.VIP;

    const res = await this.io.askExchange(seat, {
      kitty: st.kitty,
      hand: st.hands[seat],
      mustSwap,
      trump: st.trump,
      partnerCard: st.partnerCard,
      snapshot: this.snapshot()
    });

    if (!res || !res.take) {
      if (mustSwap) throw new Error('Der SKAL byttes i Vip.');
      this.log(`${this.name(seat)} bytter ikke.`, 'dim');
      this.emit('exchange', { seat, took: false, snapshot: this.snapshot() });
      return;
    }

    const combined = st.hands[seat].concat(st.kitty);
    const discard = res.discardIds.map(id => findCard(combined, id)).filter(Boolean);
    if (discard.length !== KITTY_SIZE) throw new Error('Der skal smides præcis 3 kort.');

    const discardIds = new Set(discard.map(c => c.id));
    st.hands[seat] = combined.filter(c => !discardIds.has(c.id));
    st.discarded = discard;
    st.kitty = discard;                        // de smidte kort er den nye, døde kat
    st.exchanged = true;
    st.declarerSawKitty = true;                // han har set katten og ved nu hvad der lå

    // Han opdager selv at esset lå i katten. Det siger han ikke højt.
    if (st.selfPartner && !st.selfPartnerKnown && this.players[seat].isHuman) {
      this.log('Makkeresset lå i katten – du er selvmakker. Det ved de andre ikke.', 'hl');
    }

    // Lå makkeresset i katten og blev det taget op, er spilføreren stadig selvmakker,
    // men kortet er nu på hans egen hånd og skal ikke længere falde som makkeres.
    if (st.partnerCard && !discardIds.has(st.partnerCard.id) &&
        findCard(st.hands[seat], st.partnerCard.id)) {
      st.partnerRevealed = true;
    }

    this.log(`${this.name(seat)} bytter alle 3 kort med katten.`, '');
    this.emit('exchange', { seat, took: true, discard, snapshot: this.snapshot() });
    await this.pause(1.2);
  }

  /* =============================================================
     STIKFASEN
     ============================================================= */
  async playTricks() {
    const st = this.state;
    const solo = st.contract.isSolo;
    const info = solo ? SPECIAL_INFO[st.contract.special] : null;

    this.emit('playStart', this.snapshot());

    for (let t = 0; t < TOTAL_TRICKS; t++) {
      st.trickNumber = t;
      st.trick = [];
      this.emit('trickStart', { trickNumber: t, leader: st.leader, snapshot: this.snapshot() });

      let seat = st.leader;
      for (let n = 0; n < 4; n++) {
        const legal = legalCards(st.hands[seat], st.trick, {
          trickNumber: t,
          partnerCard: st.partnerCard,
          partnerRevealed: st.partnerRevealed
        });

        this.emit('turn', { seat, phase: 'play', legal });

        const cardId = await this.io.askCard(seat, {
          legal,
          hand: st.hands[seat],
          trick: st.trick,
          snapshot: this.snapshot()
        });

        const card = findCard(legal, cardId) || legal[0];
        st.hands[seat] = st.hands[seat].filter(c => c.id !== card.id);
        st.trick.push({ player: seat, card });
        st.played.push({ seat, card, trickNumber: t });

        if (st.partnerCard && card.id === st.partnerCard.id) {
          st.partnerRevealed = true;
          st.partnerFell = true;
          if (!solo) {
            // Spiller spilføreren selv esset, har han taget det op fra katten.
            const self = seat === st.declarer;
            if (self) st.selfPartnerKnown = true;
            this.log(self
              ? `Makkeresset faldt hos ${this.name(seat)} selv – han er selvmakker!`
              : `Makkeresset faldt – ${this.name(seat)} er makker!`, 'hl');
            this.emit('partnerRevealed', { seat, self, snapshot: this.snapshot() });
          }
        }

        this.emit('cardPlayed', { seat, card, snapshot: this.snapshot() });
        await this.pause(0.55);
        seat = this.nextSeat(seat);
      }

      const winner = resolveTrick(st.trick, st.trump, st.aceLow);
      st.tricksWon[winner]++;
      this.log(`Stik ${t + 1}: ${this.name(winner)} (${st.trick.map(p => p.card.label).join(' ')})`);
      this.emit('trickEnd', { winner, trick: st.trick, snapshot: this.snapshot() });
      if (this.io.afterTrick) await this.io.afterTrick(winner, this.snapshot());
      await this.pause(0.5);

      st.leader = winner;

      /* --- Specialmeldinger: kortene lægges op efter det aftalte stik --- */
      if (solo && info.revealAfter > 0 && t + 1 === info.revealAfter) {
        st.openHands = [st.declarer];
        this.log(`${info.label}: ${this.name(st.declarer)} lægger kortene op.`, 'hl');
        this.emit('reveal', this.snapshot());
        await this.pause(1);
      }

      /* --- Misère: spilføreren er væltet i det øjeblik han tager et stik --- */
      if (solo && winner === st.declarer) {
        st.toppled = true;
        this.log(`${this.name(st.declarer)} er væltet på stik ${t + 1}.`, 'hl');
        break;
      }
    }

    st.finished = true;
    this.emit('playEnd', this.snapshot());
  }

  /** Næste spiller med uret. */
  nextSeat(seat) {
    const seats = this.state.seats;
    return seats[(seats.indexOf(seat) + 1) % seats.length];
  }

  /* =============================================================
     POINTBEREGNING
     ============================================================= */
  scoreRound() {
    const st = this.state;
    const bid = st.contract;
    const declarer = st.declarer;

    // Spilførersiden
    const declaring = [declarer];
    if (!bid.isSolo && !st.selfPartner && st.partnerSeat !== null) declaring.push(st.partnerSeat);
    const defenders = st.seats.filter(s => !declaring.includes(s));

    let basePoints, made, detail;

    if (bid.isSolo) {
      const info = SPECIAL_INFO[bid.special];
      basePoints = info.points;
      made = !st.toppled;                       // spilføreren må ikke tage et eneste stik
      detail = made
        ? `${info.label} holdt`
        : `${info.label} væltet på stik ${st.trickNumber + 1}`;
    } else {
      const won = declaring.reduce((sum, s) => sum + st.tricksWon[s], 0);
      const r = lookupScore(bid.tricks, bid.variant, won);
      basePoints = r.points * (st.vipMultiplier || 1);
      made = r.made;
      detail = `${won} stik hjem (${r.diff >= 0 ? '+' : ''}${r.diff})`;
    }

    // Regnskabet skal gå i nul: den mindre part ganges op.
    const k = declaring.length;
    const m = defenders.length;
    const perDeclarer = basePoints * (m / k);
    const perDefender = basePoints;
    const sign = made ? 1 : -1;

    const delta = this.players.map(() => 0);
    declaring.forEach(s => { delta[s] = sign * perDeclarer; });
    defenders.forEach(s => { delta[s] = -sign * perDefender; });

    delta.forEach((d, i) => { this.scores[i] += d; });

    const record = {
      round: this.roundNo,
      deals: this.dealNo,            // 1 = ingen omgivning
      dealer: st.dealer,
      declarer,
      partnerSeat: st.selfPartner ? null : st.partnerSeat,
      partnerCard: st.partnerCard,
      contract: bid,
      trump: st.trump,
      tricksWon: { ...st.tricksWon },
      made,
      basePoints,
      detail,
      delta,
      totals: [...this.scores]
    };
    this.history.push(record);

    if (st.selfPartner && !bid.isSolo && !st.selfPartnerKnown) {
      this.log(`Makkeresset lå i katten – ${this.name(declarer)} var selvmakker hele runden.`, 'hl');
    }
    this.log(
      `${bid.label} – ${detail}. ${made ? 'Spillet holdt' : 'Spillet gik ned'} (${basePoints} p.)`,
      'hl'
    );
    this.emit('roundScored', { record, snapshot: this.snapshot() });
    return record;
  }

  /* =============================================================
     SNAPSHOT TIL UI
     ============================================================= */
  snapshot() {
    const st = this.state;
    return {
      players: this.players,
      hostIndex: this.hostIndex,
      scores: [...this.scores],
      history: this.history,
      roundNo: this.roundNo,
      dealNo: this.dealNo,
      roundsPlayed: this.roundsPlayed,
      target: this.target,
      progress: this.progress(),
      over: this.isOver(),
      winners: this.winners,
      dealer: this.dealerIndex,
      state: st ? {
        seats: st.seats,
        hands: st.hands,
        kitty: st.kitty,
        bids: st.bids,                 // [{seat, bid}] i den rækkefølge de blev meldt
        contract: st.contract,
        declarer: st.declarer,
        partnerCard: st.partnerCard,
        // Makkerens identitet er skjult indtil esset falder - undtagen i Halve,
        // hvor han afslører sig ved at vælge trumf.
        partnerSeat: st.partnerFell || st.partnerKnown ? st.partnerSeat : null,
        // selfPartner er det OFFENTLIGE billede; sandheden ligger i selfPartnerTruth.
        selfPartner: st.selfPartnerKnown ? st.selfPartner : false,
        selfPartnerTruth: st.selfPartner,
        selfPartnerKnown: st.selfPartnerKnown,
        declarerSawKitty: st.declarerSawKitty,
        // Offentligt: er makkeresset spillet? At spilføreren har taget det op
        // fra katten, er hans hemmelighed og vises ikke her.
        partnerRevealed: st.partnerFell,
        partnerKnown: st.partnerKnown,
        trump: st.trump,
        aceLow: st.aceLow,
        openHands: st.openHands,
        trick: st.trick,
        trickNumber: st.trickNumber,
        played: st.played,
        discarded: st.discarded,
        exchanged: st.exchanged,
        kittyRevealed: st.kittyRevealed,
        shownKitty: st.shownKitty,
        tricksWon: st.tricksWon,
        leader: st.leader,
        toppled: st.toppled,
        finished: st.finished
      } : null
    };
  }
}
