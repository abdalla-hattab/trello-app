import { createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from '../lib/errors.js';

function equal(left, right) {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function bearerToken(request) {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new AppError('Authentication is required.', { code: 'UNAUTHORIZED', status: 401 });
  if (match[1].length > 16_384) throw new AppError('The access token is invalid.', { code: 'UNAUTHORIZED', status: 401 });
  return match[1];
}

export function authenticateStaticToken(request, configuredTokens) {
  const presented = bearerToken(request);
  for (const [token, organizationId] of configuredTokens) {
    if (equal(presented, token)) return { organizationId, actorId: `api:${organizationId}`, authMode: 'token' };
  }
  throw new AppError('The access token is invalid.', { code: 'UNAUTHORIZED', status: 401 });
}

function claimText(payload, claim, label) {
  const value = payload[claim];
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`The verified identity is missing its ${label}.`, { code: 'IDENTITY_CLAIM_MISSING', status: 403 });
  }
  return value.trim();
}

function hasScope(payload, requiredScope) {
  if (!requiredScope) return true;
  const raw = payload.scope ?? payload.scp;
  const scopes = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s+/) : [];
  return scopes.includes(requiredScope);
}

export function createAuthenticator(config, { keySet } = {}) {
  const mode = config.authMode || 'token';
  if (mode === 'token') return async request => authenticateStaticToken(request, config.apiTokens);
  if (mode !== 'oidc') throw new AppError('Unsupported authentication mode.', { code: 'CONFIG_INVALID' });

  const oidc = config.oidc;
  const verifier = keySet || createRemoteJWKSet(new URL(oidc.jwksUrl), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000
  });
  return async request => {
    const token = bearerToken(request);
    let payload;
    try {
      ({ payload } = await jwtVerify(token, verifier, {
        issuer: oidc.issuer,
        audience: oidc.audience,
        algorithms: oidc.algorithms,
        clockTolerance: oidc.clockToleranceSeconds
      }));
    } catch {
      throw new AppError('The access token is invalid or expired.', { code: 'UNAUTHORIZED', status: 401 });
    }
    if (!hasScope(payload, oidc.requiredScope)) {
      throw new AppError('The verified identity is not allowed to use the website agent.', { code: 'INSUFFICIENT_SCOPE', status: 403 });
    }
    const organizationId = oidc.fixedOrganizationId || claimText(payload, oidc.organizationClaim, 'organization claim');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(organizationId)) {
      throw new AppError('The verified organization identifier is invalid.', { code: 'IDENTITY_CLAIM_INVALID', status: 403 });
    }
    return {
      organizationId,
      actorId: `oidc:${claimText(payload, 'sub', 'subject')}`,
      authMode: 'oidc'
    };
  };
}
