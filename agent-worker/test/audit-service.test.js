import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from '../src/audit/audit-service.js';

test('audit service retrieves memory before evaluating current evidence', async () => {
  const order = [];
  const service = new AuditService({
    store: { findContext: async () => { order.push('memory'); return { lessons: [{ content: 'Approved' }], history: [] }; } },
    inspector: { inspect: async () => { order.push('inspect'); return { pages: [], manifest: [{ url: 'https://example.com' }] }; } },
    ai: {
      model: 'test-model',
      embed: async () => [1, 0],
      evaluate: async ({ memory }) => {
        order.push('evaluate');
        assert.equal(memory.lessons[0].content, 'Approved');
        return { summary: 'Ready', results: [{ ruleId: 'r1', score: 98, explanation: 'Evidence', recommendation: null, evidence: ['page'] }] };
      }
    }
  });
  const result = await service.execute({
    organizationId: 'org', storeId: 'store',
    payload: { storeId: 'store', storeName: 'Store', agentDescription: '', agentRules: ['Rule'], rules: [{ ruleId: 'r1', text: 'Rule' }] }
  });
  assert.deepEqual(order, ['memory', 'inspect', 'evaluate']);
  assert.equal(result.overallScore, 98);
  assert.equal(result.evidenceManifest.length, 1);
});
