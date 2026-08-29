import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isBlockedAddress } from '../src/security/url-policy.js';

test('blocks private and reserved IPv4 targets', () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.20.0.1', '192.168.1.1', '169.254.1.2']) assert.equal(isBlockedAddress(address), true);
  assert.equal(isBlockedAddress('8.8.8.8'), false);
});

test('rejects a hostname when any resolved address is private', async () => {
  await assert.rejects(() => assertPublicUrl('https://safe-looking.example', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }), /private|reserved|unsafe/i);
});

test('accepts a hostname only when every resolved address is public', async () => {
  const value = await assertPublicUrl('https://example.com/path', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.equal(value.hostname, 'example.com');
});
