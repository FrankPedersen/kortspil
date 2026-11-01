import { randomInt, randomUUID } from 'node:crypto';
import { LobbyError } from '../lobby/types.js';
import type { KasinoCard, KasinoGameState } from './state.js';

export type KasinoActionType =
  | 'SPAR_FEM'
  | 'SMID_UD'
  | 'STIK'
  | 'BYG_ENKELT'
  | 'BYG_DOBBELT';

export interface KasinoTurnAction {
  type: KasinoActionType;
  handCardId: string;
  targetItemIds: string[];
  buildValue?: number;
  groupCount?: number;
}

export interface KasinoMoveOption {
  type: KasinoActionType;
  buildValue?: number;
  groupCount?: number;
}

interface BoardItem {
  id: string;
  isBuild?: boolean;
  groups?: number;
  value?: number;
  owner?: number;
  cards?: KasinoCard[];
  boardAs?: number[];
  buildAs?: number[];
}

export function getKasinoMoveOptions(
  state: KasinoGameState,
  seatNumber: number,
  handCardId: string,
  targetItemIds: string[],
): KasinoMoveOption[] {
  assertTurn(state, seatNumber);
  if (new Set(targetItemIds).size !== targetItemIds.length || targetItemIds.length > 52) {
    throw new LobbyError(400, 'Choose at most 52 different cards or builds on the table.');
  }
  const handCard = state.hands[String(seatNumber)]?.find(card => card.id === handCardId);
  if (!handCard) throw new LobbyError(400, 'That card is not in your hand.');
  if (handCard.isSweeper && targetItemIds.length > 0) {
    throw new LobbyError(400, 'The spade five clears the whole table; do not select individual items.');
  }
  const selectedItems = targetItemIds.map(id => state.board.find(item => item.id === id));
  if (selectedItems.some(item => item === undefined)) {
    throw new LobbyError(400, 'A selected card or build is no longer on the table.');
  }
  return legalMoveOptions(
    handCard,
    selectedItems as BoardItem[],
    state.hands[String(seatNumber)] ?? [],
    state.board,
    seatNumber,
  );
}

export function applyKasinoAction(
  current: KasinoGameState,
  seatNumber: number,
  expectedVersion: number,
  action: KasinoTurnAction,
): KasinoGameState {
  assertTurn(current, seatNumber);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new LobbyError(400, 'A valid game version is required.');
  }
  if (current.version !== expectedVersion) {
    throw new LobbyError(409, 'The game changed. Refresh the table and try again.');
  }
  const options = getKasinoMoveOptions(current, seatNumber, action.handCardId, action.targetItemIds);
  if (!options.some(option => matchesAction(option, action))) {
    throw new LobbyError(400, 'That move is not legal.');
  }

  const state = structuredClone(current);
  const hand = state.hands[String(seatNumber)] ?? [];
  const handCard = hand.find(card => card.id === action.handCardId);
  if (!handCard) throw new LobbyError(409, 'That card is no longer in your hand.');
  const selected = action.targetItemIds.map(id => state.board.find(item => item.id === id));
  if (selected.some(item => item === undefined)) {
    throw new LobbyError(409, 'A selected card or build is no longer on the table.');
  }
  const selectedItems = selected as BoardItem[];
  const targetIds = new Set(action.targetItemIds);
  const targetCards = selectedItems.flatMap(flattenItem);
  const nextHands = { ...state.hands, [String(seatNumber)]: hand.filter(card => card.id !== handCard.id) };
  const nextCaptured = { ...state.captured };
  const nextSweeps = { ...state.sweeps };
  let nextBoard: BoardItem[] = [...state.board];
  let lastTaker = state.lastTaker;

  if (action.type === 'SPAR_FEM') {
    const swept = nextBoard.flatMap(flattenItem);
    nextCaptured[String(seatNumber)] = [...(nextCaptured[String(seatNumber)] ?? []), handCard, ...swept];
    nextBoard = [];
    lastTaker = seatNumber;
    nextSweeps[String(seatNumber)] = (nextSweeps[String(seatNumber)] ?? 0) + 1;
  } else if (action.type === 'SMID_UD') {
    nextBoard.push({ ...handCard, isBuild: false as const });
  } else if (action.type === 'STIK') {
    nextCaptured[String(seatNumber)] = [
      ...(nextCaptured[String(seatNumber)] ?? []),
      handCard,
      ...targetCards,
    ];
    nextBoard = nextBoard.filter(item => !targetIds.has(item.id));
    lastTaker = seatNumber;
    const moreToPlay = state.deck.length > 0 ||
      Object.values(nextHands).some(cards => cards.length > 0);
    if (nextBoard.length === 0 && moreToPlay) {
      nextSweeps[String(seatNumber)] = (nextSweeps[String(seatNumber)] ?? 0) + 1;
    }
  } else {
    const groupCount = action.groupCount;
    const buildValue = action.buildValue;
    if (groupCount === undefined || buildValue === undefined) {
      throw new LobbyError(400, 'A build must include its value and group count.');
    }
    nextBoard = nextBoard.filter(item => !targetIds.has(item.id));
    nextBoard.push({
      id: randomUUID(),
      isBuild: true,
      groups: groupCount,
      value: buildValue,
      owner: seatNumber,
      cards: [handCard, ...targetCards],
    });
  }

  const nextTurn = (seatNumber + 1) % state.players.length;
  const players = state.players.map(player => ({
    ...player,
    handCount: nextHands[String(player.seatNumber)]?.length ?? 0,
  }));
  state.hands = nextHands;
  state.players = players;
  state.board = nextBoard as KasinoGameState['board'];
  state.captured = nextCaptured;
  state.sweeps = nextSweeps;
  state.lastTaker = lastTaker;
  state.turnSeat = nextTurn;
  state.version += 1;
  updateLiveScores(state);
  const liveWinner = state.players
    .filter(player => (state.scores[String(player.seatNumber)] ?? 0) >= 21)
    .sort((left, right) =>
      (state.scores[String(right.seatNumber)] ?? 0) -
      (state.scores[String(left.seatNumber)] ?? 0),
    )[0];
  if (liveWinner) {
    state.winner = liveWinner.seatNumber;
    return state;
  }

  if (Object.values(nextHands).every(cards => cards.length === 0) && state.deck.length > 0) {
    const deck = [...state.deck];
    const dealtHands: KasinoGameState['hands'] = {};
    for (const player of players) dealtHands[String(player.seatNumber)] = deck.splice(0, 4);
    state.deck = deck;
    state.hands = dealtHands;
    state.players = players.map(player => ({
      ...player,
      handCount: dealtHands[String(player.seatNumber)]?.length ?? 0,
    }));
  } else if (Object.values(nextHands).every(cards => cards.length === 0)) {
    finishRound(state);
  }
  return state;
}

function assertTurn(state: KasinoGameState, seatNumber: number): void {
  if (state.winner !== null) throw new LobbyError(409, 'This game has already finished.');
  if (state.turnSeat !== seatNumber) throw new LobbyError(409, 'It is not your turn.');
}

function matchesAction(option: KasinoMoveOption, action: KasinoTurnAction): boolean {
  return option.type === action.type &&
    option.buildValue === action.buildValue &&
    option.groupCount === action.groupCount;
}

function legalMoveOptions(
  handCard: KasinoCard,
  selectedItems: BoardItem[],
  hand: KasinoCard[],
  board: BoardItem[],
  seatNumber: number,
): KasinoMoveOption[] {
  const ownBuild = board.find(item => item.isBuild && item.owner === seatNumber) ?? null;
  if (handCard.isSweeper) {
    return ownBuild ? [] : [{ type: 'SPAR_FEM' }];
  }
  if (ownBuild && !selectedItems.some(item => item.id === ownBuild.id)) return [];
  if (selectedItems.length === 0) {
    return ownBuild ? [] : [{ type: 'SMID_UD' }];
  }

  const rest = hand.filter(card => card.id !== handCard.id);
  const options: KasinoMoveOption[] = [];
  if (captureTargets(handCard, selectedItems).length > 0) options.push({ type: 'STIK' });
  options.push(...analyzeBuilds(handCard, selectedItems, rest).map(build => ({
    type: build.groupCount === 1 ? 'BYG_ENKELT' as const : 'BYG_DOBBELT' as const,
    buildValue: build.buildValue,
    groupCount: build.groupCount,
  })));
  return options;
}

function partitionFixed(units: Array<{ value: number; index: number }>, target: number): number[][] | null {
  if (units.length === 0 || target <= 0) return null;
  const total = units.reduce((sum, unit) => sum + unit.value, 0);
  if (total % target !== 0) return null;
  const groupCount = total / target;
  const sorted = [...units].sort((left, right) => right.value - left.value);
  if (sorted[0]!.value > target) return null;
  const groups = Array.from({ length: groupCount }, () => ({ sum: 0, indices: [] as number[] }));
  const place = (position: number): boolean => {
    if (position === sorted.length) return true;
    const unit = sorted[position]!;
    const triedSums = new Set<number>();
    for (const group of groups) {
      if (group.sum + unit.value > target || triedSums.has(group.sum)) continue;
      triedSums.add(group.sum);
      group.sum += unit.value;
      group.indices.push(unit.index);
      if (place(position + 1)) return true;
      group.sum -= unit.value;
      group.indices.pop();
    }
    return false;
  };
  return place(0) ? groups.map(group => group.indices) : null;
}

function partitionFlexible(entries: Array<{ options: number[] }>, target: number): number[][] | null {
  const flexibleIndices = entries.flatMap((entry, index) => entry.options.length > 1 ? [index] : []);
  if (flexibleIndices.length > 8) return null;
  for (let mask = 0; mask < 2 ** flexibleIndices.length; mask += 1) {
    const units = entries.map((entry, index) => {
      const optionIndex = flexibleIndices.indexOf(index);
      return {
        value: entry.options[optionIndex < 0 ? 0 : (mask >> optionIndex) & 1]!,
        index,
      };
    });
    const groups = partitionFixed(units, target);
    if (groups) return groups;
  }
  return null;
}

function captureTargets(handCard: KasinoCard, items: BoardItem[]): number[] {
  if (items.length === 0) return [];
  const entries = items.map(item => ({ options: boardOptions(item) }));
  return handCard.captureAs.filter(target => partitionFlexible(entries, target) !== null);
}

function analyzeBuilds(
  handCard: KasinoCard,
  selectedItems: BoardItem[],
  handAfterPlay: KasinoCard[],
): Array<{ buildValue: number; groupCount: number }> {
  if (selectedItems.length === 0 || handCard.isSweeper) return [];
  const locked = selectedItems.filter(item => item.isBuild && (item.groups ?? 0) >= 2);
  if (locked.length > 1) return [];
  const cover = handAfterPlay.filter(card => !card.isSweeper);

  if (locked.length === 1) {
    const base = locked[0]!;
    const target = base.value!;
    if (!cover.some(card => card.captureAs.includes(target))) return [];
    const entries = [
      ...selectedItems.filter(item => item !== base).map(item => ({ options: buildOptions(item) })),
      { options: handCard.buildAs },
    ];
    const added = partitionFlexible(entries, target);
    return added ? [{ buildValue: target, groupCount: (base.groups ?? 1) + added.length }] : [];
  }

  const entries = [
    ...selectedItems.map(item => ({ options: buildOptions(item) })),
    { options: handCard.buildAs },
  ];
  const reachable = [...new Set(cover.flatMap(card => card.captureAs))];
  return reachable
    .flatMap(target => {
      const groups = partitionFlexible(entries, target);
      return groups ? [{ buildValue: target, groupCount: groups.length }] : [];
    })
    .sort((left, right) => left.groupCount - right.groupCount || left.buildValue - right.buildValue);
}

function boardOptions(item: BoardItem): number[] {
  return item.isBuild ? [item.value!] : item.boardAs ?? [];
}

function buildOptions(item: BoardItem): number[] {
  return item.isBuild ? [item.value!] : item.buildAs ?? [];
}

function flattenItem(item: BoardItem): KasinoCard[] {
  return item.isBuild ? item.cards ?? [] : [item as KasinoCard];
}

function updateLiveScores(state: KasinoGameState): void {
  const baseline = state.baselineScores ?? Object.fromEntries(
    state.players.map(player => [String(player.seatNumber), 0]),
  );
  state.scores = Object.fromEntries(state.players.map(player => {
    const seat = String(player.seatNumber);
    const cards = state.captured[seat] ?? [];
    const cardPoints = cards.reduce((sum, card) => sum +
      (card.suit === 'DIAMONDS' && card.value === 10 ? 2
        : card.suit === 'SPADES' && card.value === 2 ? 1
          : card.value === 1 ? 1 : 0), 0);
    return [seat, (baseline[seat] ?? 0) + cardPoints + (state.sweeps[seat] ?? 0)];
  }));
}

function finishRound(state: KasinoGameState): void {
  const captured = { ...state.captured };
  if (state.lastTaker !== null && state.board.length > 0) {
    const seat = String(state.lastTaker);
    captured[seat] = [...(captured[seat] ?? []), ...state.board.flatMap(flattenItem)];
  }
  const scores = { ...(state.baselineScores ?? Object.fromEntries(
    state.players.map(player => [String(player.seatNumber), 0]),
  )) };
  for (const player of state.players) {
    const seat = String(player.seatNumber);
    const cards = captured[seat] ?? [];
    scores[seat] = (scores[seat] ?? 0) +
      cards.reduce((sum, card) => sum +
        (card.suit === 'DIAMONDS' && card.value === 10 ? 2
          : card.suit === 'SPADES' && card.value === 2 ? 1
            : card.value === 1 ? 1 : 0), 0) +
      (state.sweeps[seat] ?? 0);
  }
  if (state.lastTaker !== null) {
    const seat = String(state.lastTaker);
    scores[seat] = (scores[seat] ?? 0) + 1;
  }
  awardMost(state.players.map(player => String(player.seatNumber)), captured, scores, cards => cards.length);
  awardMost(
    state.players.map(player => String(player.seatNumber)),
    captured,
    scores,
    cards => cards.filter(card => card.suit === 'SPADES').length,
  );
  state.captured = captured;
  state.scores = scores;
  const winner = state.players
    .filter(player => (scores[String(player.seatNumber)] ?? 0) >= 21)
    .sort((left, right) =>
      (scores[String(right.seatNumber)] ?? 0) - (scores[String(left.seatNumber)] ?? 0),
    )[0];
  if (winner) {
    state.winner = winner.seatNumber;
    state.board = [];
    return;
  }

  state.baselineScores = { ...scores };
  state.roundNumber += 1;
  const deck = shuffle(kasinoDeck());
  const hands: KasinoGameState['hands'] = {};
  for (const player of state.players) hands[String(player.seatNumber)] = deck.splice(0, 4);
  const board = deck.splice(0, 4).map(card => ({ ...card, isBuild: false as const }));
  state.deck = deck;
  state.board = board;
  state.turnSeat = 0;
  state.lastTaker = null;
  state.captured = Object.fromEntries(state.players.map(player => [String(player.seatNumber), []]));
  state.sweeps = Object.fromEntries(state.players.map(player => [String(player.seatNumber), 0]));
  state.players = state.players.map(player => ({
    ...player,
    handCount: hands[String(player.seatNumber)]?.length ?? 0,
  }));
  state.hands = hands;
  state.winner = null;
}

function awardMost(
  seats: string[],
  captured: Record<string, KasinoCard[]>,
  scores: Record<string, number>,
  count: (cards: KasinoCard[]) => number,
): void {
  let maximum = 0;
  let leaders: string[] = [];
  for (const seat of seats) {
    const amount = count(captured[seat] ?? []);
    if (amount > maximum) {
      maximum = amount;
      leaders = [seat];
    } else if (amount === maximum) {
      leaders.push(seat);
    }
  }
  if (maximum > 0 && leaders.length === 1) {
    const seat = leaders[0]!;
    scores[seat] = (scores[seat] ?? 0) + 1;
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

function shuffle<T>(cards: T[]): T[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]!] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}
