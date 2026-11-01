import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyKasinoAction,
  getKasinoMoveOptions,
} from '../src/game/kasino-engine.js';
import {
  createGameSnapshot,
  createInitialGameState,
  parseGameState,
  type KasinoCard,
} from '../src/game/state.js';

function card(suit: KasinoCard['suit'], value: number): KasinoCard {
  const displayName = value === 1 ? 'A'
    : value === 11 ? 'J'
      : value === 12 ? 'Q'
        : value === 13 ? 'K'
          : String(value);
  const symbol = {
    SPADES: '♠',
    HEARTS: '♥',
    DIAMONDS: '♦',
    CLUBS: '♣',
  }[suit];
  const values = suit === 'DIAMONDS' && value === 10 ? [10, 16]
    : suit === 'SPADES' && value === 2 ? [2, 15]
      : value === 1 ? [1]
        : [value];
  return {
    id: `${suit}_${value}`,
    suit,
    value,
    displayName,
    symbol,
    name: `${suit} ${displayName}`,
    buildAs: values,
    captureAs: value === 1 ? [1, 14] : values,
    boardAs: value === 1 ? [1, 14] : values,
    isSweeper: suit === 'SPADES' && value === 5,
  };
}

test('Kasino builds survive state validation and remain visible in private snapshots', () => {
  const created = createInitialGameState('kasino', [
    { seatNumber: 0, kind: 'human', userSubject: 'host' },
    { seatNumber: 1, kind: 'human', userSubject: 'player' },
  ], 'host');
  assert.equal(created.gameType, 'kasino');
  if (created.gameType !== 'kasino') throw new Error('Expected Kasino state.');

  const state = structuredClone(created);
  const buildCard = card('HEARTS', 5);
  const boardCard = card('CLUBS', 5);
  state.hands = {
    '0': [buildCard, card('DIAMONDS', 10)],
    '1': [card('SPADES', 3)],
  };
  state.players = state.players.map(player => ({
    ...player,
    handCount: state.hands[String(player.seatNumber)]?.length ?? 0,
  }));
  state.deck = [];
  state.board = [boardCard];

  const options = getKasinoMoveOptions(state, 0, buildCard.id, [boardCard.id]);
  const build = options.find(option =>
    option.type === 'BYG_ENKELT' && option.buildValue === 10 && option.groupCount === 1,
  );
  assert.ok(build);

  const next = applyKasinoAction(state, 0, state.version, {
    ...build,
    handCardId: buildCard.id,
    targetItemIds: [boardCard.id],
  });
  const saved = parseGameState(JSON.stringify(next), 'kasino');
  assert.equal(saved.gameType, 'kasino');
  if (saved.gameType !== 'kasino') throw new Error('Expected Kasino state.');
  assert.equal(saved.board[0]?.isBuild, true);

  const snapshot = createGameSnapshot(saved, 'host');
  assert.equal(snapshot.gameType, 'kasino');
  if (snapshot.gameType !== 'kasino') throw new Error('Expected Kasino snapshot.');
  assert.equal(snapshot.board[0]?.isBuild, true);
});

test('Kasino ends immediately when a move reaches 21 points', () => {
  const created = createInitialGameState('kasino', [
    { seatNumber: 0, kind: 'human', userSubject: 'host' },
    { seatNumber: 1, kind: 'human', userSubject: 'player' },
  ], 'host');
  if (created.gameType !== 'kasino') throw new Error('Expected Kasino state.');
  const state = structuredClone(created);
  const sweeper = card('SPADES', 5);
  state.hands = { '0': [sweeper], '1': [card('HEARTS', 8)] };
  state.players = state.players.map(player => ({
    ...player,
    handCount: state.hands[String(player.seatNumber)]?.length ?? 0,
  }));
  state.deck = [];
  state.board = [card('CLUBS', 8)];
  state.baselineScores = { '0': 20, '1': 0 };
  state.scores = { ...state.baselineScores };

  const next = applyKasinoAction(state, 0, state.version, {
    type: 'SPAR_FEM',
    handCardId: sweeper.id,
    targetItemIds: [],
  });
  assert.equal(next.winner, 0);
  assert.equal(next.scores['0'], 21);
  assert.equal(next.roundNumber, 1);
});

test('Kasino starts the next deal with the first seat after a round ends', () => {
  const created = createInitialGameState('kasino', [
    { seatNumber: 0, kind: 'human', userSubject: 'host' },
    { seatNumber: 1, kind: 'human', userSubject: 'player' },
  ], 'host');
  if (created.gameType !== 'kasino') throw new Error('Expected Kasino state.');
  const state = structuredClone(created);
  const playedCard = card('HEARTS', 8);
  state.hands = { '0': [playedCard], '1': [] };
  state.players = state.players.map(player => ({
    ...player,
    handCount: state.hands[String(player.seatNumber)]?.length ?? 0,
  }));
  state.deck = [];
  state.board = [card('CLUBS', 3)];
  state.lastTaker = 1;

  const next = applyKasinoAction(state, 0, state.version, {
    type: 'SMID_UD',
    handCardId: playedCard.id,
    targetItemIds: [],
  });
  assert.equal(next.roundNumber, 2);
  assert.equal(next.turnSeat, 0);
  assert.equal(next.players.every(player => player.handCount === 4), true);
});
