import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresStore } from '../src/store/postgres-store.js';

test('Postgres completion serializes evidence arrays as JSON', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rowCount: sql.startsWith('UPDATE agent_jobs') ? 1 : 0, rows: [] };
    },
    release() {}
  };
  const store = new PostgresStore({ connect: async () => client });
  const job = {
    id: 'job-1', organizationId: 'org-1', requestId: 'request-1', storeId: 'store-1',
    leaseOwner: 'worker-1', payload: { website: 'https://example.com/', rubricHash: 'rubric-1' }
  };
  const result = {
    model: 'gpt-5.6-sol', overallScore: 98, summary: 'Healthy', startedAt: '2026-08-30T00:00:00.000Z',
    evidenceManifest: [{ type: 'screenshot', ref: 'homepage' }],
    results: [{
      ruleId: 'homepage', ruleText: 'Homepage loads', score: 98, explanation: 'Loaded.',
      recommendation: null, evidence: ['The main heading is visible.']
    }]
  };

  await store.completeJob(job, result);

  const runInsert = calls.find(call => call.sql.includes('INSERT INTO agent_runs'));
  const ruleInsert = calls.find(call => call.sql.includes('INSERT INTO agent_rule_results'));
  assert.equal(runInsert.params[9], JSON.stringify(result.evidenceManifest));
  assert.equal(ruleInsert.params[9], JSON.stringify(result.results[0].evidence));
});
