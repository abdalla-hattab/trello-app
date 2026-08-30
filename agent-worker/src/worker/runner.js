import { AppError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { backoffMs, sleep } from '../lib/time.js';

export class WorkerRunner {
  constructor({ config, store, auditService }) {
    this.config = config;
    this.store = store;
    this.auditService = auditService;
    this.stopping = false;
    this.tasks = new Set();
  }

  async process(job) {
    const heartbeat = setInterval(async () => {
      try {
        const held = await this.store.heartbeat(job.id, this.config.workerId, this.config.leaseMs);
        if (!held) log('warn', 'worker.lease_lost', { jobId: job.id });
      } catch (error) { log('error', 'worker.heartbeat_failed', { jobId: job.id, error }); }
    }, Math.max(10_000, Math.floor(this.config.leaseMs / 3)));
    heartbeat.unref();
    try {
      log('info', 'worker.job_started', { jobId: job.id, attempt: job.attempts, storeId: job.storeId });
      const result = await this.auditService.execute(job);
      await this.store.completeJob(job, result);
      log('info', 'worker.job_completed', { jobId: job.id, kind: result.kind || 'audit', overallScore: result.overallScore });
    } catch (raw) {
      const error = raw instanceof AppError ? raw : new AppError(raw.message || 'Check failed.', { code: 'CHECK_FAILED', retryable: true });
      const retryAt = new Date(Date.now() + backoffMs(job.attempts)).toISOString();
      const status = await this.store.failJob(job, error, { retryAt });
      log(status === 'failed' ? 'error' : 'warn', 'worker.job_failed', { jobId: job.id, status, error });
    } finally { clearInterval(heartbeat); }
  }

  async start() {
    await this.store.workerStarted?.({
      workerId: this.config.workerId,
      provider: this.config.aiProvider,
      model: this.auditService.ai.model
    });
    const presence = setInterval(async () => {
      try { await this.store.workerHeartbeat?.(this.config.workerId); }
      catch (error) { log('error', 'worker.presence_heartbeat_failed', { workerId: this.config.workerId, error }); }
    }, this.config.workerHeartbeatMs);
    presence.unref();
    log('info', 'worker.started', {
      workerId: this.config.workerId,
      concurrency: this.config.workerConcurrency,
      provider: this.config.aiProvider,
      model: this.auditService.ai.model
    });
    try {
      while (!this.stopping) {
        while (!this.stopping && this.tasks.size < this.config.workerConcurrency) {
          const job = await this.store.claimJob({ workerId: this.config.workerId, leaseMs: this.config.leaseMs });
          if (!job) break;
          const task = this.process(job).finally(() => this.tasks.delete(task));
          this.tasks.add(task);
        }
        if (!this.stopping) await sleep(this.config.pollMs);
      }
      await Promise.allSettled([...this.tasks]);
    } finally {
      clearInterval(presence);
      await this.store.workerStopped?.(this.config.workerId).catch(error => {
        log('error', 'worker.presence_stop_failed', { workerId: this.config.workerId, error });
      });
    }
    log('info', 'worker.stopped', { workerId: this.config.workerId });
  }

  stop() { this.stopping = true; }
}
