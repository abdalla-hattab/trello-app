import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { createAuthenticator } from '../src/security/auth.js';

const request = token => ({ headers: { authorization: `Bearer ${token}` } });

test('OIDC authentication verifies issuer, audience, scope, subject, and organization', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key';
  publicJwk.alg = 'RS256';
  const keySet = createLocalJWKSet({ keys: [publicJwk] });
  const config = {
    authMode: 'oidc',
    oidc: {
      issuer: 'https://identity.example.com', audience: 'website-agent', jwksUrl: 'https://identity.example.com/jwks',
      algorithms: ['RS256'], organizationClaim: 'organization_id', fixedOrganizationId: '',
      requiredScope: 'website-agent', clockToleranceSeconds: 0
    }
  };
  const token = await new SignJWT({ organization_id: 'company-1', scope: 'openid website-agent' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(config.oidc.issuer).setAudience(config.oidc.audience).setSubject('user-7')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const identity = await createAuthenticator(config, { keySet })(request(token));
  assert.deepEqual(identity, { organizationId: 'company-1', actorId: 'oidc:user-7', authMode: 'oidc' });
});

test('OIDC authentication rejects a token for another audience', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key';
  const keySet = createLocalJWKSet({ keys: [publicJwk] });
  const config = {
    authMode: 'oidc',
    oidc: {
      issuer: 'https://identity.example.com', audience: 'website-agent', jwksUrl: 'https://identity.example.com/jwks',
      algorithms: ['RS256'], organizationClaim: 'organization_id', fixedOrganizationId: 'company-1',
      requiredScope: '', clockToleranceSeconds: 0
    }
  };
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(config.oidc.issuer).setAudience('another-service').setSubject('user-7')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  await assert.rejects(createAuthenticator(config, { keySet })(request(token)), error => error.code === 'UNAUTHORIZED');
});

test('static token authentication stays available for local development', async () => {
  const token = 'local-development-token-longer-than-thirty-two-characters';
  const authenticate = createAuthenticator({ authMode: 'token', apiTokens: new Map([[token, 'company-1']]) });
  const identity = await authenticate(request(token));
  assert.deepEqual(identity, { organizationId: 'company-1', actorId: 'api:company-1', authMode: 'token' });
});
