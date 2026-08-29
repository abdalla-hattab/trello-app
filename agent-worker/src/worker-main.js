import { loadConfig } from './config.js';
import { createStore } from './store/index.js';
import { OpenAIClient } from './ai/openai-client.js';
import { CodexClient } from './ai/codex-client.js';
import { SiteInspector } from './audit/site-inspector.js';
import { AuditService } from './audit/audit-service.js';
import { WorkerRunner } from './worker/runner.js';
import { log } from './lib/logger.js';

const config = loadConfig(process.env, { requireAI: true, requireAuth: false });
const store = await createStore(config);
const ai = config.aiProvider === 'codex' ? new CodexClient(config) : new OpenAIClient(config);
const inspector = new SiteInspector(config);
const auditService = new AuditService({ store, inspector, ai });
const runner = new WorkerRunner({ config, store, auditService });

const shutdown = signal => {
  log('info', 'worker.stopping', { signal });
  runner.stop();
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
try { await runner.start(); }
finally { await store.close(); }
