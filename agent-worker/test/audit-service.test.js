import test from 'node:test';
import assert from 'node:assert/strict';
import { AuditService } from '../src/audit/audit-service.js';

test('audit service retrieves memory before evaluating current evidence', async () => {
  const order = [];
  const service = new AuditService({
    store: {
      findContext: async () => { order.push('memory'); return { lessons: [{ content: 'Approved' }], history: [] }; },
      listSkills: async () => [{ id: 'skill-1', ruleId: 'r1', scopeMode: 'all_product_pages', maximumPages: 100 }]
    },
    inspector: { inspect: async ({ skills }) => { order.push('inspect'); assert.equal(skills[0].scopeMode, 'all_product_pages'); return { pages: [], manifest: [{ url: 'https://example.com' }] }; } },
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

test('discussion service explains a completed finding and proposes an unsaved rule skill', async () => {
  let inspected = false;
  const service = new AuditService({
    store: {
      findContext: async () => ({ lessons: [], history: [] }),
      listSkills: async () => [{ id: 'old', ruleId: 'r1', instructions: 'Use a sample.', scopeMode: 'sample', maximumPages: 4 }]
    },
    inspector: { inspect: async () => { inspected = true; } },
    ai: {
      model: 'test-model', embed: async () => null,
      discuss: async ({ payload, memory }) => {
        assert.equal(payload.finding.score, 35);
        assert.equal(memory.skills[0].id, 'old');
        return {
          reply: 'The run sampled three product pages.',
          proposedSkill: { name: 'All products', instructions: 'Inspect every discoverable product page.', scopeMode: 'all_product_pages', maximumPages: 100 }
        };
      }
    }
  });
  const result = await service.execute({
    organizationId: 'org', storeId: 'store', payload: {
      kind: 'discussion', storeId: 'store', storeName: 'Store', website: 'https://example.com/', rubricHash: 'hash',
      ruleId: 'r1', ruleText: 'Check product descriptions', finding: { score: 35 }, message: 'Check all products', history: []
    }
  });
  assert.equal(inspected, false);
  assert.equal(result.kind, 'discussion');
  assert.equal(result.proposedSkill.scopeMode, 'all_product_pages');
});
