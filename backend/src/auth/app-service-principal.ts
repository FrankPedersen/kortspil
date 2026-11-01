import type { FastifyRequest } from 'fastify';

export interface AuthenticatedPrincipal {
  subject: string;
  displayName: string | null;
  provider: 'aad';
}

interface AppServicePrincipalPayload {
  userId?: unknown;
  identityProvider?: unknown;
  auth_typ?: unknown;
  claims?: unknown;
  name_typ?: unknown;
}

interface PrincipalClaim {
  typ: string;
  val: string;
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
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (!isRecord(parsed)) throw new InvalidPrincipalError();
    payload = parsed;
  } catch {
    throw new InvalidPrincipalError();
  }

  const provider = payload.identityProvider ?? payload.auth_typ;
  if (typeof provider !== 'string' || provider.toLowerCase() !== 'aad') {
    throw new InvalidPrincipalError();
  }

  const claims = payload.claims === undefined ? [] : parseClaims(payload.claims);
  const subject = nonEmptyString(payload.userId) ??
    findClaim(claims, [
      'http://schemas.microsoft.com/identity/claims/objectidentifier',
      'oid',
      'sub',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier',
      'nameidentifier',
    ]) ??
    nonEmptyString(request.headers['x-ms-client-principal-id']);
  if (!subject) throw new InvalidPrincipalError();

  const displayName = (typeof payload.name_typ === 'string'
    ? findClaim(claims, [payload.name_typ])
    : undefined) ??
    findClaim(claims, [
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
      'name',
    ]) ??
    nonEmptyString(request.headers['x-ms-client-principal-name']) ??
    null;

  return {
    subject,
    displayName,
    provider: 'aad',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseClaims(value: unknown): PrincipalClaim[] {
  if (!Array.isArray(value)) throw new InvalidPrincipalError();
  return value.map(claim => {
    if (!isRecord(claim) || typeof claim.typ !== 'string' || typeof claim.val !== 'string') {
      throw new InvalidPrincipalError();
    }
    return { typ: claim.typ, val: claim.val };
  });
}

function findClaim(claims: PrincipalClaim[], types: string[]): string | undefined {
  const acceptedTypes = new Set(types.map(type => type.toLowerCase()));
  return claims.find(claim =>
    acceptedTypes.has(claim.typ.toLowerCase()) && claim.val.length > 0,
  )?.val;
}
