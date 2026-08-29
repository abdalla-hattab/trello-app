import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://agent@example.invalid/agent',
  ALLOWED_ORIGINS: 'https://app.example'
};

test('production refuses static browser tokens unless risk is explicitly accepted', () => {
  assert.throws(() => loadConfig({
    ...base, NODE_ENV: 'production', AUTH_MODE: 'token',
    AGENT_API_TOKENS: 'company=token-that-is-longer-than-thirty-two-characters'
  }), /Production requires OIDC/);
});

test('production accepts a fully constrained OIDC verifier without static tokens', () => {
  const config = loadConfig({
    ...base, NODE_ENV: 'production', AUTH_MODE: 'oidc',
    OIDC_ISSUER: 'https://identity.example',
    OIDC_AUDIENCE: 'website-agent',
    OIDC_JWKS_URL: 'https://identity.example/jwks',
    OIDC_ALGORITHMS: 'RS256',
    OIDC_FIXED_ORGANIZATION_ID: 'company'
  });
  assert.equal(config.authMode, 'oidc');
  assert.deepEqual(config.oidc.algorithms, ['RS256']);
});

test('migration configuration does not require API authentication secrets', () => {
  const config = loadConfig({ ...base, NODE_ENV: 'production' }, { requireAuth: false });
  assert.equal(config.databaseUrl, base.DATABASE_URL);
  assert.equal(config.apiTokens.size, 0);
});
