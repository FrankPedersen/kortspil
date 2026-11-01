import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  InvalidPrincipalError,
  resolveAppServicePrincipal,
} from '../auth/app-service-principal.js';
import {
  LobbyError,
  type CreateTableInput,
  type LobbyRepository,
} from './types.js';
import { GameSnapshotSchema } from '../game/state.js';

const ErrorResponse = Type.Object({ message: Type.String() });
const ErrorResponses = {
  400: ErrorResponse,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
  409: ErrorResponse,
  429: ErrorResponse,
};

const Table = Type.Object({
  id: Type.String({ format: 'uuid' }),
  isHost: Type.Boolean(),
  gameType: Type.Union([Type.Literal('es-makker'), Type.Literal('kasino')]),
  visibility: Type.Union([Type.Literal('open'), Type.Literal('private')]),
  humanSeatCount: Type.Integer({ minimum: 1, maximum: 4 }),
  botSeatCount: Type.Integer({ minimum: 0, maximum: 3 }),
  occupiedHumanSeatCount: Type.Integer({ minimum: 1, maximum: 4 }),
  pendingRequestCount: Type.Integer({ minimum: 0 }),
  status: Type.Union([
    Type.Literal('waiting'),
    Type.Literal('active'),
    Type.Literal('finished'),
    Type.Literal('expired'),
  ]),
  createdAt: Type.String({ format: 'date-time' }),
});

const SeatRequest = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tableId: Type.String({ format: 'uuid' }),
  userSubject: Type.String(),
  isVip: Type.Boolean(),
  requestedAt: Type.String({ format: 'date-time' }),
});

interface RouteOptions {
  repository: LobbyRepository;
  appServiceAuthEnabled: boolean;
  vipAdminUserIds: ReadonlySet<string>;
  publicAppUrl: string;
}

export async function registerLobbyRoutes(
  app: FastifyInstance,
  options: RouteOptions,
): Promise<void> {
  const { repository } = options;

  app.get('/api/v1/tables', {
    schema: {
      tags: ['lobby'],
      summary: 'List open waiting tables and the current player’s tables.',
      response: { 200: Type.Array(Table), ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    reply.header('Cache-Control', 'no-store');
    return repository.listTables(principal.subject);
  });

  app.post('/api/v1/tables', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['lobby'],
      summary: 'Create a waiting table as an authenticated host.',
      body: Type.Object({
        gameType: Type.Union([Type.Literal('es-makker'), Type.Literal('kasino')]),
        visibility: Type.Union([Type.Literal('open'), Type.Literal('private')]),
        humanSeatCount: Type.Integer({ minimum: 1, maximum: 4 }),
        botSeatCount: Type.Integer({ minimum: 0, maximum: 3 }),
      }, { additionalProperties: false }),
      response: { 201: Table, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    const table = await repository.createTable(principal.subject, request.body as CreateTableInput);
    reply.header('Cache-Control', 'no-store');
    return reply.code(201).send(table);
  });

  app.post('/api/v1/tables/:tableId/requests', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['lobby'],
      summary: 'Request a human seat. Private tables require an invitation token.',
      params: Type.Object({ tableId: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        invitationToken: Type.Optional(Type.String({ minLength: 40, maxLength: 50, pattern: '^[A-Za-z0-9_-]+$' })),
      }, { additionalProperties: false }),
      response: {
        202: Type.Object({ status: Type.Literal('pending') }),
        ...ErrorResponses,
      },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    const { tableId } = request.params as { tableId: string };
    const { invitationToken } = request.body as { invitationToken?: string };
    const invitationTokenHash = invitationToken
      ? createHash('sha256').update(invitationToken).digest()
      : undefined;
    await repository.requestSeat(tableId, principal.subject, invitationTokenHash);
    reply.header('Cache-Control', 'no-store');
    return reply.code(202).send({ status: 'pending' as const });
  });

  app.get('/api/v1/tables/:tableId/requests', {
    schema: {
      tags: ['lobby'],
      summary: 'List pending seat requests in VIP-first order for the host.',
      params: Type.Object({ tableId: Type.String({ format: 'uuid' }) }),
      response: { 200: Type.Array(SeatRequest), ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    const { tableId } = request.params as { tableId: string };
    reply.header('Cache-Control', 'no-store');
    return repository.listSeatRequests(tableId, principal.subject);
  });

  app.put('/api/v1/seat-requests/:requestId', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['lobby'],
      summary: 'Accept or decline a pending seat request as the table host.',
      params: Type.Object({ requestId: Type.String({ format: 'uuid' }) }),
      body: Type.Object({
        decision: Type.Union([Type.Literal('accept'), Type.Literal('decline')]),
      }, { additionalProperties: false }),
      response: { 204: Type.Null(), ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    const { requestId } = request.params as { requestId: string };
    const { decision } = request.body as { decision: 'accept' | 'decline' };
    await repository.decideSeatRequest(requestId, principal.subject, decision);
    return reply.code(204).send();
  });

  app.post('/api/v1/tables/:tableId/invitations', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: {
      tags: ['lobby'],
      summary: 'Create a 24-hour invitation for a private waiting table.',
      params: Type.Object({ tableId: Type.String({ format: 'uuid' }) }),
      response: {
        201: Type.Object({
          id: Type.String({ format: 'uuid' }),
          joinUrl: Type.String({ format: 'uri' }),
          expiresAt: Type.String({ format: 'date-time' }),
        }),
        ...ErrorResponses,
      },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    const { tableId } = request.params as { tableId: string };
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const id = await repository.createInvitation(
      tableId,
      principal.subject,
      createHash('sha256').update(token).digest(),
      expiresAt,
    );
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    return reply.code(201).send({
      id,
      joinUrl: `${options.publicAppUrl}/#join/${token}`,
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.delete('/api/v1/invitations/:invitationId', {
    schema: {
      tags: ['lobby'],
      summary: 'Revoke an invitation as the owner of its table.',
      params: Type.Object({ invitationId: Type.String({ format: 'uuid' }) }),
      response: { 204: Type.Null(), ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    const { invitationId } = request.params as { invitationId: string };
    await repository.revokeInvitation(invitationId, principal.subject);
    return reply.code(204).send();
  });

  app.post('/api/v1/tables/:tableId/start', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    schema: {
      tags: ['games'],
      summary: 'Start a waiting table after all configured human seats are occupied.',
      params: Type.Object({ tableId: Type.String({ format: 'uuid' }) }),
      response: { 200: GameSnapshotSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    const { tableId } = request.params as { tableId: string };
    const snapshot = await repository.startGame(tableId, principal.subject);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  });

  app.get('/api/v1/tables/:tableId/state', {
    schema: {
      tags: ['games'],
      summary: 'Resume an active game with the requesting player’s private snapshot.',
      params: Type.Object({ tableId: Type.String({ format: 'uuid' }) }),
      response: { 200: GameSnapshotSchema, ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    const { tableId } = request.params as { tableId: string };
    const snapshot = await repository.getGameSnapshot(tableId, principal.subject);
    reply.header('Cache-Control', 'no-store');
    return snapshot;
  });

  app.post('/api/v1/vip-requests', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    schema: {
      tags: ['vip'],
      summary: 'Request membership on the centrally managed VIP list.',
      response: {
        200: Type.Object({
          status: Type.Union([
            Type.Literal('pending'),
            Type.Literal('approved'),
            Type.Literal('denied'),
            Type.Literal('not-requested'),
          ]),
          requestedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
        }),
        ...ErrorResponses,
      },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    reply.header('Cache-Control', 'no-store');
    return repository.requestVip(principal.subject);
  });

  app.get('/api/v1/admin/vip-requests', {
    schema: {
      tags: ['admin'],
      summary: 'List pending VIP requests for the configured VIP administrator.',
      response: {
        200: Type.Array(Type.Object({
          userSubject: Type.String(),
          requestedAt: Type.String({ format: 'date-time' }),
        })),
        ...ErrorResponses,
      },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    if (!options.vipAdminUserIds.has(principal.subject)) {
      throw new LobbyError(403, 'VIP administrator access is required.');
    }
    reply.header('Cache-Control', 'no-store');
    return repository.listVipRequests();
  });

  app.get('/api/v1/admin/vip-members', {
    schema: {
      tags: ['admin'],
      summary: 'List current VIP members for the configured VIP administrator.',
      response: {
        200: Type.Array(Type.Object({
          userSubject: Type.String(),
          approvedAt: Type.String({ format: 'date-time' }),
        })),
        ...ErrorResponses,
      },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    if (!options.vipAdminUserIds.has(principal.subject)) {
      throw new LobbyError(403, 'VIP administrator access is required.');
    }
    reply.header('Cache-Control', 'no-store');
    return repository.listVipMembers();
  });

  app.put('/api/v1/admin/vip-requests', {
    schema: {
      tags: ['admin'],
      summary: 'Approve or deny a VIP request.',
      body: Type.Object({
        userSubject: Type.String({ minLength: 1, maxLength: 300 }),
        decision: Type.Union([Type.Literal('approve'), Type.Literal('deny')]),
      }, { additionalProperties: false }),
      response: { 204: Type.Null(), ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    if (!options.vipAdminUserIds.has(principal.subject)) {
      throw new LobbyError(403, 'VIP administrator access is required.');
    }
    const { userSubject, decision } = request.body as {
      userSubject: string;
      decision: 'approve' | 'deny';
    };
    await repository.decideVipRequest(userSubject, principal.subject, decision);
    return reply.code(204).send();
  });

  app.delete('/api/v1/admin/vip-members', {
    schema: {
      tags: ['admin'],
      summary: 'Remove a user from the VIP list and record the administrative action.',
      body: Type.Object({
        userSubject: Type.String({ minLength: 1, maxLength: 300 }),
      }, { additionalProperties: false }),
      response: { 204: Type.Null(), ...ErrorResponses },
    },
  }, async (request, reply) => {
    const principal = getPrincipal(request, reply, options);
    if (!principal) return reply;
    if (!options.vipAdminUserIds.has(principal.subject)) {
      throw new LobbyError(403, 'VIP administrator access is required.');
    }
    const { userSubject } = request.body as { userSubject: string };
    await repository.decideVipRequest(userSubject, principal.subject, 'remove');
    return reply.code(204).send();
  });
}

export function getPrincipal(
  request: FastifyRequest,
  reply: FastifyReply,
  options: Pick<RouteOptions, 'appServiceAuthEnabled'>,
) {
  try {
    const principal = resolveAppServicePrincipal(request, options.appServiceAuthEnabled);
    if (!principal) {
      reply.code(401).send({ message: 'Sign in is required for multiplayer.' });
      return null;
    }
    return principal;
  } catch (error) {
    if (error instanceof InvalidPrincipalError) {
      reply.code(401).send({ message: 'Invalid authenticated identity.' });
      return null;
    }
    throw error;
  }
}
