import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { createApiServer } from '../src/api/server.js';

test('authenticated API queues, returns, and learns from a completed check', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-api-'));
  const store = new SqliteStore(path.join(directory, 'memory.sqlite'));
  await store.init();
  const token = 'test-token-that-is-longer-than-thirty-two-characters';
  const config = {
    allowedOrigins: new Set(['https://app.example']), apiTokens: new Map([[token, 'org']]),
    maxAttempts: 3
  };
  const server = createApiServer({ config, store, embeddings: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    server.close();
    await once(server, 'close');
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const headers = { Authorization: `Bearer ${token}`, Origin: 'https://app.example', 'Content-Type': 'application/json', 'Idempotency-Key': 'api-e2e-1' };
  const queuedResponse = await fetch(`${base}/v1/checks`, {
    method: 'POST', headers,
    body: JSON.stringify({ requestId: 'request-e2e', storeId: 'store', storeName: 'Store', website: 'https://93.184.216.34/', agentRules: ['Payment icons are visible'], ruleIds: ['payment'] })
  });
  assert.equal(queuedResponse.status, 202);
  assert.equal(queuedResponse.headers.get('access-control-allow-origin'), 'https://app.example');
  const queued = await queuedResponse.json();
  const job = await store.claimJob({ workerId: 'worker', leaseMs: 60_000 });
  await store.completeJob(job, {
    model: 'test', startedAt: new Date().toISOString(), overallScore: 99, summary: 'Good', evidenceManifest: [],
    results: [{ ruleId: 'payment', ruleText: 'Payment icons are visible', score: 99, explanation: 'Visible', recommendation: null, evidence: ['home'] }]
  });
  const statusResponse = await fetch(`${base}${queued.statusUrl}`, { headers });
  const completed = await statusResponse.json();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.overallScore, 99);
  const feedbackResponse = await fetch(`${base}/v1/checks/${queued.jobId}/feedback`, {
    method: 'POST', headers,
    body: JSON.stringify({ ruleId: 'payment', action: 'correct', correctedScore: 100, lesson: 'Footer icons are approved.' })
  });
  assert.equal(feedbackResponse.status, 200);
  const feedback = await feedbackResponse.json();
  assert.equal(feedback.verificationStatus, 'corrected');

  const discussionResponse = await fetch(`${base}/v1/checks/${queued.jobId}/discussions`, {
    method: 'POST', headers: { ...headers, 'Idempotency-Key': 'discussion-e2e-1' },
    body: JSON.stringify({ requestId: 'discussion-e2e-1', ruleId: 'payment', message: 'Why did you inspect only a sample?', history: [] })
  });
  assert.equal(discussionResponse.status, 202);
  const discussionQueued = await discussionResponse.json();
  const discussionJob = await store.claimJob({ workerId: 'worker', leaseMs: 60_000 });
  assert.equal(discussionJob.payload.kind, 'discussion');
  assert.equal(discussionJob.payload.finding.score, 100);
  await store.completeJob(discussionJob, {
    kind: 'discussion', reply: 'The normal run uses a representative sample.',
    proposedSkill: { name: 'All products', instructions: 'Inspect every discoverable product page.', scopeMode: 'all_product_pages', maximumPages: 100 }
  });
  const discussionStatus = await fetch(`${base}${discussionQueued.statusUrl}`, { headers });
  assert.equal((await discussionStatus.json()).proposedSkill.scopeMode, 'all_product_pages');

  const skillResponse = await fetch(`${base}/v1/skills`, {
    method: 'POST', headers,
    body: JSON.stringify({
      storeId: 'store', ruleId: 'payment', name: 'All products',
      instructions: 'Inspect every discoverable product page.', scopeMode: 'all_product_pages', maximumPages: 100
    })
  });
  assert.equal(skillResponse.status, 201);
  const skillsResponse = await fetch(`${base}/v1/skills?storeId=store&ruleId=payment`, { headers });
  const skills = await skillsResponse.json();
  assert.equal(skills.skills[0].maximumPages, 100);

  const lessonsResponse = await fetch(`${base}/v1/lessons?storeId=store`, { headers });
  assert.equal(lessonsResponse.status, 200);
  const lessons = await lessonsResponse.json();
  assert.equal(lessons.lessons.some(item => item.content === 'Footer icons are approved.'), true);
  const revokeResponse = await fetch(`${base}/v1/lessons/${feedback.lesson.id}`, { method: 'DELETE', headers });
  assert.equal(revokeResponse.status, 200);
  assert.equal((await revokeResponse.json()).status, 'revoked');
});
