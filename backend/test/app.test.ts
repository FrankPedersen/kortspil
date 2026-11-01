import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { MemoryLobbyRepository } from '../src/lobby/memory-repository.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

async function createApp(options: Parameters<typeof buildApp>[0] = {}) {
  const app = await buildApp(options);
  apps.push(app);
  return app;
}

test('health endpoint reports readiness without exposing runtime details', async () => {
  const app = await createApp();
  const response = await app.inject({ method: 'GET', url: '/healthz' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('lobby page and assets are served by the API', async () => {
  const app = await createApp();
  const page = await app.inject({ method: 'GET', url: '/lobby/' });
  const script = await app.inject({ method: 'GET', url: '/lobby/lobby.js' });
  const esMakkerPage = await app.inject({ method: 'GET', url: '/es-makker/' });
  const esMakkerScript = await app.inject({ method: 'GET', url: '/es-makker/js/multiplayer.js' });

  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type'] ?? '', /text\/html/);
  assert.match(page.body, /Online lobby/);
  assert.equal(script.statusCode, 200);
  assert.match(script.headers['content-type'] ?? '', /javascript/);
  assert.equal(esMakkerPage.statusCode, 200);
  assert.match(esMakkerPage.body, /js\/entry\.js/);
  assert.equal(esMakkerScript.statusCode, 200);
  assert.match(esMakkerScript.headers['content-type'] ?? '', /javascript/);
});

test('session endpoint reports an anonymous identity when App Service Authentication is disabled', async () => {
  const app = await createApp({ appServiceAuthEnabled: false });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/session',
    headers: {
      'x-ms-client-principal': Buffer.from(JSON.stringify({
        userId: 'spoofed-user',
        identityProvider: 'aad',
      })).toString('base64'),
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { identity: null });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('session endpoint resolves an Azure AD identity and configured VIP administrator', async () => {
  const subject = 'tenant-user-123';
  const app = await createApp({
    appServiceAuthEnabled: true,
    vipAdminUserIds: new Set([subject]),
  });
  const principal = Buffer.from(JSON.stringify({
    userId: subject,
    userDetails: 'Frank',
    identityProvider: 'aad',
  })).toString('base64');
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/session',
    headers: { 'x-ms-client-principal': principal },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    identity: {
      subject,
      displayName: null,
      provider: 'aad',
      vipAdministrator: true,
    },
  });
});

test('session endpoint resolves the documented App Service claims principal', async () => {
  const subject = 'entra-object-id-123';
  const app = await createApp({
    appServiceAuthEnabled: true,
    vipAdminUserIds: new Set([subject]),
  });
  const principal = Buffer.from(JSON.stringify({
    auth_typ: 'aad',
    claims: [
      { typ: 'http://schemas.microsoft.com/identity/claims/objectidentifier', val: subject },
      { typ: 'name', val: 'Frank' },
    ],
    name_typ: 'name',
    role_typ: 'role',
  })).toString('base64');
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/session',
    headers: { 'x-ms-client-principal': principal },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    identity: {
      subject,
      displayName: 'Frank',
      provider: 'aad',
      vipAdministrator: true,
    },
  });
});

test('session endpoint rejects an App Service claims principal without a stable subject', async () => {
  const app = await createApp({ appServiceAuthEnabled: true });
  const principal = Buffer.from(JSON.stringify({
    auth_typ: 'aad',
    claims: [{ typ: 'name', val: 'Frank' }],
    name_typ: 'name',
  })).toString('base64');
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/session',
    headers: { 'x-ms-client-principal': principal },
  });

  assert.equal(response.statusCode, 401);
});

test('session endpoint rejects a malformed trusted principal header', async () => {
  const app = await createApp({ appServiceAuthEnabled: true });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/session',
    headers: { 'x-ms-client-principal': 'not-valid-base64-json' },
  });

  assert.equal(response.statusCode, 401);
});

test('OpenAPI describes the health and session contracts', async () => {
  const app = await createApp();
  await app.ready();
  const document = app.swagger();

  assert.ok(document.paths?.['/healthz']?.get);
  assert.ok(document.paths?.['/api/v1/session']?.get);
  assert.equal(document.openapi, '3.1.0');
});

test('OpenAPI contract is available without exposing authenticated data', async () => {
  const app = await createApp();
  const response = await app.inject({ method: 'GET', url: '/openapi.json' });

  assert.equal(response.statusCode, 200);
  assert.ok(response.json().paths['/api/v1/session']);
});

function authHeaders(subject: string, origin = 'http://localhost:3000') {
  return {
    origin,
    'x-ms-client-principal': Buffer.from(JSON.stringify({
      userId: subject,
      identityProvider: 'aad',
    })).toString('base64'),
  };
}

test('authenticated players can request a seat and only the host can approve it', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    lobbyRepository: new MemoryLobbyRepository(),
  });
  const hostHeaders = authHeaders('host');
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: hostHeaders,
    payload: {
      gameType: 'es-makker',
      visibility: 'open',
      humanSeatCount: 4,
      botSeatCount: 0,
    },
  });
  assert.equal(create.statusCode, 201);
  const table = create.json();
  assert.equal(table.isHost, true);
  assert.equal('ownerSubject' in table, false);

  const request = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${table.id}/requests`,
    headers: authHeaders('player'),
    payload: {},
  });
  assert.equal(request.statusCode, 202);

  const pending = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${table.id}/requests`,
    headers: hostHeaders,
  });
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.json().length, 1);

  const deniedHost = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${table.id}/requests`,
    headers: authHeaders('other'),
  });
  assert.equal(deniedHost.statusCode, 403);

  const decide = await app.inject({
    method: 'PUT',
    url: `/api/v1/seat-requests/${pending.json()[0].id}`,
    headers: hostHeaders,
    payload: { decision: 'accept' },
  });
  assert.equal(decide.statusCode, 204);
  const tables = await app.inject({
    method: 'GET',
    url: '/api/v1/tables',
    headers: authHeaders('player'),
  });
  assert.equal(tables.json()[0].occupiedHumanSeatCount, 2);
  assert.equal(tables.json()[0].isHost, false);
});

test('private table invitations are hashed, can be revoked, and require the invite token', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    lobbyRepository: new MemoryLobbyRepository(),
    publicAppUrl: 'https://kortspil.example.test',
  });
  const hostHeaders = authHeaders('host', 'https://kortspil.example.test');
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: hostHeaders,
    payload: {
      gameType: 'kasino',
      visibility: 'private',
      humanSeatCount: 2,
      botSeatCount: 0,
    },
  });
  const tableId = create.json().id as string;
  const createdInvitation = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/invitations`,
    headers: hostHeaders,
  });
  assert.equal(createdInvitation.statusCode, 201);
  const token = new URL(createdInvitation.json().joinUrl).hash.split('/')[1];
  assert.equal(typeof token, 'string');

  const request = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/requests`,
    headers: authHeaders('player', 'https://kortspil.example.test'),
    payload: { invitationToken: token },
  });
  assert.equal(request.statusCode, 202);

  const revoked = await app.inject({
    method: 'DELETE',
    url: `/api/v1/invitations/${createdInvitation.json().id}`,
    headers: hostHeaders,
  });
  assert.equal(revoked.statusCode, 204);

  const invalidRequest = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/requests`,
    headers: authHeaders('another-player', 'https://kortspil.example.test'),
    payload: { invitationToken: token },
  });
  assert.equal(invalidRequest.statusCode, 403);
});

test('VIP administration is restricted to configured subject IDs', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    vipAdminUserIds: new Set(['admin']),
    lobbyRepository: new MemoryLobbyRepository(),
  });
  const requested = await app.inject({
    method: 'POST',
    url: '/api/v1/vip-requests',
    headers: authHeaders('player'),
  });
  assert.equal(requested.statusCode, 200);
  assert.equal(requested.json().status, 'pending');

  const denied = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/vip-requests',
    headers: authHeaders('player'),
  });
  assert.equal(denied.statusCode, 403);

  const approved = await app.inject({
    method: 'PUT',
    url: '/api/v1/admin/vip-requests',
    headers: authHeaders('admin'),
    payload: { userSubject: 'player', decision: 'approve' },
  });
  assert.equal(approved.statusCode, 204);

  const status = await app.inject({
    method: 'POST',
    url: '/api/v1/vip-requests',
    headers: authHeaders('player'),
  });
  assert.equal(status.json().status, 'approved');
});

test('mutations reject missing authentication and cross-origin requests', async () => {
  const app = await createApp({ appServiceAuthEnabled: true });
  const unauthenticated = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: { origin: 'http://localhost:3000' },
    payload: {
      gameType: 'kasino',
      visibility: 'open',
      humanSeatCount: 2,
      botSeatCount: 0,
    },
  });
  assert.equal(unauthenticated.statusCode, 401);

  const crossOrigin = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: authHeaders('host', 'https://attacker.example'),
    payload: {
      gameType: 'kasino',
      visibility: 'open',
      humanSeatCount: 2,
      botSeatCount: 0,
    },
  });
  assert.equal(crossOrigin.statusCode, 403);
});

test('mutations accept the API same-origin when the public website URL is different', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    lobbyRepository: new MemoryLobbyRepository(),
    publicAppUrl: 'https://www.kontraktbridge.dk/kortspil',
  });
  const sameOrigin = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: {
      ...authHeaders('host'),
      host: 'localhost:3000',
    },
    payload: {
      gameType: 'kasino',
      visibility: 'open',
      humanSeatCount: 2,
      botSeatCount: 0,
    },
  });
  assert.equal(sameOrigin.statusCode, 201);

  const attacker = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: {
      ...authHeaders('attacker'),
      origin: 'https://attacker.example',
    },
    payload: {
      gameType: 'kasino',
      visibility: 'open',
      humanSeatCount: 2,
      botSeatCount: 0,
    },
  });
  assert.equal(attacker.statusCode, 403);
});

test('Kasino starts on the server and reconnect returns only each seated player’s hand', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    lobbyRepository: new MemoryLobbyRepository(),
  });
  const hostHeaders = authHeaders('host');
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: hostHeaders,
    payload: {
      gameType: 'kasino',
      visibility: 'open',
      humanSeatCount: 2,
      botSeatCount: 0,
    },
  });
  const tableId = create.json().id as string;
  const request = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/requests`,
    headers: authHeaders('player'),
    payload: {},
  });
  assert.equal(request.statusCode, 202);
  const pending = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/requests`,
    headers: hostHeaders,
  });
  const accepted = await app.inject({
    method: 'PUT',
    url: `/api/v1/seat-requests/${pending.json()[0].id}`,
    headers: hostHeaders,
    payload: { decision: 'accept' },
  });
  assert.equal(accepted.statusCode, 204);

  const started = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/start`,
    headers: hostHeaders,
  });
  assert.equal(started.statusCode, 200);
  const hostSnapshot = started.json();
  assert.equal(hostSnapshot.gameType, 'kasino');
  assert.equal(hostSnapshot.hand.length, 4);
  assert.equal(hostSnapshot.board.length, 4);
  assert.equal('deck' in hostSnapshot, false);

  const reconnect = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/state`,
    headers: hostHeaders,
  });
  assert.equal(reconnect.statusCode, 200);
  assert.deepEqual(reconnect.json(), hostSnapshot);

  const playerSnapshot = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/state`,
    headers: authHeaders('player'),
  });
  assert.equal(playerSnapshot.statusCode, 200);
  assert.equal(playerSnapshot.json().hand.length, 4);
  assert.equal(
    playerSnapshot.json().hand.some((card: { id: string }) =>
      hostSnapshot.hand.some((hostCard: { id: string }) => hostCard.id === card.id)),
    false,
  );

  const spectator = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/state`,
    headers: authHeaders('spectator'),
  });
  assert.equal(spectator.statusCode, 403);

  const duplicateStart = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/start`,
    headers: hostHeaders,
  });
  assert.equal(duplicateStart.statusCode, 409);
});

test('Es Makker starts with four human hands and a hidden three-card kitty', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    lobbyRepository: new MemoryLobbyRepository(),
  });
  const started = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: authHeaders('host'),
    payload: {
      gameType: 'es-makker',
      visibility: 'open',
      humanSeatCount: 4,
      botSeatCount: 0,
    },
  });
  const tableId = started.json().id as string;
  for (let index = 1; index < 4; index += 1) {
    const request = await app.inject({
      method: 'POST',
      url: `/api/v1/tables/${tableId}/requests`,
      headers: authHeaders(`player-${index}`),
      payload: {},
    });
    assert.equal(request.statusCode, 202);
    const pending = await app.inject({
      method: 'GET',
      url: `/api/v1/tables/${tableId}/requests`,
      headers: authHeaders('host'),
    });
    const accepted = await app.inject({
      method: 'PUT',
      url: `/api/v1/seat-requests/${pending.json()[0].id}`,
      headers: authHeaders('host'),
      payload: { decision: 'accept' },
    });
    assert.equal(accepted.statusCode, 204);
  }
  const start = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/start`,
    headers: authHeaders('host'),
  });
  assert.equal(start.statusCode, 200);
  const snapshot = start.json();
  const bidder = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/state`,
    headers: authHeaders(`player-${snapshot.turnSeat}`),
  });
  const bidderSnapshot = bidder.json();
  assert.equal(snapshot.gameType, 'es-makker');
  assert.equal(snapshot.phase, 'bidding');
  assert.equal(snapshot.players.length, 4);
  assert.equal(snapshot.hand.length, 13);
  assert.equal(snapshot.kittyCount, 3);
  assert.equal(bidderSnapshot.legalBids.length, 32);
  assert.equal(snapshot.kitty.length, 0);
  assert.equal('hands' in snapshot, false);
  assert.equal('userSubject' in snapshot.players[0], false);
});

test('Es Makker actions are private, phase-checked, and versioned through a complete deal', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    lobbyRepository: new MemoryLobbyRepository(),
  });
  const hostSubject = 'host';
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: authHeaders(hostSubject),
    payload: {
      gameType: 'es-makker',
      visibility: 'open',
      humanSeatCount: 4,
      botSeatCount: 0,
    },
  });
  assert.equal(create.statusCode, 201);
  const tableId = create.json().id as string;
  for (let seat = 1; seat < 4; seat += 1) {
    await app.inject({
      method: 'POST',
      url: `/api/v1/tables/${tableId}/requests`,
      headers: authHeaders(`player-${seat}`),
      payload: {},
    });
    const pending = await app.inject({
      method: 'GET',
      url: `/api/v1/tables/${tableId}/requests`,
      headers: authHeaders(hostSubject),
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/seat-requests/${pending.json()[0].id}`,
      headers: authHeaders(hostSubject),
      payload: { decision: 'accept' },
    });
  }
  const start = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/start`,
    headers: authHeaders(hostSubject),
  });
  assert.equal(start.statusCode, 200);
  let state = start.json();
  const subjectForSeat = (seat: number) => seat === 0 ? hostSubject : `player-${seat}`;
  const getState = async (seat: number) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tables/${tableId}/state`,
      headers: authHeaders(subjectForSeat(seat)),
    });
    assert.equal(response.statusCode, 200);
    return response.json();
  };
  const submit = async (seat: number, version: number, action: unknown) => app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/es-makker-actions`,
    headers: authHeaders(subjectForSeat(seat)),
    payload: { expectedVersion: version, action },
  });

  const wrongPlayer = await submit((state.turnSeat + 1) % 4, state.version, { type: 'pass' });
  assert.equal(wrongPlayer.statusCode, 409);

  for (let pass = 0; pass < 4; pass += 1) {
    const response = await submit(state.turnSeat, state.version, { type: 'pass' });
    assert.equal(response.statusCode, 200, response.body);
    state = response.json();
  }
  assert.equal(state.phase, 'bidding');
  assert.equal(state.dealNumber, 2);

  const declarerSeat = state.turnSeat;
  const openingBid = await submit(declarerSeat, state.version, {
    type: 'bid',
    bid: { kind: 'normal', tricks: 7, variant: 'alm' },
  });
  assert.equal(openingBid.statusCode, 200, openingBid.body);
  state = openingBid.json();
  for (let pass = 0; pass < 3; pass += 1) {
    const response = await submit(state.turnSeat, state.version, { type: 'pass' });
    assert.equal(response.statusCode, 200, response.body);
    state = response.json();
  }
  assert.equal(state.phase, 'trump');
  state = await getState(declarerSeat);
  assert.equal(state.legalBids.length, 0);

  const trump = await submit(declarerSeat, state.version, { type: 'choose-trump', suit: 'clubs' });
  assert.equal(trump.statusCode, 200, trump.body);
  state = trump.json();
  assert.equal(state.phase, 'partner');
  state = await getState(declarerSeat);
  assert.ok(state.partnerCandidates.length > 0);
  const partner = await submit(declarerSeat, state.version, {
    type: 'choose-partner',
    cardId: state.partnerCandidates[0].cardId,
  });
  assert.equal(partner.statusCode, 200, partner.body);
  state = partner.json();
  assert.equal(state.phase, 'exchange');
  assert.equal(state.kitty.length, 3);

  const exchange = await submit(declarerSeat, state.version, { type: 'exchange', take: false });
  assert.equal(exchange.statusCode, 200, exchange.body);
  state = exchange.json();
  assert.equal(state.phase, 'playing');
  assert.ok(state.legalCardIds.length > 0);

  const stale = await submit(state.turnSeat, state.version - 1, {
    type: 'play-card',
    cardId: state.hand[0].id,
  });
  assert.equal(stale.statusCode, 409);

  for (let play = 0; play < 52 && state.roundResults.length === 0; play += 1) {
    state = await getState(state.turnSeat);
    assert.ok(state.legalCardIds.length > 0);
    const response = await submit(state.turnSeat, state.version, {
      type: 'play-card',
      cardId: state.legalCardIds[0],
    });
    assert.equal(response.statusCode, 200, response.body);
    state = response.json();
  }
  assert.equal(state.roundResults.length, 1);
  assert.equal(state.phase, 'bidding');
  assert.equal(Object.values(state.scores).reduce((sum: number, score: number) => sum + score, 0), 0);

  const spectator = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/state`,
    headers: authHeaders('spectator'),
  });
  assert.equal(spectator.statusCode, 403);
});

test('a host cannot start a table while requested human seats are still empty', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    lobbyRepository: new MemoryLobbyRepository(),
  });
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: authHeaders('host'),
    payload: {
      gameType: 'kasino',
      visibility: 'open',
      humanSeatCount: 2,
      botSeatCount: 0,
    },
  });
  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${create.json().id}/start`,
    headers: authHeaders('host'),
  });
  assert.equal(response.statusCode, 409);
});

test('Kasino turns are private, validated, and versioned', async () => {
  const app = await createApp({
    appServiceAuthEnabled: true,
    lobbyRepository: new MemoryLobbyRepository(),
  });
  const hostHeaders = authHeaders('host');
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/tables',
    headers: hostHeaders,
    payload: {
      gameType: 'kasino',
      visibility: 'open',
      humanSeatCount: 2,
      botSeatCount: 0,
    },
  });
  const tableId = create.json().id as string;
  await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/requests`,
    headers: authHeaders('player'),
    payload: {},
  });
  const pending = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/requests`,
    headers: hostHeaders,
  });
  await app.inject({
    method: 'PUT',
    url: `/api/v1/seat-requests/${pending.json()[0].id}`,
    headers: hostHeaders,
    payload: { decision: 'accept' },
  });
  const start = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/start`,
    headers: hostHeaders,
  });
  assert.equal(start.statusCode, 200);
  const hostSnapshot = start.json();
  const playerHeaders = authHeaders('player');

  const playerSnapshot = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/state`,
    headers: playerHeaders,
  });
  assert.equal(playerSnapshot.statusCode, 200);
  assert.equal(playerSnapshot.json().hand.length, 4);
  assert.equal('hands' in playerSnapshot.json(), false);
  assert.equal('deck' in playerSnapshot.json(), false);

  const handCardId = hostSnapshot.hand[0].id as string;
  const preview = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/move-options`,
    headers: hostHeaders,
    payload: { handCardId, targetItemIds: [] },
  });
  assert.equal(preview.statusCode, 200);
  const option = preview.json()[0];
  assert.ok(option);

  const outOfTurn = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/turns`,
    headers: playerHeaders,
    payload: {
      expectedVersion: hostSnapshot.version,
      action: { ...option, handCardId, targetItemIds: [] },
    },
  });
  assert.equal(outOfTurn.statusCode, 409);

  const illegal = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/turns`,
    headers: hostHeaders,
    payload: {
      expectedVersion: hostSnapshot.version,
      action: { type: 'STIK', handCardId, targetItemIds: ['not-on-the-table'] },
    },
  });
  assert.equal(illegal.statusCode, 400);

  const played = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/turns`,
    headers: hostHeaders,
    payload: {
      expectedVersion: hostSnapshot.version,
      action: { ...option, handCardId, targetItemIds: [] },
    },
  });
  assert.equal(played.statusCode, 200);
  assert.equal(played.json().version, hostSnapshot.version + 1);

  const stale = await app.inject({
    method: 'POST',
    url: `/api/v1/tables/${tableId}/turns`,
    headers: playerHeaders,
    payload: {
      expectedVersion: hostSnapshot.version,
      action: {
        type: 'SMID_UD',
        handCardId: playerSnapshot.json().hand[0].id,
        targetItemIds: [],
      },
    },
  });
  assert.equal(stale.statusCode, 409);
  const refreshed = await app.inject({
    method: 'GET',
    url: `/api/v1/tables/${tableId}/state`,
    headers: playerHeaders,
  });
  assert.equal(refreshed.json().version, played.json().version);
  assert.equal(refreshed.json().turnSeat, 1);
});
