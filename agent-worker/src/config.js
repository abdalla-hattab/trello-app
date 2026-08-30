import path from 'node:path';
import { AppError } from './lib/errors.js';

const integer = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError(`Invalid numeric configuration value: ${value}`, { code: 'CONFIG_INVALID' });
  }
  return parsed;
};

function tokens(value) {
  const entries = new Map();
  for (const raw of String(value || '').split(',').map(item => item.trim()).filter(Boolean)) {
    const separator = raw.indexOf('=');
    if (separator < 1) throw new AppError('AGENT_API_TOKENS must use organization=token entries.', { code: 'CONFIG_INVALID' });
    const organizationId = raw.slice(0, separator).trim();
    const token = raw.slice(separator + 1).trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(organizationId) || token.length < 32) {
      throw new AppError('AGENT_API_TOKENS contains an invalid organization or a token shorter than 32 characters.', { code: 'CONFIG_INVALID' });
    }
    entries.set(token, organizationId);
  }
  return entries;
}

const organizationId = (value, label) => {
  const normalized = String(value || '').trim();
  if (normalized && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized)) {
    throw new AppError(`${label} is not a valid organization identifier.`, { code: 'CONFIG_INVALID' });
  }
  return normalized;
};

function oidcConfig(env) {
  const issuer = String(env.OIDC_ISSUER || '').trim().replace(/\/$/, '');
  const audience = String(env.OIDC_AUDIENCE || '').trim();
  const jwksUrl = String(env.OIDC_JWKS_URL || '').trim();
  const algorithms = String(env.OIDC_ALGORITHMS || 'RS256,ES256')
    .split(',').map(item => item.trim()).filter(Boolean);
  const allowedAlgorithms = new Set(['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']);
  if (!issuer || !audience || !jwksUrl) {
    throw new AppError('OIDC_ISSUER, OIDC_AUDIENCE, and OIDC_JWKS_URL are required for OIDC authentication.', { code: 'CONFIG_INVALID' });
  }
  try { new URL(issuer); new URL(jwksUrl); }
  catch { throw new AppError('OIDC issuer and JWKS settings must be valid HTTPS URLs.', { code: 'CONFIG_INVALID' }); }
  if (!issuer.startsWith('https://') || !jwksUrl.startsWith('https://')) {
    throw new AppError('OIDC issuer and JWKS URLs must use HTTPS.', { code: 'CONFIG_INVALID' });
  }
  if (!algorithms.length || algorithms.some(value => !allowedAlgorithms.has(value))) {
    throw new AppError('OIDC_ALGORITHMS contains an unsafe or unsupported signing algorithm.', { code: 'CONFIG_INVALID' });
  }
  const fixedOrganizationId = organizationId(env.OIDC_FIXED_ORGANIZATION_ID, 'OIDC_FIXED_ORGANIZATION_ID');
  const organizationClaim = String(env.OIDC_ORGANIZATION_CLAIM || 'organization_id').trim();
  if (!fixedOrganizationId && !/^[a-zA-Z0-9_.-]{1,80}$/.test(organizationClaim)) {
    throw new AppError('OIDC_ORGANIZATION_CLAIM is invalid.', { code: 'CONFIG_INVALID' });
  }
  return Object.freeze({
    issuer, audience, jwksUrl, algorithms,
    fixedOrganizationId,
    organizationClaim,
    requiredScope: String(env.OIDC_REQUIRED_SCOPE || '').trim(),
    clockToleranceSeconds: integer(env.OIDC_CLOCK_TOLERANCE_SECONDS, 5, { min: 0, max: 60 })
  });
}

function postgresConfig(env) {
  const connectionString = String(env.DATABASE_URL || '').trim();
  const componentNames = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const hasComponents = componentNames.some(name => env[name] !== undefined && env[name] !== '');
  if (connectionString && hasComponents) {
    throw new AppError('Use either DATABASE_URL or the separate DB_* settings, not both.', { code: 'CONFIG_INVALID' });
  }
  if (connectionString) return Object.freeze({ connectionString });
  if (!hasComponents) return null;

  const missing = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
    .filter(name => env[name] === undefined || env[name] === '');
  if (missing.length) {
    throw new AppError(`Incomplete PostgreSQL configuration; missing ${missing.join(', ')}.`, { code: 'CONFIG_INVALID' });
  }

  const host = String(env.DB_HOST).trim();
  const database = String(env.DB_NAME).trim();
  const user = String(env.DB_USER).trim();
  if (!host || /[\s/:]/.test(host) || !database || !user) {
    throw new AppError('DB_HOST, DB_NAME, or DB_USER is invalid.', { code: 'CONFIG_INVALID' });
  }
  return Object.freeze({
    host,
    port: integer(env.DB_PORT, 5432, { max: 65535 }),
    database,
    user,
    password: String(env.DB_PASSWORD)
  });
}

export function loadConfig(env = process.env, { requireAI = false, requireAuth = true } = {}) {
  const nodeEnv = env.NODE_ENV || 'development';
  const aiProvider = String(env.AI_PROVIDER || 'openai').trim().toLowerCase();
  const authMode = String(env.AUTH_MODE || 'token').trim().toLowerCase();
  const database = postgresConfig(env);
  const allowedOrigins = new Set(String(env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean));
  const apiTokens = requireAuth ? tokens(env.AGENT_API_TOKENS) : new Map();
  if (requireAuth && !['token', 'oidc'].includes(authMode)) throw new AppError('AUTH_MODE must be token or oidc.', { code: 'CONFIG_INVALID' });
  if (nodeEnv === 'production' && !database) {
    throw new AppError('PostgreSQL configuration is required in production; SQLite is not accepted as the production system of record.', { code: 'CONFIG_INVALID' });
  }
  if (requireAuth && nodeEnv === 'production' && (allowedOrigins.size === 0 || allowedOrigins.has('*'))) {
    throw new AppError('Production requires an explicit ALLOWED_ORIGINS list.', { code: 'CONFIG_INVALID' });
  }
  if (requireAuth && authMode === 'token' && apiTokens.size === 0) throw new AppError('At least one AGENT_API_TOKENS entry is required in token mode.', { code: 'CONFIG_INVALID' });
  if (requireAuth && nodeEnv === 'production' && authMode === 'token' && String(env.ALLOW_STATIC_TOKEN_AUTH).toLowerCase() !== 'true') {
    throw new AppError('Production requires OIDC authentication. Set AUTH_MODE=oidc, or explicitly accept static-token risk with ALLOW_STATIC_TOKEN_AUTH=true.', { code: 'CONFIG_INVALID' });
  }
  const oidc = requireAuth && authMode === 'oidc' ? oidcConfig(env) : null;
  if (!['openai', 'codex'].includes(aiProvider)) {
    throw new AppError('AI_PROVIDER must be openai or codex.', { code: 'CONFIG_INVALID' });
  }
  if (requireAI && aiProvider === 'openai' && !env.OPENAI_API_KEY) {
    throw new AppError('OPENAI_API_KEY is required when AI_PROVIDER=openai.', { code: 'CONFIG_INVALID' });
  }
  const codexCommand = String(env.CODEX_COMMAND || 'codex').trim();
  const codexModel = String(env.CODEX_MODEL || 'gpt-5.6-sol').trim();
  const codexWorkdir = path.resolve(env.CODEX_WORKDIR || process.cwd());
  if (!codexCommand || codexCommand.includes('\0') || !codexModel || codexModel.includes('\0')) {
    throw new AppError('CODEX_COMMAND or CODEX_MODEL is invalid.', { code: 'CONFIG_INVALID' });
  }
  const reasoningEffort = String(env.OPENAI_REASONING_EFFORT || 'medium').trim().toLowerCase();
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) {
    throw new AppError('OPENAI_REASONING_EFFORT is invalid.', { code: 'CONFIG_INVALID' });
  }
  const browserExecutablePath = String(env.BROWSER_EXECUTABLE_PATH || '').trim();
  if (browserExecutablePath && (!path.isAbsolute(browserExecutablePath) || browserExecutablePath.includes('\0'))) {
    throw new AppError('BROWSER_EXECUTABLE_PATH must be an absolute path.', { code: 'CONFIG_INVALID' });
  }
  const embeddingDimensions = integer(env.OPENAI_EMBEDDING_DIMENSIONS, 1536, { min: 256, max: 4096 });
  if (database && embeddingDimensions !== 1536) {
    throw new AppError('The current PostgreSQL schema requires OPENAI_EMBEDDING_DIMENSIONS=1536.', { code: 'CONFIG_INVALID' });
  }

  return Object.freeze({
    nodeEnv,
    authMode,
    oidc,
    host: env.HOST || '127.0.0.1',
    port: integer(env.PORT, 8787, { max: 65535 }),
    database,
    databaseUrl: database?.connectionString || '',
    databaseSsl: String(env.DATABASE_SSL ?? 'true').toLowerCase() === 'true',
    sqlitePath: path.resolve(env.SQLITE_PATH || './data/agent-memory.sqlite'),
    allowedOrigins,
    apiTokens,
    aiProvider,
    openAIKey: env.OPENAI_API_KEY || '',
    openAIModel: env.OPENAI_MODEL || 'gpt-5.6',
    embeddingModel: env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimensions,
    reasoningEffort,
    maxOutputTokens: integer(env.OPENAI_MAX_OUTPUT_TOKENS, 24_000, { min: 2_000, max: 64_000 }),
    openAITimeoutMs: integer(env.OPENAI_TIMEOUT_MS, 90_000, { min: 5_000, max: 300_000 }),
    codexCommand,
    codexModel,
    codexWorkdir,
    codexTimeoutMs: integer(env.CODEX_TIMEOUT_MS, 900_000, { min: 30_000, max: 1_800_000 }),
    browserExecutablePath,
    browserTimeoutMs: integer(env.BROWSER_TIMEOUT_MS, 30_000, { min: 5_000, max: 120_000 }),
    maxAuditPages: integer(env.MAX_AUDIT_PAGES, 4, { min: 1, max: 12 }),
    maxSkillPages: integer(env.MAX_SKILL_PAGES, 250, { min: 4, max: 250 }),
    maxNetworkHosts: integer(env.MAX_NETWORK_HOSTS, 40, { min: 1, max: 200 }),
    maxScreenshotBytes: integer(env.MAX_SCREENSHOT_BYTES, 3_500_000, { min: 100_000, max: 10_000_000 }),
    workerId: env.WORKER_ID || `worker-${process.pid}`,
    workerConcurrency: integer(env.WORKER_CONCURRENCY, 2, { min: 1, max: 12 }),
    workerHeartbeatMs: integer(env.WORKER_HEARTBEAT_MS, 30_000, { min: 5_000, max: 300_000 }),
    pollMs: integer(env.JOB_POLL_MS, 1_000, { min: 200, max: 30_000 }),
    leaseMs: integer(env.JOB_LEASE_MS, 120_000, { min: 30_000, max: 900_000 }),
    maxAttempts: integer(env.JOB_MAX_ATTEMPTS, 3, { min: 1, max: 10 })
  });
}
