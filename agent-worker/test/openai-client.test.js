import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIClient } from '../src/ai/openai-client.js';

const config = { openAIKey: 'test-key', openAIModel: 'test-model', embeddingModel: 'test-embedding', openAITimeoutMs: 1_000 };

test('reads embeddings and strict audit JSON without leaking the key into the body', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/embeddings')) return new Response(JSON.stringify({ data: [{ embedding: [0.5, 0.25] }] }), { status: 200 });
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ summary: 'Good', results: [{ ruleId: 'r1', score: 99, explanation: 'Shown', recommendation: null, evidence: ['Screenshot'] }] }) }] }] }), { status: 200 });
  };
  const client = new OpenAIClient(config, { fetchImpl });
  assert.deepEqual(await client.embed('payment icon'), [0.5, 0.25]);
  assert.equal(JSON.parse(requests[0].options.body).dimensions, 1536);
  const result = await client.evaluate({
    payload: { storeId: 's1', storeName: 'Store', website: 'https://example.com', agentDescription: '', rules: [{ ruleId: 'r1', text: 'Visible' }] },
    inspection: { pages: [{ url: 'https://example.com', text: 'Page', screenshotDataUrl: null }] },
    memory: { lessons: [], history: [] }
  });
  assert.equal(result.results[0].score, 99);
  assert.equal(requests[1].options.body.includes('test-key'), false);
  const auditRequest = JSON.parse(requests[1].options.body);
  assert.equal(auditRequest.store, false);
  assert.deepEqual(auditRequest.reasoning, { effort: 'medium' });
  assert.equal(auditRequest.max_output_tokens, 24_000);
});
