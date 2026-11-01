import { randomInt } from 'node:crypto';
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { LobbyError, type GameType } from '../lobby/types.js';

const PublicPlayerSchema = Type.Object({
  seatNumber: Type.Integer({ minimum: 0, maximum: 3 }),
  kind: Type.Union([Type.Literal('human'), Type.Literal('bot')]),
  handCount: Type.Integer({ minimum: 0 }),
});

const StoredPlayerSchema = Type.Object({
  seatNumber: Type.Integer({ minimum: 0, maximum: 3 }),
  kind: Type.Union([Type.Literal('human'), Type.Literal('bot')]),
  userSubject: Type.Union([Type.String(), Type.Null()]),
  handCount: Type.Integer({ minimum: 0 }),
});

const CasinoCardFaceSchema = Type.Object({
  id: Type.String(),
  suit: Type.Union([
    Type.Literal('SPADES'),
    Type.Literal('HEARTS'),
    Type.Literal('DIAMONDS'),
    Type.Literal('CLUBS'),
  ]),
  value: Type.Integer({ minimum: 1, maximum: 13 }),
  displayName: Type.String(),
  symbol: Type.String(),
  name: Type.String(),
  buildAs: Type.Array(Type.Integer()),
  captureAs: Type.Array(Type.Integer()),
  boardAs: Type.Array(Type.Integer()),
  isSweeper: Type.Boolean(),
});

const CasinoCardSchema = Type.Intersect([
  CasinoCardFaceSchema,
  Type.Object({
    isBuild: Type.Optional(Type.Literal(false)),
  }),
]);

const KasinoBuildSchema = Type.Object({
  id: Type.String(),
  isBuild: Type.Literal(true),
  groups: Type.Integer({ minimum: 1, maximum: 52 }),
  value: Type.Integer({ minimum: 1 }),
  owner: Type.Integer({ minimum: 0, maximum: 3 }),
  cards: Type.Array(CasinoCardSchema, { minItems: 2 }),
});

const KasinoBoardItemSchema = Type.Union([CasinoCardSchema, KasinoBuildSchema]);

const EsMakkerCardSchema = Type.Object({
  id: Type.String(),
  suit: Type.Union([
    Type.Literal('clubs'),
    Type.Literal('diamonds'),
    Type.Literal('hearts'),
    Type.Literal('spades'),
    Type.Null(),
  ]),
  rank: Type.Union([Type.String(), Type.Null()]),
  jokerNo: Type.Integer({ minimum: -1, maximum: 2 }),
  isJoker: Type.Boolean(),
});

const EsMakkerSuitSchema = Type.Union([
  Type.Literal('clubs'),
  Type.Literal('diamonds'),
  Type.Literal('hearts'),
  Type.Literal('spades'),
]);

const EsMakkerBidSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('normal'),
    tricks: Type.Integer({ minimum: 7, maximum: 13 }),
    variant: Type.Union([
      Type.Literal('alm'),
      Type.Literal('vip'),
      Type.Literal('gode'),
      Type.Literal('halve'),
    ]),
  }),
  Type.Object({
    kind: Type.Literal('special'),
    special: Type.Union([
      Type.Literal('sol'),
      Type.Literal('rensol'),
      Type.Literal('bordlaegger'),
      Type.Literal('superbordlaegger'),
    ]),
  }),
]);

const EsMakkerBidRecordSchema = Type.Object({
  seatNumber: Type.Integer({ minimum: 0, maximum: 3 }),
  kind: Type.Union([Type.Literal('pass'), Type.Literal('bid')]),
  bid: Type.Union([EsMakkerBidSchema, Type.Null()]),
});

const EsMakkerTrickCardSchema = Type.Object({
  seatNumber: Type.Integer({ minimum: 0, maximum: 3 }),
  card: EsMakkerCardSchema,
});

const EsMakkerRoundResultSchema = Type.Object({
  roundNumber: Type.Integer({ minimum: 1 }),
  dealerSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  declarerSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  partnerSeat: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  contract: EsMakkerBidSchema,
  trump: Type.Union([EsMakkerSuitSchema, Type.Null()]),
  tricksWon: Type.Record(Type.String(), Type.Integer({ minimum: 0, maximum: 13 })),
  made: Type.Boolean(),
  basePoints: Type.Number({ minimum: 0 }),
  detail: Type.String(),
  delta: Type.Record(Type.String(), Type.Number()),
  totals: Type.Record(Type.String(), Type.Number()),
});

const KasinoStoredStateSchema = Type.Object({
  gameType: Type.Literal('kasino'),
  version: Type.Integer({ minimum: 1 }),
  phase: Type.Literal('playing'),
  roundNumber: Type.Integer({ minimum: 1 }),
  turnSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  players: Type.Array(StoredPlayerSchema, { minItems: 2, maxItems: 4 }),
  deck: Type.Array(CasinoCardSchema),
  hands: Type.Record(Type.String(), Type.Array(CasinoCardSchema)),
  board: Type.Array(KasinoBoardItemSchema),
  lastTaker: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  captured: Type.Record(Type.String(), Type.Array(CasinoCardSchema)),
  sweeps: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  scores: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  baselineScores: Type.Optional(Type.Record(Type.String(), Type.Integer({ minimum: 0 }))),
  winner: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
});

const EsMakkerStoredStateSchema = Type.Object({
  gameType: Type.Literal('es-makker'),
  version: Type.Integer({ minimum: 1 }),
  phase: Type.Union([
    Type.Literal('bidding'),
    Type.Literal('trump'),
    Type.Literal('partner'),
    Type.Literal('exchange'),
    Type.Literal('playing'),
    Type.Literal('finished'),
  ]),
  roundNumber: Type.Integer({ minimum: 1 }),
  dealNumber: Type.Integer({ minimum: 1 }),
  dealerSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  turnSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  players: Type.Array(StoredPlayerSchema, { minItems: 4, maxItems: 4 }),
  hands: Type.Record(Type.String(), Type.Array(EsMakkerCardSchema)),
  kitty: Type.Array(EsMakkerCardSchema, { minItems: 3, maxItems: 3 }),
  bidQueue: Type.Array(Type.Integer({ minimum: 0, maximum: 3 })),
  bidHolder: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  highBid: Type.Union([EsMakkerBidSchema, Type.Null()]),
  bids: Type.Array(EsMakkerBidRecordSchema),
  contract: Type.Union([EsMakkerBidSchema, Type.Null()]),
  declarerSeat: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  trump: Type.Union([EsMakkerSuitSchema, Type.Null()]),
  partnerCard: Type.Union([EsMakkerCardSchema, Type.Null()]),
  partnerSeat: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  selfPartner: Type.Boolean(),
  selfPartnerKnown: Type.Boolean(),
  declarerSawKitty: Type.Boolean(),
  partnerRevealed: Type.Boolean(),
  partnerFell: Type.Boolean(),
  partnerKnown: Type.Boolean(),
  aceLow: Type.Boolean(),
  exchanged: Type.Boolean(),
  discarded: Type.Array(EsMakkerCardSchema),
  openHands: Type.Array(Type.Integer({ minimum: 0, maximum: 3 })),
  kittyRevealed: Type.Boolean(),
  shownKitty: Type.Array(EsMakkerCardSchema),
  trick: Type.Array(EsMakkerTrickCardSchema, { maxItems: 3 }),
  lastTrick: Type.Array(EsMakkerTrickCardSchema, { maxItems: 4 }),
  lastTrickWinner: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  trickNumber: Type.Integer({ minimum: 0, maximum: 13 }),
  tricksWon: Type.Record(Type.String(), Type.Integer({ minimum: 0, maximum: 13 })),
  leaderSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  toppled: Type.Boolean(),
  scores: Type.Record(Type.String(), Type.Number()),
  roundResults: Type.Array(EsMakkerRoundResultSchema),
  winners: Type.Array(Type.Integer({ minimum: 0, maximum: 3 })),
});

export const MultiplayerGameStateSchema = Type.Union([
  KasinoStoredStateSchema,
  EsMakkerStoredStateSchema,
]);

export type MultiplayerGameState = Static<typeof MultiplayerGameStateSchema>;
export type KasinoGameState = Extract<MultiplayerGameState, { gameType: 'kasino' }>;
export type EsMakkerGameState = Extract<MultiplayerGameState, { gameType: 'es-makker' }>;
export type KasinoCard = Static<typeof CasinoCardSchema>;
export type EsMakkerCard = Static<typeof EsMakkerCardSchema>;
export type EsMakkerBid = Static<typeof EsMakkerBidSchema>;

export function prepareEsMakkerDeal(
  state: EsMakkerGameState,
  nextRound: boolean,
): void {
  if (nextRound) {
    state.roundNumber += 1;
    state.dealerSeat = (state.dealerSeat + 1) % 4;
    state.dealNumber = 1;
  } else {
    state.dealNumber += 1;
  }
  dealEsMakker(state);
}

const KasinoSnapshotSchema = Type.Object({
  gameType: Type.Literal('kasino'),
  version: Type.Integer({ minimum: 1 }),
  phase: Type.Literal('playing'),
  roundNumber: Type.Integer({ minimum: 1 }),
  turnSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  players: Type.Array(PublicPlayerSchema, { minItems: 2, maxItems: 4 }),
  mySeat: Type.Integer({ minimum: 0, maximum: 3 }),
  hand: Type.Array(CasinoCardSchema),
  board: Type.Array(KasinoBoardItemSchema),
  captured: Type.Record(Type.String(), Type.Array(CasinoCardSchema)),
  sweeps: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  scores: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  lastTaker: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  winner: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
});

const EsMakkerSnapshotSchema = Type.Object({
  gameType: Type.Literal('es-makker'),
  version: Type.Integer({ minimum: 1 }),
  phase: Type.Union([
    Type.Literal('bidding'),
    Type.Literal('trump'),
    Type.Literal('partner'),
    Type.Literal('exchange'),
    Type.Literal('playing'),
    Type.Literal('finished'),
  ]),
  roundNumber: Type.Integer({ minimum: 1 }),
  dealNumber: Type.Integer({ minimum: 1 }),
  dealerSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  turnSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  players: Type.Array(PublicPlayerSchema, { minItems: 4, maxItems: 4 }),
  mySeat: Type.Integer({ minimum: 0, maximum: 3 }),
  hand: Type.Array(EsMakkerCardSchema),
  handCounts: Type.Record(Type.String(), Type.Integer({ minimum: 0 })),
  kittyCount: Type.Integer({ minimum: 0, maximum: 3 }),
  bids: Type.Array(EsMakkerBidRecordSchema),
  highBid: Type.Union([EsMakkerBidSchema, Type.Null()]),
  contract: Type.Union([EsMakkerBidSchema, Type.Null()]),
  declarerSeat: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  trump: Type.Union([EsMakkerSuitSchema, Type.Null()]),
  partnerCard: Type.Union([EsMakkerCardSchema, Type.Null()]),
  partnerSeat: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  selfPartner: Type.Union([Type.Boolean(), Type.Null()]),
  partnerKnown: Type.Boolean(),
  partnerFell: Type.Boolean(),
  kittyRevealed: Type.Boolean(),
  shownKitty: Type.Array(EsMakkerCardSchema),
  kitty: Type.Array(EsMakkerCardSchema),
  openHands: Type.Record(Type.String(), Type.Array(EsMakkerCardSchema)),
  trick: Type.Array(EsMakkerTrickCardSchema, { maxItems: 3 }),
  lastTrick: Type.Array(EsMakkerTrickCardSchema, { maxItems: 4 }),
  lastTrickWinner: Type.Union([Type.Integer({ minimum: 0, maximum: 3 }), Type.Null()]),
  trickNumber: Type.Integer({ minimum: 0, maximum: 13 }),
  leaderSeat: Type.Integer({ minimum: 0, maximum: 3 }),
  tricksWon: Type.Record(Type.String(), Type.Integer({ minimum: 0, maximum: 13 })),
  scores: Type.Record(Type.String(), Type.Number()),
  roundResults: Type.Array(EsMakkerRoundResultSchema),
  winners: Type.Array(Type.Integer({ minimum: 0, maximum: 3 })),
  legalBids: Type.Array(EsMakkerBidSchema),
  partnerCandidates: Type.Array(Type.Object({
    cardId: Type.String(),
    rank: Type.String(),
    suit: EsMakkerSuitSchema,
  })),
  legalCardIds: Type.Array(Type.String()),
});

export const GameSnapshotSchema = Type.Union([
  KasinoSnapshotSchema,
  EsMakkerSnapshotSchema,
]);

export type GameSnapshot = Static<typeof GameSnapshotSchema>;

export interface GameSeat {
  seatNumber: number;
  kind: 'human' | 'bot';
  userSubject: string | null;
}

export function createInitialGameState(
  gameType: GameType,
  seats: GameSeat[],
  hostSubject: string,
): MultiplayerGameState {
  validateSeats(gameType, seats, hostSubject);
  if (gameType === 'kasino') return createKasinoState(seats);
  return createEsMakkerState(seats, hostSubject);
}

export function parseGameState(value: string, expectedGameType: GameType): MultiplayerGameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Stored multiplayer game state is not valid JSON.');
  }
  if (!Value.Check(MultiplayerGameStateSchema, parsed) || parsed.gameType !== expectedGameType) {
    throw new Error('Stored multiplayer game state does not match its schema.');
  }
  return parsed;
}

export function createGameSnapshot(
  state: MultiplayerGameState,
  userSubject: string,
): GameSnapshot {
  return projectSnapshot(state, userSubject);
}

function projectSnapshot(state: MultiplayerGameState, userSubject: string): GameSnapshot {
  const player = state.players.find(candidate => candidate.userSubject === userSubject);
  if (!player) throw new LobbyError(403, 'You do not occupy a seat at this table.');

  const players = state.players.map(({ seatNumber, kind, handCount }) => ({
    seatNumber,
    kind,
    handCount,
  }));
  if (state.gameType === 'kasino') {
    return {
      gameType: state.gameType,
      version: state.version,
      phase: state.phase,
      roundNumber: state.roundNumber,
      turnSeat: state.turnSeat,
      players,
      mySeat: player.seatNumber,
      hand: state.hands[String(player.seatNumber)] ?? [],
      board: state.board,
      captured: state.captured,
      sweeps: state.sweeps,
      scores: state.scores,
      lastTaker: state.lastTaker,
      winner: state.winner,
    };
  }

  return {
    gameType: state.gameType,
    version: state.version,
    phase: state.phase,
    roundNumber: state.roundNumber,
    dealNumber: state.dealNumber,
    dealerSeat: state.dealerSeat,
    turnSeat: state.turnSeat,
    players,
    mySeat: player.seatNumber,
    hand: state.hands[String(player.seatNumber)] ?? [],
    handCounts: Object.fromEntries(state.players.map(item => [
      String(item.seatNumber),
      state.hands[String(item.seatNumber)]?.length ?? 0,
    ])),
    kittyCount: state.kitty.length,
    bids: state.bids,
    highBid: state.highBid,
    contract: state.contract,
    declarerSeat: state.declarerSeat,
    trump: state.trump,
    partnerCard: state.partnerCard,
    partnerSeat: state.partnerFell || state.partnerKnown ? state.partnerSeat : null,
    selfPartner: state.selfPartnerKnown ||
      (player.seatNumber === state.declarerSeat && state.declarerSawKitty)
      ? state.selfPartner
      : null,
    partnerKnown: state.partnerKnown,
    partnerFell: state.partnerFell,
    kittyRevealed: state.kittyRevealed,
    shownKitty: state.kittyRevealed ? state.shownKitty : [],
    kitty: player.seatNumber === state.declarerSeat && state.phase === 'exchange'
      ? state.kitty
      : [],
    openHands: Object.fromEntries(state.openHands.map(seatNumber => [
      String(seatNumber),
      state.hands[String(seatNumber)] ?? [],
    ])),
    trick: state.trick,
    lastTrick: state.lastTrick,
    lastTrickWinner: state.lastTrickWinner,
    trickNumber: state.trickNumber,
    leaderSeat: state.leaderSeat,
    tricksWon: state.tricksWon,
    scores: state.scores,
    roundResults: state.roundResults,
    winners: state.winners,
    legalBids: state.phase === 'bidding' && state.turnSeat === player.seatNumber
      ? legalEsMakkerBids(state.highBid)
      : [],
    partnerCandidates: state.phase === 'partner' &&
      state.turnSeat === player.seatNumber &&
      state.declarerSeat === player.seatNumber
      ? getPartnerCandidates(state, player.seatNumber)
      : [],
    legalCardIds: state.phase === 'playing' && state.turnSeat === player.seatNumber
      ? getEsMakkerLegalCards(state, player.seatNumber).map(card => card.id)
      : [],
  };
}

function createKasinoState(seats: GameSeat[]): MultiplayerGameState {
  const deck = shuffle(kasinoDeck());
  const hands: Record<string, KasinoCard[]> = {};
  const players = seats.map(seat => ({
    seatNumber: seat.seatNumber,
    kind: seat.kind,
    userSubject: seat.userSubject,
    handCount: 4,
  }));
  for (const seat of seats) hands[String(seat.seatNumber)] = deck.splice(0, 4);
  const board = deck.splice(0, 4);
  const captured = Object.fromEntries(seats.map(seat => [String(seat.seatNumber), []]));
  const sweeps = Object.fromEntries(seats.map(seat => [String(seat.seatNumber), 0]));
  const scores = Object.fromEntries(seats.map(seat => [String(seat.seatNumber), 0]));
  return {
    gameType: 'kasino',
    version: 1,
    phase: 'playing',
    roundNumber: 1,
    turnSeat: seats[0]?.seatNumber ?? 0,
    players,
    deck,
    hands,
    board,
    lastTaker: null,
    captured,
    sweeps,
    scores,
    baselineScores: { ...scores },
    winner: null,
  };
}

function createEsMakkerState(seats: GameSeat[], hostSubject: string): EsMakkerGameState {
  const orderedSeats = [...seats].sort((left, right) => left.seatNumber - right.seatNumber);
  const hostSeat = orderedSeats.find(seat => seat.userSubject === hostSubject)?.seatNumber;
  if (hostSeat === undefined) throw new LobbyError(409, 'The host must occupy a seat to start the game.');
  const dealerSeat = (hostSeat + 1) % 4;
  const players = orderedSeats.map(seat => ({
    seatNumber: seat.seatNumber,
    kind: seat.kind,
    userSubject: seat.userSubject,
    handCount: 13,
  }));
  const state: EsMakkerGameState = {
    gameType: 'es-makker',
    version: 1,
    phase: 'bidding',
    roundNumber: 1,
    dealNumber: 1,
    dealerSeat,
    turnSeat: (dealerSeat + 1) % 4,
    players,
    hands: {},
    kitty: [],
    bidQueue: [],
    bidHolder: null,
    highBid: null,
    bids: [],
    contract: null,
    declarerSeat: null,
    trump: null,
    partnerCard: null,
    partnerSeat: null,
    selfPartner: false,
    selfPartnerKnown: false,
    declarerSawKitty: false,
    partnerRevealed: false,
    partnerFell: false,
    partnerKnown: false,
    aceLow: false,
    exchanged: false,
    discarded: [],
    openHands: [],
    kittyRevealed: false,
    shownKitty: [],
    trick: [],
    lastTrick: [],
    lastTrickWinner: null,
    trickNumber: 0,
    tricksWon: Object.fromEntries(seats.map(seat => [String(seat.seatNumber), 0])),
    leaderSeat: (dealerSeat + 1) % 4,
    toppled: false,
    scores: Object.fromEntries(seats.map(seat => [String(seat.seatNumber), 0])),
    roundResults: [],
    winners: [],
  };
  dealEsMakker(state);
  return state;
}

function dealEsMakker(state: EsMakkerGameState): void {
  const seats = Array.from({ length: 4 }, (_, index) => (state.dealerSeat + index + 1) % 4);
  const deck = shuffle(esMakkerDeck());
  const hands: Record<string, EsMakkerCard[]> = Object.fromEntries(seats.map(seat => [String(seat), []]));
  for (const packet of [3, 3, 3, 4]) {
    for (const seatNumber of seats) hands[String(seatNumber)]?.push(...deck.splice(0, packet));
  }
  state.hands = hands;
  state.kitty = deck.splice(0, 3);
  state.bidQueue = [...seats];
  state.turnSeat = seats[0] ?? 0;
  state.bidHolder = null;
  state.highBid = null;
  state.bids = [];
  state.contract = null;
  state.declarerSeat = null;
  state.trump = null;
  state.partnerCard = null;
  state.partnerSeat = null;
  state.selfPartner = false;
  state.selfPartnerKnown = false;
  state.declarerSawKitty = false;
  state.partnerRevealed = false;
  state.partnerFell = false;
  state.partnerKnown = false;
  state.aceLow = false;
  state.exchanged = false;
  state.discarded = [];
  state.openHands = [];
  state.kittyRevealed = false;
  state.shownKitty = [];
  state.trick = [];
  state.lastTrick = [];
  state.lastTrickWinner = null;
  state.trickNumber = 0;
  state.tricksWon = Object.fromEntries(state.players.map(player => [String(player.seatNumber), 0]));
  state.leaderSeat = seats[0] ?? 0;
  state.toppled = false;
  state.winners = [];
  state.players.forEach(player => { player.handCount = 13; });
  state.phase = 'bidding';
}

function legalEsMakkerBids(current: EsMakkerBid | null): EsMakkerBid[] {
  const variants = ['alm', 'vip', 'gode', 'halve'] as const;
  const specials = [
    { special: 'sol', tricks: 9, variant: 'vip' },
    { special: 'rensol', tricks: 10, variant: 'vip' },
    { special: 'bordlaegger', tricks: 11, variant: 'vip' },
    { special: 'superbordlaegger', tricks: 12, variant: 'vip' },
  ] as const;
  const rank = (bid: EsMakkerBid): number => {
    if (bid.kind === 'normal') return (bid.tricks - 7) * 4 + variants.indexOf(bid.variant);
    const special = specials.find(item => item.special === bid.special);
    return special ? (special.tricks - 7) * 4 + variants.indexOf(special.variant) - 0.5 : -1;
  };
  const bids: EsMakkerBid[] = [];
  for (let tricks = 7; tricks <= 13; tricks += 1) {
    for (const variant of variants) bids.push({ kind: 'normal', tricks, variant });
  }
  for (const { special } of specials) bids.push({ kind: 'special', special });
  return bids.filter(bid => current === null || rank(bid) > rank(current));
}

function getPartnerCandidates(
  state: EsMakkerGameState,
  declarerSeat: number,
): Array<{ cardId: string; rank: string; suit: 'clubs' | 'diamonds' | 'hearts' | 'spades' }> {
  const handIds = new Set(state.hands[String(declarerSeat)]?.map(card => card.id) ?? []);
  const allSuits = [
    'clubs',
    'diamonds',
    'hearts',
    'spades',
  ] as const;
  const suitPool = allSuits.filter(suit => state.trump === null || suit !== state.trump);
  for (const rank of ['A', 'K', 'Q', 'J', '10']) {
    const candidates = suitPool
      .map(suit => ({ cardId: `${rank}-${suit}`, rank, suit }))
      .filter(candidate => !handIds.has(candidate.cardId));
    if (candidates.length > 0) return candidates;
  }
  return [];
}

export function getEsMakkerLegalCards(
  state: EsMakkerGameState,
  seatNumber: number,
): EsMakkerCard[] {
  const hand = state.hands[String(seatNumber)] ?? [];
  if (state.trick.length === 0) {
    let legal = [...hand];
    if (state.trickNumber === 0) {
      const noJokers = legal.filter(card => !card.isJoker);
      if (noJokers.length > 0) legal = noJokers;
    }
    const heldPartner = state.partnerCard && !state.partnerRevealed
      ? hand.find(card => card.id === state.partnerCard?.id)
      : undefined;
    if (heldPartner && state.partnerCard) {
      const withoutSuit = legal.filter(card =>
        card.isJoker || card.suit !== state.partnerCard?.suit || card.id === state.partnerCard?.id);
      if (withoutSuit.length > 0) legal = withoutSuit;
    }
    return legal;
  }

  const led = state.trick[0]?.card;
  if (!led || led.isJoker || !led.suit) return [...hand];
  const heldPartner = state.partnerCard && !state.partnerRevealed
    ? hand.find(card => card.id === state.partnerCard?.id)
    : undefined;
  if (heldPartner && state.partnerCard?.suit === led.suit) return [heldPartner];
  const follow = hand.filter(card => !card.isJoker && card.suit === led.suit);
  if (follow.length > 0) return [...follow, ...hand.filter(card => card.isJoker)];
  return [...hand];
}

function validateSeats(gameType: GameType, seats: GameSeat[], hostSubject: string): void {
  if (seats.some((seat, index) => seat.seatNumber !== index)) {
    throw new LobbyError(409, 'The table seat arrangement is invalid.');
  }
  if (seats.some(seat => seat.kind === 'human' && seat.userSubject === null)) {
    throw new LobbyError(409, 'All human seats must be occupied before the game starts.');
  }
  if (!seats.some(seat => seat.userSubject === hostSubject)) {
    throw new LobbyError(403, 'Only the table host can start the game.');
  }
  const humans = seats.filter(seat => seat.kind === 'human').length;
  const bots = seats.filter(seat => seat.kind === 'bot').length;
  if (
    (gameType === 'es-makker' && (seats.length !== 4 || humans !== 4 || bots !== 0)) ||
    (gameType === 'kasino' && (seats.length < 2 || seats.length > 4)) ||
    humans < 1 ||
    humans + bots !== seats.length
  ) {
    throw new LobbyError(409, 'The table composition is invalid for this game.');
  }
}

function kasinoDeck(): KasinoCard[] {
  const suits = [
    { key: 'SPADES', name: 'Spar', symbol: '♠' },
    { key: 'HEARTS', name: 'Hjerter', symbol: '♥' },
    { key: 'DIAMONDS', name: 'Ruder', symbol: '♦' },
    { key: 'CLUBS', name: 'Klør', symbol: '♣' },
  ] as const;
  return suits.flatMap(suit => Array.from({ length: 13 }, (_, index) => {
    const value = index + 1;
    const displayName = value === 1 ? 'A'
      : value === 11 ? 'J'
        : value === 12 ? 'Q'
          : value === 13 ? 'K'
            : String(value);
    const isAce = value === 1;
    const isSulan = suit.key === 'DIAMONDS' && value === 10;
    const isKrabben = suit.key === 'SPADES' && value === 2;
    const values = isAce ? [1] : isSulan ? [10, 16] : isKrabben ? [2, 15] : [value];
    return {
      id: `${suit.key}_${value}`,
      suit: suit.key,
      value,
      displayName,
      symbol: suit.symbol,
      name: `${suit.name} ${displayName}`,
      buildAs: values,
      captureAs: isAce ? [1, 14] : values,
      boardAs: isAce ? [1, 14] : values,
      isSweeper: suit.key === 'SPADES' && value === 5,
    };
  }));
}

function esMakkerDeck(): EsMakkerCard[] {
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const;
  const cards: EsMakkerCard[] = suits.flatMap(suit => ranks.map(rank => ({
    id: `${rank}-${suit}`,
    suit,
    rank,
    jokerNo: -1,
    isJoker: false,
  })));
  for (let jokerNo = 0; jokerNo < 3; jokerNo += 1) {
    cards.push({
      id: `JK${jokerNo}`,
      suit: null,
      rank: null,
      jokerNo,
      isJoker: true,
    });
  }
  return cards;
}

function shuffle<T>(cards: T[]): T[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}
