import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerRunner } from '../src/worker/runner.js';
import { AppError } from '../src/lib/errors.js';

const config = { workerId: 'w1', leaseMs: 60_000, workerConcurrency: 1, pollMs: 10 };

test('worker completes a leased job', async () => {
  const calls = [];
  const store = {
    heartbeat: async () => true,
    completeJob: async (job, result) => calls.push(['complete', job.id, result.overallScore]),
    failJob: async () => calls.push(['fail'])
  };
  const runner = new WorkerRunner({ config, store, auditService: { execute: async () => ({ overallScore: 98 }) } });
  await runner.process({ id: 'job-1', attempts: 1, maxAttempts: 3, leaseOwner: 'w1', storeId: 's1' });
  assert.deepEqual(calls, [['complete', 'job-1', 98]]);
});

test('retryable errors are returned to the durable queue', async () => {
  let failure;
  const store = {
    heartbeat: async () => true,
    completeJob: async () => assert.fail('must not complete'),
    failJob: async (job, error, details) => { failure = { job, error, details }; return 'retry'; }
  };
  const runner = new WorkerRunner({ config, store, auditService: { execute: async () => { throw new AppError('temporary', { code: 'TEMP', retryable: true }); } } });
  await runner.process({ id: 'job-2', attempts: 1, maxAttempts: 3, leaseOwner: 'w1', storeId: 's1' });
  assert.equal(failure.error.code, 'TEMP');
  assert.match(failure.details.retryAt, /^\d{4}-/);
});
