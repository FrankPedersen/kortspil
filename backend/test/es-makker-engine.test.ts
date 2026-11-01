import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from '@sinclair/typebox/value';
import {
  applyEsMakkerAction,
  type EsMakkerAction,
} from '../src/game/es-makker-engine.js';
import {
  createGameSnapshot,
  createInitialGameState,
  MultiplayerGameStateSchema,
  parseGameState,
  type EsMakkerBid,
  type EsMakkerGameState,
} from '../src/game/state.js';

const seats = Array.from({ length: 4 }, (_, seatNumber) => ({
  seatNumber,
  kind: 'human' as const,
  userSubject: `player-${seatNumber}`,
}));

function newGame(): EsMakkerGameState {
  const state = createInitialGameState('es-makker', seats, 'player-0');
  assert.equal(state.gameType, 'es-makker');
  return state;
}

function act(state: EsMakkerGameState, action: EsMakkerAction): EsMakkerGameState {
  const next = applyEsMakkerAction(state, state.turnSeat, state.version, action);
  const parsed = parseGameState(JSON.stringify(next), 'es-makker');
  assert.equal(parsed.gameType, 'es-makker');
  assert.ok(Value.Check(MultiplayerGameStateSchema, parsed));
  return parsed;
}

function bidAndPass(state: EsMakkerGameState, bid: EsMakkerBid): EsMakkerGameState {
  let next = act(state, { type: 'bid', bid });
  for (let pass = 0; pass < 3; pass += 1) next = act(next, { type: 'pass' });
  return next;
}

function finishCurrentDeal(state: EsMakkerGameState): EsMakkerGameState {
  for (let play = 0; play < 52 && state.roundResults.length === 0; play += 1) {
    const snapshot = createGameSnapshot(state, `player-${state.turnSeat}`);
    assert.ok(snapshot.gameType === 'es-makker');
    assert.ok(snapshot.legalCardIds.length > 0);
    state = act(state, { type: 'play-card', cardId: snapshot.legalCardIds[0]! });
  }
  assert.equal(state.roundResults.length, 1);
  return state;
}

test('Vip requires exchanging three cards and stores a complete, schema-valid round', () => {
  let state = newGame();
  for (let pass = 0; pass < 4; pass += 1) state = act(state, { type: 'pass' });
  assert.equal(state.dealNumber, 2);

  state = bidAndPass(state, { kind: 'normal', tricks: 7, variant: 'vip' });
  assert.equal(state.phase, 'partner');
  assert.equal(state.kittyRevealed, true);
  const expectedTrump = [...state.kitty].reverse().find(card => !card.isJoker)?.suit ?? null;
  assert.equal(state.trump, expectedTrump);
  const publicSnapshot = createGameSnapshot(state, 'player-0');
  assert.ok(publicSnapshot.gameType === 'es-makker');
  assert.equal(publicSnapshot.shownKitty.length, 3);
  assert.deepEqual(publicSnapshot.kitty, []);

  const declarer = state.declarerSeat!;
  const declarerSnapshot = createGameSnapshot(state, `player-${declarer}`);
  assert.ok(declarerSnapshot.gameType === 'es-makker');
  const partnerCardId = declarerSnapshot.partnerCandidates[0]?.cardId;
  assert.ok(partnerCardId);
  state = act(state, { type: 'choose-partner', cardId: partnerCardId });
  assert.equal(state.phase, 'exchange');
  assert.throws(
    () => applyEsMakkerAction(state, state.turnSeat, state.version, { type: 'exchange', take: false }),
    /Cards must be exchanged in Vip/,
  );

  const discardIds = [
    ...(state.hands[String(declarer)] ?? []),
    ...state.kitty,
  ].slice(0, 3).map(card => card.id);
  state = act(state, { type: 'exchange', take: true, discardIds });
  assert.equal(state.phase, 'playing');
  assert.equal(state.hands[String(declarer)]?.length, 13);
  state = finishCurrentDeal(state);
  assert.equal(state.phase, 'bidding');
  assert.equal(Object.values(state.scores).reduce((sum, score) => sum + score, 0), 0);
});

test('Halve identifies the partner as the trump chooser and forbids their called suit', () => {
  let state = bidAndPass(newGame(), { kind: 'normal', tricks: 7, variant: 'halve' });
  assert.equal(state.phase, 'partner');
  const declarer = state.declarerSeat!;
  const snapshot = createGameSnapshot(state, `player-${declarer}`);
  assert.ok(snapshot.gameType === 'es-makker');
  const partnerCardId = snapshot.partnerCandidates[0]?.cardId;
  assert.ok(partnerCardId);

  state = act(state, { type: 'choose-partner', cardId: partnerCardId });
  assert.equal(state.phase, 'trump');
  assert.equal(state.partnerKnown, !state.selfPartner);
  const forbiddenSuit = state.partnerCard?.suit;
  const allowedSuit = (['clubs', 'diamonds', 'hearts', 'spades'] as const)
    .find(suit => suit !== forbiddenSuit);
  assert.ok(allowedSuit);
  state = act(state, { type: 'choose-trump', suit: allowedSuit });
  assert.equal(state.partnerKnown, !state.selfPartner);
  assert.equal(state.phase, 'exchange');
  state = act(state, { type: 'exchange', take: false });
  assert.equal(state.phase, 'playing');
});

test('special bids play alone without trump and finish with zero-sum scoring', () => {
  let state = bidAndPass(newGame(), { kind: 'special', special: 'sol' });
  assert.equal(state.phase, 'playing');
  assert.deepEqual(state.openHands, []);
  assert.equal(state.trump, null);
  assert.equal(state.aceLow, true);
  assert.equal(state.selfPartner, true);
  state = finishCurrentDeal(state);
  assert.equal(state.roundResults[0]?.basePoints, 3);
  assert.equal(Object.values(state.scores).reduce((sum, score) => sum + score, 0), 0);
});

test('only Super Bordlægger exposes all hands from the start', () => {
  for (const special of ['sol', 'rensol', 'bordlaegger', 'superbordlaegger'] as const) {
    const state = bidAndPass(newGame(), { kind: 'special', special });
    assert.deepEqual(
      state.openHands,
      special === 'superbordlaegger' ? [0, 1, 2, 3] : [],
      special,
    );
  }
});
