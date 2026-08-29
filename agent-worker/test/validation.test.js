import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheckRequest, parseFeedbackRequest, validateAuditResults } from '../src/domain/validation.js';

test('normalizes a complete check and versions its rubric', () => {
  const value = parseCheckRequest({
    requestId: 'req-1', storeId: 'store-1', storeName: 'Store', website: 'https://example.com#top',
    agentDescription: 'Audit carefully', agentRules: ['Payment icons are visible', 'Images link correctly'],
    ruleIds: ['payment', 'images']
  });
  assert.equal(value.website, 'https://example.com/');
  assert.equal(value.rules.length, 2);
  assert.match(value.rubricHash, /^[a-f0-9]{64}$/);
});

test('generated rule IDs stay attached to rule text when rules are reordered', () => {
  const common = { requestId: 'r', storeId: 's', storeName: 'Store', website: 'https://example.com' };
  const first = parseCheckRequest({ ...common, agentRules: ['Payment icons', 'Collection links'] });
  const reordered = parseCheckRequest({ ...common, agentRules: ['Collection links', 'Payment icons'] });
  assert.equal(first.ruleIds[0], reordered.ruleIds[1]);
  assert.equal(first.ruleIds[1], reordered.ruleIds[0]);
});

test('rejects duplicate rule IDs', () => {
  assert.throws(() => parseCheckRequest({ requestId: 'r', website: 'https://example.com', agentRules: ['one', 'two'], ruleIds: ['same', 'same'] }), /unique/);
});

test('rejects non-array rule IDs as a client validation error', () => {
  assert.throws(() => parseCheckRequest({
    requestId: 'r1', storeId: 's1', storeName: 'Store', website: 'https://example.com',
    agentRules: ['Rule'], ruleIds: 'rule-1'
  }), error => error.code === 'VALIDATION_ERROR' && error.status === 400);
});

test('does not invent an overall score when one rule is unscored', () => {
  const result = validateAuditResults({ summary: 'Partial', results: [
    { ruleId: 'one', score: 98, explanation: 'Visible', recommendation: null, evidence: ['Homepage'] },
    { ruleId: 'two', score: null, explanation: 'Could not reach this flow', recommendation: 'Check manually', evidence: [] }
  ] }, [{ ruleId: 'one', text: 'One' }, { ruleId: 'two', text: 'Two' }]);
  assert.equal(result.overallScore, null);
});

test('a correction requires a lesson', () => {
  assert.throws(() => parseFeedbackRequest({ ruleId: 'one', action: 'correct', correctedScore: 90 }), /lesson/);
});
