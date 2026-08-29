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
  assert.deepEqual(config.database, { connectionString: base.DATABASE_URL });
  assert.equal(config.apiTokens.size, 0);
});

test('Codex worker configuration does not require an OpenAI API key or browser auth settings', () => {
  const config = loadConfig({
    DATABASE_URL: base.DATABASE_URL,
    NODE_ENV: 'production',
    AI_PROVIDER: 'codex',
    CODEX_COMMAND: '/Applications/ChatGPT.app/Contents/Resources/codex',
    CODEX_MODEL: 'gpt-5.6-sol'
  }, { requireAI: true, requireAuth: false });
  assert.equal(config.aiProvider, 'codex');
  assert.equal(config.codexModel, 'gpt-5.6-sol');
  assert.equal(config.allowedOrigins.size, 0);
  assert.equal(config.openAIKey, '');
});

test('OpenAI worker configuration still requires its API key', () => {
  assert.throws(() => loadConfig({
    DATABASE_URL: base.DATABASE_URL,
    AI_PROVIDER: 'openai'
  }, { requireAI: true, requireAuth: false }), /OPENAI_API_KEY/);
});

test('PostgreSQL accepts separate connection settings without URL-encoding the password', () => {
  const config = loadConfig({
    ALLOWED_ORIGINS: 'https://app.example',
    DB_HOST: 'pooler.example.com',
    DB_PORT: '5432',
    DB_NAME: 'postgres',
    DB_USER: 'postgres.company',
    DB_PASSWORD: 'raw password %:/ remains unchanged'
  }, { requireAuth: false });
  assert.deepEqual(config.database, {
    host: 'pooler.example.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.company',
    password: 'raw password %:/ remains unchanged'
  });
  assert.equal(config.databaseUrl, '');
});

test('PostgreSQL rejects incomplete or ambiguous connection settings', () => {
  assert.throws(() => loadConfig({
    ...base,
    DB_PASSWORD: 'also-set'
  }, { requireAuth: false }), /either DATABASE_URL or the separate DB_\*/);
  assert.throws(() => loadConfig({
    ALLOWED_ORIGINS: 'https://app.example',
    DB_HOST: 'pooler.example.com'
  }, { requireAuth: false }), /Incomplete PostgreSQL configuration/);
});
