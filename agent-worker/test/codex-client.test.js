import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { CodexClient } from '../src/ai/codex-client.js';

const config = {
  codexCommand: '/Applications/ChatGPT.app/Contents/Resources/codex',
  codexModel: 'gpt-5.6-sol',
  codexTimeoutMs: 60_000,
  codexWorkdir: process.cwd()
};

test('uses signed-in Codex with strict output and attached screenshot evidence', async () => {
  let invocation;
  const runImpl = async details => {
    invocation = details;
    const outputIndex = details.args.indexOf('--output-last-message');
    await writeFile(details.args[outputIndex + 1], JSON.stringify({
      summary: 'Checked',
      results: [{ ruleId: 'r1', score: 91, explanation: 'Visible', recommendation: null, evidence: ['Screenshot'] }]
    }));
  };
  const client = new CodexClient(config, { runImpl });
  const result = await client.evaluate({
    payload: {
      storeId: 's1', storeName: 'Store', website: 'https://example.com',
      agentDescription: '', rubricHash: 'hash', rules: [{ ruleId: 'r1', text: 'Visible' }]
    },
    inspection: {
      pages: [{
        url: 'https://example.com', text: 'Page',
        screenshotDataUrl: 'data:image/png;base64,iVBORw0KGgo='
      }]
    },
    memory: { lessons: [], history: [] }
  });
  assert.equal(result.results[0].score, 91);
  assert.equal(invocation.command, config.codexCommand);
  assert.equal(invocation.args.includes('--ephemeral'), true);
  assert.equal(invocation.args.includes('--ignore-user-config'), true);
  assert.equal(invocation.args.includes('--ignore-rules'), true);
  assert.equal(invocation.args[invocation.args.indexOf('--model') + 1], 'gpt-5.6-sol');
  assert.equal(invocation.args.filter(value => value === '--image').length, 1);
  assert.match(invocation.input, /untrusted data/);
  assert.match(invocation.input, /https:\/\/example\.com/);
});

test('disables paid embeddings while preserving lexical and recent memory retrieval', async () => {
  const client = new CodexClient(config);
  assert.equal(await client.embed('remember this rule'), null);
});
