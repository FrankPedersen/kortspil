import type { FastifyRequest } from 'fastify';

export interface AuthenticatedPrincipal {
  subject: string;
  displayName: string | null;
  provider: 'aad';
}

interface AppServicePrincipalPayload {
  userId?: unknown;
  identityProvider?: unknown;
}

export class InvalidPrincipalError extends Error {
  constructor() {
    super('App Service returned an invalid authenticated principal.');
    this.name = 'InvalidPrincipalError';
  }
}

export function resolveAppServicePrincipal(
  request: FastifyRequest,
  authEnabled: boolean,
): AuthenticatedPrincipal | null {
  if (!authEnabled) return null;

  const encoded = request.headers['x-ms-client-principal'];
  if (typeof encoded !== 'string') return null;

  let payload: AppServicePrincipalPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as AppServicePrincipalPayload;
  } catch {
    throw new InvalidPrincipalError();
  }

  if (
    typeof payload.userId !== 'string' ||
    payload.userId.length === 0 ||
    typeof payload.identityProvider !== 'string' ||
    payload.identityProvider.toLowerCase() !== 'aad'
  ) {
    throw new InvalidPrincipalError();
  }

  return {
    subject: payload.userId,
    displayName: null,
    provider: 'aad',
  };
}
