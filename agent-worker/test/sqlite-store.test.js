import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { parseCheckRequest } from '../src/domain/validation.js';

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-store-'));
  const store = new SqliteStore(path.join(directory, 'memory.sqlite'));
  await store.init();
  t.after(async () => { await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  return store;
}

const payload = () => parseCheckRequest({ requestId: 'request-1', storeId: 'store-1', storeName: 'Store', website: 'https://example.com', agentRules: ['Payment icons appear'], ruleIds: ['payment'] });

test('jobs are idempotent, leased, completed, and retained as history', async t => {
  const store = await setup(t);
  const first = await store.createJob({ organizationId: 'org', payload: payload(), idempotencyKey: 'idem-1', maxAttempts: 3 });
  const duplicate = await store.createJob({ organizationId: 'org', payload: payload(), idempotencyKey: 'idem-1', maxAttempts: 3 });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(first.job.id, duplicate.job.id);
  const job = await store.claimJob({ workerId: 'worker', leaseMs: 60_000 });
  assert.equal(job.attempts, 1);
  await store.completeJob(job, {
    model: 'test', startedAt: new Date().toISOString(), overallScore: 99, summary: 'Good', evidenceManifest: [],
    results: [{ ruleId: 'payment', ruleText: 'Payment icons appear', score: 99, explanation: 'Visible', recommendation: null, evidence: ['home'] }]
  });
  const completed = await store.getJob('org', job.id);
  assert.equal(completed.response.overallScore, 99);
  const context = await store.findContext({ organizationId: 'org', storeId: 'store-1', query: 'payment', embedding: null });
  assert.equal(context.history[0].ruleId, 'payment');
});

test('human correction becomes verified memory and remains organization scoped', async t => {
  const store = await setup(t);
  const queued = await store.createJob({ organizationId: 'org', payload: payload(), idempotencyKey: 'idem-2', maxAttempts: 3 });
  const job = await store.claimJob({ workerId: 'worker', leaseMs: 60_000 });
  await store.completeJob(job, {
    model: 'test', startedAt: new Date().toISOString(), overallScore: 40, summary: 'Issue', evidenceManifest: [],
    results: [{ ruleId: 'payment', ruleText: 'Payment icons appear', score: 40, explanation: 'Missing', recommendation: 'Add icons', evidence: [] }]
  });
  const feedback = await store.applyFeedback({
    organizationId: 'org', jobId: queued.job.id, actorId: 'owner', embedding: [1, 0],
    feedback: { ruleId: 'payment', action: 'correct', correctedScore: 100, lesson: 'Payment icons in the footer are accepted.', note: '' }
  });
  assert.equal(feedback.verificationStatus, 'corrected');
  const context = await store.findContext({ organizationId: 'org', storeId: 'store-1', query: 'payment icons footer', embedding: [1, 0] });
  assert.equal(context.lessons[0].content, 'Payment icons in the footer are accepted.');
  const other = await store.findContext({ organizationId: 'another-org', storeId: 'store-1', query: 'payment', embedding: [1, 0] });
  assert.equal(other.lessons.length, 0);
});

test('lessons can be reviewed and revoked without deleting their audit record', async t => {
  const store = await setup(t);
  const lesson = await store.addLesson({
    organizationId: 'org', storeId: 'store-1', ruleId: null,
    content: 'Use the approved Arabic brand spelling.', actorId: 'owner', embedding: null
  });
  const listed = await store.listLessons({ organizationId: 'org', storeId: 'store-1' });
  assert.equal(listed[0].id, lesson.id);
  assert.equal(listed[0].status, 'verified');
  await store.revokeLesson({ organizationId: 'org', lessonId: lesson.id, actorId: 'owner' });
  const after = await store.listLessons({ organizationId: 'org', storeId: 'store-1' });
  assert.equal(after[0].status, 'revoked');
  const context = await store.findContext({ organizationId: 'org', storeId: 'store-1', query: 'Arabic spelling', embedding: null });
  assert.equal(context.lessons.length, 0);
});

test('discussion jobs complete without creating audit runs and rule skills can be replaced', async t => {
  const store = await setup(t);
  const queued = await store.createJob({
    organizationId: 'org', idempotencyKey: 'discussion-1', maxAttempts: 3,
    payload: { kind: 'discussion', requestId: 'discussion-1', storeId: 'store-1', ruleId: 'products' }
  });
  const job = await store.claimJob({ workerId: 'worker', leaseMs: 60_000 });
  await store.completeJob(job, {
    kind: 'discussion', reply: 'The earlier run sampled three product pages.',
    proposedSkill: { name: 'All products', instructions: 'Inspect every product page.', scopeMode: 'all_product_pages', maximumPages: 100 }
  });
  const completed = await store.getJob('org', queued.job.id);
  assert.equal(completed.response.kind, 'discussion');
  assert.equal(completed.response.proposedSkill.scopeMode, 'all_product_pages');
  const history = await store.findContext({ organizationId: 'org', storeId: 'store-1', query: 'products', embedding: null });
  assert.equal(history.history.length, 0);

  const { encodeRuleSkill } = await import('../src/domain/rule-skills.js');
  const first = await store.addLesson({
    organizationId: 'org', storeId: 'store-1', ruleId: 'products', actorId: 'owner', source: 'rule_skill', embedding: null,
    content: encodeRuleSkill({ name: 'All products', instructions: 'Inspect every product page.', scopeMode: 'all_product_pages', maximumPages: 100 })
  });
  await store.addLesson({
    organizationId: 'org', storeId: 'store-1', ruleId: 'products', actorId: 'owner', source: 'rule_skill', embedding: null, supersedesId: first.id,
    content: encodeRuleSkill({ name: 'All products', instructions: 'Inspect every discovered product.', scopeMode: 'all_product_pages', maximumPages: 80 })
  });
  const skills = await store.listSkills({ organizationId: 'org', storeId: 'store-1', ruleId: 'products' });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].maximumPages, 80);
});
