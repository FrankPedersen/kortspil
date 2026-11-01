/* =============================================================
   card.js
   Card- og Deck-klasser: 52 standardkort + 3 jokere = 55 kort.
   ============================================================= */

/** De fire kulører. Rækkefølgen bruges kun til sortering på hånden. */
export const SUITS = [
  { key: 'clubs',    symbol: '♣', name: 'Klør',    color: 'black' },
  { key: 'diamonds', symbol: '♦', name: 'Ruder',   color: 'red'   },
  { key: 'hearts',   symbol: '♥', name: 'Hjerter', color: 'red'   },
  { key: 'spades',   symbol: '♠', name: 'Spar',    color: 'black' }
];

export const SUIT_BY_KEY = Object.fromEntries(SUITS.map(s => [s.key, s]));

/** Rangfølge fra lav til høj. Esset håndteres særskilt (højt/lavt). */
export const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

/** Danske navne på billedkort og es. Talkort hedder blot deres tal. */
export const RANK_NAMES = { 'J': 'Knægt', 'Q': 'Dame', 'K': 'Konge', 'A': 'Es' };

/** Antal jokere i spillet. */
export const JOKER_COUNT = 3;

/** Jokerens "navne" så de kan skelnes i UI og log. */
const JOKER_LABELS = ['Joker I', 'Joker II', 'Joker III'];

/* -------------------------------------------------------------
   CARD
   ------------------------------------------------------------- */
export class Card {
  /**
   * @param {string|null} suit  kulørnøgle ('clubs' ...) eller null for joker
   * @param {string|null} rank  '2'..'10','J','Q','K','A' eller null for joker
   * @param {number} jokerNo    0-baseret jokernummer (kun for jokere)
   */
  constructor(suit, rank, jokerNo = -1) {
    this.suit = suit;
    this.rank = rank;
    this.jokerNo = jokerNo;
    this.isJoker = jokerNo >= 0;
    this.id = this.isJoker ? `JK${jokerNo}` : `${rank}-${suit}`;
  }

  get suitInfo() { return this.suit ? SUIT_BY_KEY[this.suit] : null; }
  get symbol()   { return this.suit ? SUIT_BY_KEY[this.suit].symbol : '★'; }
  get color()    { return this.suit ? SUIT_BY_KEY[this.suit].color : 'joker'; }
  get isAce()    { return this.rank === 'A'; }
  get isKing()   { return this.rank === 'K'; }
  get isCourt()  { return ['J','Q','K','A'].includes(this.rank); }

  /**
   * Talværdi til sammenligning af stik.
   * @param {boolean} aceLow  true i Sol, Ren Sol, Bordlægger og Super Bordlægger,
   *                          hvor esset er det LAVESTE kort.
   */
  value(aceLow = false) {
    if (this.isJoker) return 0;                 // jokeren sammenlignes aldrig på værdi
    if (this.rank === 'A') return aceLow ? 1 : 14;
    return RANKS.indexOf(this.rank) + 2;        // '2' -> 2 ... 'K' -> 13
  }

  /** Kort tekstform, fx "K♠" eller "Joker II". */
  get label() {
    return this.isJoker ? JOKER_LABELS[this.jokerNo] : `${this.rank}${this.symbol}`;
  }

  /** Lang tekstform til log og beskeder, fx "Konge i Spar". */
  get longLabel() {
    if (this.isJoker) return JOKER_LABELS[this.jokerNo];
    return `${RANK_NAMES[this.rank] || this.rank} i ${SUIT_BY_KEY[this.suit].name}`;
  }

  toString() { return this.label; }
}

/* -------------------------------------------------------------
   DECK
   ------------------------------------------------------------- */
export class Deck {
  constructor() { this.cards = Deck.buildFullDeck(); }

  /** Bygger 52 kort + 3 jokere. */
  static buildFullDeck() {
    const cards = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) cards.push(new Card(suit.key, rank));
    }
    for (let j = 0; j < JOKER_COUNT; j++) cards.push(new Card(null, null, j));
    return cards;
  }

  get size() { return this.cards.length; }

  /** Fisher-Yates blanding. */
  shuffle() {
    const c = this.cards;
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [c[i], c[j]] = [c[j], c[i]];
    }
    return this;
  }

  /**
   * "At tage af": bunken deles og de to halvdele byttes.
   * Spilleren bagved giveren kan i stedet "banke", hvilket springer aftagningen over.
   * @param {number|null} at  skæringspunkt; tilfældigt hvis udeladt
   */
  cut(at = null) {
    const n = this.cards.length;
    const idx = at === null ? 5 + Math.floor(Math.random() * (n - 10)) : at;
    this.cards = this.cards.slice(idx).concat(this.cards.slice(0, idx));
    return this;
  }

  /** Trækker n kort fra toppen. */
  draw(n) { return this.cards.splice(0, n); }

  /**
   * Deler ud til et helt bord.
   * @param {number} activeCount  antal aktive spillere (altid 4)
   * @param {number} handSize     kort pr. spiller (13)
   * @param {number} kittySize    kort i katten (3)
   * @returns {{hands: Card[][], kitty: Card[]}}
   */
  deal(activeCount = 4, handSize = 13, kittySize = 3) {
    const needed = activeCount * handSize + kittySize;
    if (this.cards.length < needed) {
      throw new Error(`Kortbunken har kun ${this.cards.length} kort, men ${needed} kræves.`);
    }
    const hands = Array.from({ length: activeCount }, () => []);

    // Der gives i pakker på 3-3-3-4, som man gør ved bordet.
    const packets = [3, 3, 3, 4];
    for (const size of packets) {
      for (let p = 0; p < activeCount; p++) hands[p].push(...this.draw(size));
    }
    const kitty = this.draw(kittySize);
    return { hands, kitty };
  }
}

/* -------------------------------------------------------------
   HJÆLPEFUNKTIONER
   ------------------------------------------------------------- */

/** Sorterer en hånd pænt: jokere først, derefter kulør og rang. */
export function sortHand(cards, aceLow = false) {
  const order = SUITS.map(s => s.key);
  return [...cards].sort((a, b) => {
    if (a.isJoker !== b.isJoker) return a.isJoker ? -1 : 1;
    if (a.isJoker && b.isJoker) return a.jokerNo - b.jokerNo;
    const s = order.indexOf(a.suit) - order.indexOf(b.suit);
    if (s !== 0) return s;
    return b.value(aceLow) - a.value(aceLow);
  });
}

/** Alle kort i en bestemt kulør (jokere tæller aldrig med i en kulør). */
export function cardsOfSuit(cards, suit) {
  return cards.filter(c => !c.isJoker && c.suit === suit);
}

/** Finder et kort ud fra id i en samling. */
export function findCard(cards, id) {
  return cards.find(c => c.id === id) || null;
}

/** Bygger id'et for et almindeligt kort uden at instantiere et Card. */
export function cardId(rank, suit) { return `${rank}-${suit}`; }
