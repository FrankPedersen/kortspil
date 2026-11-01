import { randomInt } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import {
  prepareEsMakkerDeal,
  getEsMakkerLegalCards,
  type EsMakkerBid,
  type EsMakkerCard,
  type EsMakkerGameState,
} from './state.js';
import { LobbyError } from '../lobby/types.js';

const suits = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const variants = ['alm', 'vip', 'gode', 'halve'] as const;
const specialBids = [
  { special: 'sol', tricks: 9, variant: 'vip' },
  { special: 'rensol', tricks: 10, variant: 'vip' },
  { special: 'bordlaegger', tricks: 11, variant: 'vip' },
  { special: 'superbordlaegger', tricks: 12, variant: 'vip' },
] as const;
const specialPoints: Record<string, number> = {
  sol: 3,
  rensol: 6,
  bordlaegger: 12,
  superbordlaegger: 24,
};
const scoreTable: Record<number, Record<string, number[]>> = {
  7: {
    alm: [4, 4, 3, 3, 2, 2, 1, 1, 1, 2, 2, 3, 3, 4],
    vip: [5, 5, 4, 3, 3, 2, 1, 1, 1, 2, 3, 3, 4, 4],
    gode: [6, 5, 5, 4, 3, 2, 2, 1, 2, 2, 3, 4, 5, 5],
    halve: [8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7],
  },
  8: {
    alm: [9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6],
    vip: [11, 10, 9, 8, 6, 5, 4, 3, 1, 3, 4, 5, 6, 8],
    gode: [14, 12, 11, 9, 8, 6, 5, 3, 2, 3, 5, 6, 8, 9],
    halve: [16, 14, 12, 11, 9, 7, 5, 4, 2, 4, 5, 7, 9, 11],
  },
  9: {
    alm: [20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 4, 6, 8, 10],
    vip: [25, 23, 20, 18, 15, 13, 10, 8, 5, 3, 5, 8, 10, 13],
    gode: [30, 27, 24, 21, 18, 15, 12, 9, 6, 3, 6, 9, 12, 15],
    halve: [35, 32, 28, 25, 21, 18, 14, 11, 7, 4, 7, 11, 14, 18],
  },
  10: {
    alm: [44, 40, 36, 32, 28, 24, 20, 16, 12, 8, 4, 8, 12, 16],
    vip: [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 10, 15, 20],
    gode: [66, 60, 54, 48, 42, 36, 30, 24, 18, 12, 6, 12, 18, 24],
    halve: [77, 70, 63, 56, 49, 42, 35, 28, 21, 14, 7, 14, 21, 28],
  },
  11: {
    alm: [96, 88, 80, 72, 64, 56, 48, 40, 32, 24, 16, 8, 16, 24],
    vip: [120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 20, 30],
    gode: [144, 132, 120, 108, 96, 84, 72, 60, 48, 36, 24, 12, 24, 36],
    halve: [168, 154, 140, 126, 112, 98, 84, 70, 56, 42, 28, 14, 28, 42],
  },
  12: {
    alm: [208, 192, 176, 160, 144, 128, 112, 96, 80, 64, 48, 32, 16, 32],
    vip: [260, 240, 220, 200, 180, 160, 140, 120, 100, 80, 60, 40, 20, 40],
    gode: [312, 288, 264, 240, 216, 192, 168, 144, 120, 96, 72, 48, 24, 48],
    halve: [364, 336, 308, 280, 252, 224, 196, 168, 140, 112, 84, 56, 28, 56],
  },
  13: {
    alm: [448, 416, 384, 352, 320, 288, 256, 224, 192, 160, 128, 96, 64, 32],
    vip: [560, 520, 480, 440, 400, 360, 320, 280, 240, 200, 160, 120, 80, 40],
    gode: [672, 624, 576, 528, 480, 432, 384, 336, 288, 240, 192, 144, 96, 48],
    halve: [784, 728, 672, 616, 560, 504, 448, 392, 336, 280, 224, 168, 112, 56],
  },
};

const BidSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('normal'),
    tricks: Type.Integer({ minimum: 7, maximum: 13 }),
    variant: Type.Union(variants.map(variant => Type.Literal(variant))),
  }),
  Type.Object({
    kind: Type.Literal('special'),
    special: Type.Union(specialBids.map(item => Type.Literal(item.special))),
  }),
]);

export const EsMakkerActionSchema = Type.Object({
  type: Type.Union([
    Type.Literal('pass'),
    Type.Literal('bid'),
    Type.Literal('choose-trump'),
    Type.Literal('choose-partner'),
    Type.Literal('exchange'),
    Type.Literal('play-card'),
  ]),
  bid: Type.Optional(BidSchema),
  suit: Type.Optional(Type.Union(suits.map(suit => Type.Literal(suit)))),
  cardId: Type.Optional(Type.String({ minLength: 3, maxLength: 16 })),
  take: Type.Optional(Type.Boolean()),
  discardIds: Type.Optional(Type.Array(
    Type.String({ minLength: 3, maxLength: 16 }),
    { minItems: 3, maxItems: 3 },
  )),
}, { additionalProperties: false });

export type EsMakkerAction =
  | { type: 'pass' }
  | { type: 'bid'; bid: EsMakkerBid }
  | { type: 'choose-trump'; suit: typeof suits[number] }
  | { type: 'choose-partner'; cardId: string }
  | { type: 'exchange'; take: boolean; discardIds?: string[] }
  | { type: 'play-card'; cardId: string };

export function legalEsMakkerBids(current: EsMakkerBid | null): EsMakkerBid[] {
  const all: EsMakkerBid[] = [];
  for (let tricks = 7; tricks <= 13; tricks += 1) {
    for (const variant of variants) all.push({ kind: 'normal', tricks, variant });
  }
  for (const item of specialBids) {
    all.push({ kind: 'special', special: item.special });
  }
  return all.filter(bid => current === null || bidRank(bid) > bidRank(current));
}

export function applyEsMakkerAction(
  state: EsMakkerGameState,
  seatNumber: number,
  expectedVersion: number,
  action: EsMakkerAction,
): EsMakkerGameState {
  if (state.version !== expectedVersion) {
    throw new LobbyError(409, 'The game changed. Refresh the table and try again.');
  }
  if (state.phase === 'finished') throw new LobbyError(409, 'This game has finished.');
  if (state.turnSeat !== seatNumber) throw new LobbyError(409, 'It is not your turn.');
  validateActionShape(action);

  const next = structuredClone(state);
  switch (action.type) {
    case 'pass':
      requirePhase(next, 'bidding');
      next.bids.push({ seatNumber, kind: 'pass', bid: null });
      advanceAuction(next, null);
      break;
    case 'bid':
      requirePhase(next, 'bidding');
      if (!isBid(action.bid) ||
          !legalEsMakkerBids(next.highBid).some(bid => sameBid(bid, action.bid))) {
        throw new LobbyError(400, 'This bid does not beat the current bid.');
      }
      next.bids.push({ seatNumber, kind: 'bid', bid: action.bid });
      advanceAuction(next, action.bid);
      break;
    case 'choose-trump':
      requirePhase(next, 'trump');
      if (!suits.includes(action.suit) ||
          next.contract?.kind !== 'normal' ||
          (next.contract.variant === 'halve' && next.partnerCard?.suit === action.suit)) {
        throw new LobbyError(400, 'This trump suit is not allowed.');
      }
      next.trump = action.suit;
      if (next.contract.variant === 'halve') {
        next.partnerKnown = !next.selfPartner;
        enterExchange(next);
      } else {
        next.phase = 'partner';
        next.turnSeat = next.declarerSeat ?? seatNumber;
      }
      break;
    case 'choose-partner':
      requirePhase(next, 'partner');
      choosePartner(next, seatNumber, action.cardId);
      break;
    case 'exchange':
      requirePhase(next, 'exchange');
      exchangeCards(next, seatNumber, action);
      break;
    case 'play-card':
      requirePhase(next, 'playing');
      playCard(next, seatNumber, action.cardId);
      break;
  }

  next.version += 1;
  return next;
}

function advanceAuction(state: EsMakkerGameState, newBid: EsMakkerBid | null): void {
  const queue = [...state.bidQueue];
  const actor = queue.shift();
  if (actor === undefined) throw new LobbyError(409, 'The bidding round is already complete.');
  state.bidQueue = queue;

  if (newBid) {
    if (state.bidHolder !== null) state.bidQueue.unshift(state.bidHolder);
    state.bidHolder = actor;
    state.highBid = newBid;
  }

  if (state.bidQueue.length > 0) {
    state.turnSeat = state.bidQueue[0] ?? actor;
    return;
  }
  if (state.bidHolder === null || state.highBid === null) {
    prepareEsMakkerDeal(state, false);
    return;
  }
  beginContract(state, state.bidHolder, state.highBid);
}

function beginContract(state: EsMakkerGameState, declarerSeat: number, bid: EsMakkerBid): void {
  state.contract = bid;
  state.declarerSeat = declarerSeat;
  state.aceLow = bid.kind === 'special';
  if (bid.kind === 'special') {
    state.trump = null;
    state.selfPartner = true;
    state.selfPartnerKnown = true;
    if (bid.special === 'superbordlaegger') state.openHands = [0, 1, 2, 3];
    state.phase = 'playing';
    state.turnSeat = state.leaderSeat;
    return;
  }

  if (bid.variant === 'gode') {
    state.trump = 'clubs';
    state.phase = 'partner';
    state.turnSeat = declarerSeat;
    return;
  }
  if (bid.variant === 'vip') {
    state.kittyRevealed = true;
    state.shownKitty = structuredClone(state.kitty);
    state.trump = null;
    for (const card of state.kitty) if (!card.isJoker && card.suit) state.trump = card.suit;
    if (state.kitty.every(card => card.isJoker)) state.trump = null;
    state.phase = 'partner';
    state.turnSeat = declarerSeat;
    return;
  }
  if (bid.variant === 'halve') {
    state.phase = 'partner';
    state.turnSeat = declarerSeat;
    return;
  }
  state.phase = 'trump';
  state.turnSeat = declarerSeat;
}

function choosePartner(state: EsMakkerGameState, seatNumber: number, cardId: string): void {
  const declarerSeat = state.declarerSeat;
  if (declarerSeat === null || seatNumber !== declarerSeat) {
    throw new LobbyError(403, 'Only the declarer can call the partner card.');
  }
  const candidate = getPartnerCandidates(state, declarerSeat).find(card => card.id === cardId);
  if (!candidate) throw new LobbyError(400, 'That card cannot be called as the partner card.');

  state.partnerCard = candidate;
  state.partnerSeat = state.players.find(player =>
    player.seatNumber !== declarerSeat &&
    state.hands[String(player.seatNumber)]?.some(card => card.id === cardId),
  )?.seatNumber ?? null;
  state.selfPartner = state.partnerSeat === null || state.partnerSeat === declarerSeat;
  state.selfPartnerKnown = state.selfPartner &&
    (state.contract?.kind === 'special' ||
      (state.contract?.kind === 'normal' && state.contract.variant === 'halve') ||
      (state.kittyRevealed && state.kitty.some(card => card.id === cardId)));

  if (state.contract?.kind === 'normal' && state.contract.variant === 'halve') {
    state.partnerKnown = !state.selfPartner;
    state.phase = 'trump';
    state.turnSeat = state.partnerSeat ?? declarerSeat;
  } else {
    enterExchange(state);
  }
}

function getPartnerCandidates(state: EsMakkerGameState, declarerSeat: number): EsMakkerCard[] {
  const declarerHand = new Set(state.hands[String(declarerSeat)]?.map(card => card.id) ?? []);
  const suitPool = suits.filter(suit => state.trump === null || state.trump !== suit);
  for (const rank of ['A', 'K', 'Q', 'J', '10']) {
    const candidates = suitPool
      .map(suit => findCard(state, `${rank}-${suit}`))
      .filter((card): card is EsMakkerCard => card !== null && !declarerHand.has(card.id));
    if (candidates.length > 0) return candidates;
  }
  return [];
}

function findCard(state: EsMakkerGameState, cardId: string): EsMakkerCard | null {
  for (const cards of [...Object.values(state.hands), state.kitty]) {
    const card = cards.find(candidate => candidate.id === cardId);
    if (card) return card;
  }
  return null;
}

function enterExchange(state: EsMakkerGameState): void {
  state.phase = 'exchange';
  state.turnSeat = state.declarerSeat ?? state.turnSeat;
}

function exchangeCards(
  state: EsMakkerGameState,
  seatNumber: number,
  action: Extract<EsMakkerAction, { type: 'exchange' }>,
): void {
  if (seatNumber !== state.declarerSeat) throw new LobbyError(403, 'Only the declarer can exchange cards.');
  if (typeof action.take !== 'boolean') throw new LobbyError(400, 'Choose whether to exchange cards.');
  const mustExchange = state.contract?.kind === 'normal' && state.contract.variant === 'vip';
  if (!action.take) {
    if (mustExchange) throw new LobbyError(400, 'Cards must be exchanged in Vip.');
    enterPlaying(state);
    return;
  }
  if (!action.discardIds || action.discardIds.length !== 3 ||
      new Set(action.discardIds).size !== 3) {
    throw new LobbyError(400, 'Choose exactly three different cards to discard.');
  }
  const hand = state.hands[String(seatNumber)] ?? [];
  const combined = [...hand, ...state.kitty];
  if (combined.length !== 16 || action.discardIds.some(id => !combined.some(card => card.id === id))) {
    throw new LobbyError(400, 'One or more selected cards are not in your hand or the kitty.');
  }

  const discarded = combined.filter(card => action.discardIds?.includes(card.id));
  const discardIds = new Set(discarded.map(card => card.id));
  state.hands[String(seatNumber)] = combined.filter(card => !discardIds.has(card.id));
  state.kitty = discarded;
  state.discarded = discarded;
  state.exchanged = true;
  state.declarerSawKitty = true;
  if (state.partnerCard && !discardIds.has(state.partnerCard.id) &&
      state.hands[String(seatNumber)]?.some(card => card.id === state.partnerCard?.id)) {
    state.partnerRevealed = true;
  }
  enterPlaying(state);
}

function enterPlaying(state: EsMakkerGameState): void {
  state.phase = 'playing';
  state.turnSeat = state.leaderSeat;
}

function playCard(state: EsMakkerGameState, seatNumber: number, cardId: string): void {
  const hand = state.hands[String(seatNumber)] ?? [];
  const legal = getEsMakkerLegalCards(state, seatNumber);
  const card = legal.find(candidate => candidate.id === cardId);
  if (!card) throw new LobbyError(400, 'That card cannot be played now.');

  state.hands[String(seatNumber)] = hand.filter(candidate => candidate.id !== cardId);
  const player = state.players.find(candidate => candidate.seatNumber === seatNumber);
  if (player) player.handCount = state.hands[String(seatNumber)]?.length ?? 0;
  state.trick.push({ seatNumber, card });
  state.turnSeat = (seatNumber + 1) % 4;

  if (state.partnerCard?.id === card.id) {
    state.partnerRevealed = true;
    state.partnerFell = true;
    if (seatNumber === state.declarerSeat) state.selfPartnerKnown = true;
  }

  if (state.trick.length < 4) return;
  const winner = resolveTrick(state.trick, state.trump, state.aceLow);
  state.tricksWon[String(winner)] = (state.tricksWon[String(winner)] ?? 0) + 1;
  state.lastTrick = state.trick;
  state.lastTrickWinner = winner;
  state.trick = [];
  state.trickNumber += 1;
  state.leaderSeat = winner;
  state.turnSeat = winner;

  if (state.contract?.kind === 'special') {
    const revealAfter = state.contract.special === 'sol' ? 2
      : state.contract.special === 'superbordlaegger' ? 0
        : 1;
    if (revealAfter > 0 && state.trickNumber === revealAfter &&
        state.declarerSeat !== null) {
      state.openHands = [state.declarerSeat];
    }
  }

  if (state.contract?.kind === 'special' && winner === state.declarerSeat) {
    state.toppled = true;
    finishRound(state);
  } else if (state.trickNumber === 13) {
    finishRound(state);
  }
}

function resolveTrick(
  trick: EsMakkerGameState['trick'],
  trump: EsMakkerGameState['trump'],
  aceLow: boolean,
): number {
  const lead = trick[0];
  if (!lead) throw new LobbyError(409, 'The trick has no lead card.');
  if (lead.card.isJoker) return lead.seatNumber;
  const ledSuit = lead.card.suit;
  let best = lead;

  for (const play of trick.slice(1)) {
    const card = play.card;
    if (card.isJoker || !card.suit) continue;
    const cardTrump = trump !== null && card.suit === trump;
    const bestTrump = trump !== null && best.card.suit === trump;
    if (cardTrump && !bestTrump) {
      best = play;
      continue;
    }
    if (!cardTrump && bestTrump) continue;
    if (card.suit !== best.card.suit) continue;
    if (card.suit !== ledSuit && !cardTrump) continue;
    if (cardValue(card, aceLow) > cardValue(best.card, aceLow)) best = play;
  }
  return best.seatNumber;
}

function cardValue(card: EsMakkerCard, aceLow: boolean): number {
  if (card.isJoker) return 0;
  if (card.rank === 'A') return aceLow ? 1 : 14;
  return ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'].indexOf(card.rank ?? '') + 2;
}

function finishRound(state: EsMakkerGameState): void {
  const bid = state.contract;
  const declarer = state.declarerSeat;
  if (!bid || declarer === null) throw new LobbyError(409, 'The contract is incomplete.');

  const declaring = [declarer];
  if (bid.kind === 'normal' && !state.selfPartner && state.partnerSeat !== null) {
    declaring.push(state.partnerSeat);
  }
  const defenders = state.players
    .map(player => player.seatNumber)
    .filter(seat => !declaring.includes(seat));

  let basePoints: number;
  let made: boolean;
  let detail: string;
  if (bid.kind === 'special') {
    basePoints = specialPoints[bid.special] ?? 0;
    made = !state.toppled;
    const label = specialLabel(bid.special);
    detail = made ? `${label} holdt` : `${label} væltet på stik ${state.trickNumber}`;
  } else {
    const won = declaring.reduce((sum, seat) => sum + (state.tricksWon[String(seat)] ?? 0), 0);
    const row = scoreTable[bid.tricks]?.[bid.variant];
    const pointIndex = won;
    if (!row || row[pointIndex] === undefined) throw new LobbyError(409, 'The contract score is invalid.');
    basePoints = row[pointIndex];
    made = won >= bid.tricks;
    const difference = won - bid.tricks;
    detail = `${won} stik hjem (${difference >= 0 ? '+' : ''}${difference})`;
  }

  const sign = made ? 1 : -1;
  const delta: Record<string, number> = {};
  const perDeclarer = basePoints * (defenders.length / declaring.length);
  for (const seat of declaring) delta[String(seat)] = sign * perDeclarer;
  for (const seat of defenders) delta[String(seat)] = -sign * basePoints;
  for (const player of state.players) {
    const key = String(player.seatNumber);
    state.scores[key] = (state.scores[key] ?? 0) + (delta[key] ?? 0);
  }
  const result = {
    roundNumber: state.roundNumber,
    dealerSeat: state.dealerSeat,
    declarerSeat: declarer,
    partnerSeat: state.selfPartner ? null : state.partnerSeat,
    contract: bid,
    trump: state.trump,
    tricksWon: { ...state.tricksWon },
    made,
    basePoints,
    detail,
    delta,
    totals: { ...state.scores },
  };
  state.roundResults.push(result);
  const top = Math.max(...Object.values(state.scores));
  state.winners = state.players
    .filter(player => state.scores[String(player.seatNumber)] === top)
    .map(player => player.seatNumber);
  if (Object.values(state.scores).some(score => score >= 25)) {
    state.phase = 'finished';
    return;
  }
  prepareEsMakkerDeal(state, true);
}

function requirePhase(
  state: EsMakkerGameState,
  phase: EsMakkerGameState['phase'],
): void {
  if (state.phase !== phase) throw new LobbyError(409, 'This action is not available in the current phase.');
}

function validateActionShape(action: EsMakkerAction): void {
  const requiredByType: Record<EsMakkerAction['type'], string[]> = {
    pass: [],
    bid: ['bid'],
    'choose-trump': ['suit'],
    'choose-partner': ['cardId'],
    exchange: ['take'],
    'play-card': ['cardId'],
  };
  const allowedByType: Record<EsMakkerAction['type'], string[]> = {
    pass: ['type'],
    bid: ['type', 'bid'],
    'choose-trump': ['type', 'suit'],
    'choose-partner': ['type', 'cardId'],
    exchange: ['type', 'take', 'discardIds'],
    'play-card': ['type', 'cardId'],
  };
  const allowed = allowedByType[action.type];
  if (
    !allowed ||
    Object.keys(action).some(key => !allowed.includes(key)) ||
    requiredByType[action.type].some(key => !(key in action))
  ) {
    throw new LobbyError(400, 'The game action is invalid.');
  }
}

function sameBid(left: EsMakkerBid, right: EsMakkerBid): boolean {
  return left.kind === right.kind &&
    (left.kind === 'normal' && right.kind === 'normal'
      ? left.tricks === right.tricks && left.variant === right.variant
      : left.kind === 'special' && right.kind === 'special' && left.special === right.special);
}

function isBid(value: EsMakkerBid | undefined): value is EsMakkerBid {
  if (!value || typeof value !== 'object') return false;
  return value.kind === 'normal'
    ? Number.isInteger(value.tricks) && value.tricks >= 7 && value.tricks <= 13 &&
      variants.includes(value.variant)
    : value.kind === 'special' && specialBids.some(item => item.special === value.special);
}

function bidRank(bid: EsMakkerBid): number {
  if (bid.kind === 'normal') return (bid.tricks - 7) * 4 + variants.indexOf(bid.variant);
  const special = specialBids.find(item => item.special === bid.special);
  if (!special) return -1;
  return (special.tricks - 7) * 4 + variants.indexOf(special.variant) - 0.5;
}

function specialLabel(special: string): string {
  switch (special) {
    case 'sol': return 'Sol';
    case 'rensol': return 'Ren Sol';
    case 'bordlaegger': return 'Bordlægger';
    default: return 'Super Bordlægger';
  }
}
