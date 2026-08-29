import http from 'node:http';
import { createAuthenticator } from '../security/auth.js';
import { assertPublicUrl } from '../security/url-policy.js';
import { parseCheckRequest, parseFeedbackRequest, parseLessonRequest } from '../domain/validation.js';
import { AppError, publicError } from '../lib/errors.js';
import { log } from '../lib/logger.js';

const MAX_BODY_BYTES = 1_000_000;

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new AppError('The request body is too large.', { code: 'PAYLOAD_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('The request body must be valid JSON.', { code: 'INVALID_JSON', status: 400 }); }
}

function send(response, status, body, origin, allowedOrigins) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

export function createApiServer({ config, store, embeddings }) {
  const authenticate = createAuthenticator(config);
  return http.createServer(async (request, response) => {
    const started = Date.now();
    const origin = request.headers.origin || '';
    const requestUrl = new URL(request.url || '/', 'http://agent.local');
    try {
      if (origin && !config.allowedOrigins.has(origin)) throw new AppError('This browser origin is not allowed.', { code: 'ORIGIN_DENIED', status: 403 });
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
          'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type,Idempotency-Key',
          'Access-Control-Max-Age': '600'
        });
        response.end();
        return;
      }
      if (request.method === 'GET' && requestUrl.pathname === '/health/live') return send(response, 200, { status: 'ok' }, origin, config.allowedOrigins);
      if (request.method === 'GET' && requestUrl.pathname === '/health/ready') {
        const ready = await store.health();
        return send(response, ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' }, origin, config.allowedOrigins);
      }
      const identity = await authenticate(request);

      if (request.method === 'POST' && requestUrl.pathname === '/v1/checks') {
        const payload = parseCheckRequest(await readJson(request));
        await assertPublicUrl(payload.website);
        const idempotencyKey = String(request.headers['idempotency-key'] || payload.requestId).trim();
        if (!idempotencyKey || idempotencyKey.length > 256) throw new AppError('Idempotency-Key is invalid.', { code: 'VALIDATION_ERROR', status: 400 });
        const queued = await store.createJob({ organizationId: identity.organizationId, payload, idempotencyKey, maxAttempts: config.maxAttempts });
        const status = queued.job.status === 'completed' ? 200 : queued.created ? 202 : 200;
        return send(response, status, {
          requestId: queued.job.requestId,
          jobId: queued.job.id,
          status: queued.job.status,
          statusUrl: `/v1/checks/${queued.job.id}`,
          ...(queued.job.response || {})
        }, origin, config.allowedOrigins);
      }

      const jobMatch = /^\/v1\/checks\/([a-f0-9-]+)$/.exec(requestUrl.pathname);
      if (request.method === 'GET' && jobMatch) {
        const job = await store.getJob(identity.organizationId, jobMatch[1]);
        if (!job) throw new AppError('Check job not found.', { code: 'JOB_NOT_FOUND', status: 404 });
        return send(response, 200, job.response || {
          requestId: job.requestId, jobId: job.id, status: job.status,
          attempts: job.attempts,
          ...(job.error ? { error: job.error } : {})
        }, origin, config.allowedOrigins);
      }

      const feedbackMatch = /^\/v1\/checks\/([a-f0-9-]+)\/feedback$/.exec(requestUrl.pathname);
      if (request.method === 'POST' && feedbackMatch) {
        const feedback = parseFeedbackRequest(await readJson(request));
        const text = feedback.action === 'correct' ? feedback.lesson : feedback.note || '';
        const embedding = text && embeddings ? await embeddings.embed(text) : null;
        const result = await store.applyFeedback({ organizationId: identity.organizationId, jobId: feedbackMatch[1], feedback, actorId: identity.actorId, embedding });
        return send(response, 200, result, origin, config.allowedOrigins);
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/lessons') {
        const lesson = parseLessonRequest(await readJson(request));
        const embedding = embeddings ? await embeddings.embed(lesson.content) : null;
        const result = await store.addLesson({ organizationId: identity.organizationId, ...lesson, embedding, actorId: identity.actorId });
        return send(response, 201, result, origin, config.allowedOrigins);
      }

      if (request.method === 'GET' && requestUrl.pathname === '/v1/lessons') {
        const rawStoreId = requestUrl.searchParams.get('storeId');
        const storeId = rawStoreId === null ? null : rawStoreId.trim();
        if (storeId !== null && (!storeId || storeId.length > 256)) throw new AppError('storeId is invalid.', { code: 'VALIDATION_ERROR', status: 400 });
        const rawLimit = requestUrl.searchParams.get('limit');
        const limit = rawLimit === null ? 100 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new AppError('limit must be between 1 and 250.', { code: 'VALIDATION_ERROR', status: 400 });
        const lessons = await store.listLessons({ organizationId: identity.organizationId, storeId, limit });
        return send(response, 200, { lessons }, origin, config.allowedOrigins);
      }

      const lessonMatch = /^\/v1\/lessons\/([a-f0-9-]+)$/.exec(requestUrl.pathname);
      if (request.method === 'DELETE' && lessonMatch) {
        const result = await store.revokeLesson({ organizationId: identity.organizationId, lessonId: lessonMatch[1], actorId: identity.actorId });
        return send(response, 200, result, origin, config.allowedOrigins);
      }

      throw new AppError('Route not found.', { code: 'NOT_FOUND', status: 404 });
    } catch (error) {
      const output = publicError(error);
      log(output.status >= 500 ? 'error' : 'warn', 'api.request_failed', { method: request.method, path: requestUrl.pathname, status: output.status, error });
      send(response, output.status, output.body, origin, config.allowedOrigins);
    } finally {
      log('info', 'api.request', { method: request.method, path: requestUrl.pathname, durationMs: Date.now() - started });
    }
  });
}
