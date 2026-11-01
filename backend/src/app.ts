import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import swagger from '@fastify/swagger';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Type, type Static } from '@sinclair/typebox';
import {
  InvalidPrincipalError,
  resolveAppServicePrincipal,
} from './auth/app-service-principal.js';
import { LobbyError, type LobbyRepository } from './lobby/types.js';
import { MemoryLobbyRepository } from './lobby/memory-repository.js';
import { registerLobbyRoutes } from './lobby/routes.js';

const HealthResponse = Type.Object({
  status: Type.Literal('ok'),
});

const SessionIdentity = Type.Object({
  subject: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  provider: Type.Literal('aad'),
  vipAdministrator: Type.Boolean(),
});

const SessionResponse = Type.Object({
  identity: Type.Union([SessionIdentity, Type.Null()]),
});

const ErrorResponse = Type.Object({
  message: Type.String(),
});

type SessionResponseBody = Static<typeof SessionResponse>;

export interface AppOptions {
  appServiceAuthEnabled?: boolean;
  vipAdminUserIds?: ReadonlySet<string>;
  publicAppUrl?: string;
  lobbyRepository?: LobbyRepository;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  if (process.env.NODE_ENV === 'production' && !options.lobbyRepository) {
    throw new Error('A durable SQL lobby repository must be configured in production.');
  }
  const app = Fastify({
    logger: false,
    bodyLimit: 16 * 1024,
    routerOptions: { maxParamLength: 128 },
  });
  const authEnabled = options.appServiceAuthEnabled ??
    process.env.KORTSPIL_APP_SERVICE_AUTH_ENABLED === 'true';
  const vipAdminUserIds = options.vipAdminUserIds ?? parseVipAdminUserIds();
  const publicAppUrl = options.publicAppUrl ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:3000';
  const lobbyRepository = options.lobbyRepository ?? new MemoryLobbyRepository();
  const parsedPublicAppUrl = parsePublicAppUrl(publicAppUrl);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Kortspil API',
        version: '0.1.0',
        description: 'API foundation for Kortspil identity, lobby, and multiplayer games.',
      },
      tags: [
        { name: 'system', description: 'Service health and readiness.' },
        { name: 'session', description: 'Current authenticated identity.' },
        { name: 'lobby', description: 'Multiplayer table lobby.' },
        { name: 'games', description: 'Server-owned game lifecycle and private snapshots.' },
        { name: 'vip', description: 'VIP list membership.' },
        { name: 'admin', description: 'VIP administration.' },
      ],
    },
  });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ message: 'Too many requests. Please try again later.' }),
  });
  await app.register(fastifyStatic, {
    root: resolve(process.cwd(), 'public', 'lobby'),
    prefix: '/lobby/',
    index: ['index.html'],
    cacheControl: false,
  });
  const kasinoAssets = resolve(process.cwd(), 'public', 'kasino');
  if (process.env.NODE_ENV === 'production' && !existsSync(kasinoAssets)) {
    throw new Error('The Kasino client must be built into backend/public/kasino before production startup.');
  }
  if (existsSync(kasinoAssets)) {
    await app.register(fastifyStatic, {
      root: kasinoAssets,
      prefix: '/kasino/',
      index: ['index.html'],
      cacheControl: false,
      decorateReply: false,
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (typeof origin !== 'string') {
      return reply.code(403).send({ message: 'A same-origin request is required.' });
    }

    let requestOrigin: string | null = null;
    const forwardedProtocol = request.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProtocol === 'string'
      ? forwardedProtocol.split(',')[0]?.trim()
      : request.protocol;
    const host = request.headers.host;
    if (protocol && host) {
      try {
        requestOrigin = new URL(`${protocol}://${host}`).origin;
      } catch {
        requestOrigin = null;
      }
    }

    if (origin !== parsedPublicAppUrl.origin && origin !== requestOrigin) {
      return reply.code(403).send({ message: 'Cross-origin requests are not allowed.' });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof LobbyError) {
      return reply.code(error.statusCode).send({ message: error.message });
    }
    if (typeof error === 'object' && error !== null && 'validation' in error && error.validation) {
      return reply.code(400).send({ message: 'Request validation failed.' });
    }
    console.error(`Unhandled API error for request ${request.id}.`, error);
    return reply.code(500).send({ message: 'Internal server error.' });
  });

  app.get('/healthz', {
    schema: {
      tags: ['system'],
      summary: 'Check whether the API process is responsive.',
      response: { 200: HealthResponse },
    },
  }, async () => ({ status: 'ok' as const }));

  app.get('/api/v1/session', {
    schema: {
      tags: ['session'],
      summary: 'Resolve the current App Service Authentication identity.',
      response: {
        200: SessionResponse,
        401: ErrorResponse,
      },
    },
  }, async (request, reply): Promise<SessionResponseBody | FastifyReply> => {
    reply.header('Cache-Control', 'no-store');
    try {
      const principal = resolveAppServicePrincipal(request, authEnabled);
      if (!principal) return { identity: null };

      return {
        identity: {
          ...principal,
          vipAdministrator: vipAdminUserIds.has(principal.subject),
        },
      };
    } catch (error) {
      if (error instanceof InvalidPrincipalError) {
        return reply.code(401).send({ message: 'Invalid authenticated identity.' });
      }
      throw error;
    }
  });

  app.get('/openapi.json', {
    schema: { hide: true },
  }, async () => app.swagger());

  await registerLobbyRoutes(app, {
    repository: lobbyRepository,
    appServiceAuthEnabled: authEnabled,
    vipAdminUserIds,
    publicAppUrl: publicAppUrl.replace(/\/+$/, ''),
  });

  return app;
}

function parseVipAdminUserIds(): ReadonlySet<string> {
  return new Set(
    (process.env.VIP_ADMIN_USER_IDS ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
}

function parsePublicAppUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_APP_URL must be an absolute HTTP(S) URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('PUBLIC_APP_URL must be an HTTP(S) base URL without credentials, query, or fragment.');
  }
  return url;
}
