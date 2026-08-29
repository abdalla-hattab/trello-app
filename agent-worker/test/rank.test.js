import test from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, rankLessons } from '../src/memory/rank.js';

test('cosine similarity and store scope influence retrieval', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  const ranked = rankLessons([
    { id: 'company', storeId: null, content: 'payment footer icons', embedding: [1, 0], updatedAt: '2026-01-01' },
    { id: 'store', storeId: 's1', content: 'unrelated rule', embedding: [0, 1], updatedAt: '2026-01-01' }
  ], { query: 'payment icons', embedding: [1, 0], storeId: 's1' });
  assert.equal(ranked[0].id, 'company');
});
