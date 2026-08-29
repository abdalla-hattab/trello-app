import { nowIso } from '../lib/time.js';
import { validateAuditResults } from '../domain/validation.js';

export class AuditService {
  constructor({ store, inspector, ai }) {
    this.store = store;
    this.inspector = inspector;
    this.ai = ai;
  }

  async execute(job) {
    const startedAt = nowIso();
    const query = [job.payload.storeName, job.payload.agentDescription, ...job.payload.agentRules].join('\n');
    const embedding = await this.ai.embed(query);
    const memory = await this.store.findContext({
      organizationId: job.organizationId,
      storeId: job.storeId,
      query,
      embedding,
      rubricHash: job.payload.rubricHash
    });
    const inspection = await this.inspector.inspect({ website: job.payload.website, rules: job.payload.agentRules });
    const raw = await this.ai.evaluate({ payload: job.payload, inspection, memory });
    const validated = validateAuditResults(raw, job.payload.rules);
    return {
      ...validated,
      model: this.ai.model,
      startedAt,
      evidenceManifest: inspection.manifest
    };
  }
}
