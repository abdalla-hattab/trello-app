import { nowIso } from '../lib/time.js';
import { validateAuditResults, validateDiscussionResult } from '../domain/validation.js';

export class AuditService {
  constructor({ store, inspector, ai }) {
    this.store = store;
    this.inspector = inspector;
    this.ai = ai;
  }

  async execute(job) {
    if (job.payload.kind === 'discussion') return this.executeDiscussion(job);
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
    const skills = this.store.listSkills
      ? await this.store.listSkills({ organizationId: job.organizationId, storeId: job.storeId })
      : [];
    const inspection = await this.inspector.inspect({ website: job.payload.website, rules: job.payload.agentRules, skills });
    const raw = await this.ai.evaluate({ payload: job.payload, inspection, memory: { ...memory, skills } });
    const validated = validateAuditResults(raw, job.payload.rules);
    return {
      ...validated,
      model: this.ai.model,
      startedAt,
      evidenceManifest: inspection.manifest
    };
  }

  async executeDiscussion(job) {
    const startedAt = nowIso();
    const query = [job.payload.ruleText, job.payload.message, ...(job.payload.history || []).map(item => item.text)].join('\n');
    const embedding = await this.ai.embed(query);
    const [memory, skills] = await Promise.all([
      this.store.findContext({
        organizationId: job.organizationId, storeId: job.storeId, query, embedding,
        rubricHash: job.payload.rubricHash
      }),
      this.store.listSkills
        ? this.store.listSkills({ organizationId: job.organizationId, storeId: job.storeId, ruleId: job.payload.ruleId })
        : []
    ]);
    const raw = await this.ai.discuss({ payload: job.payload, memory: { ...memory, skills } });
    return {
      kind: 'discussion', ...validateDiscussionResult(raw),
      model: this.ai.model, startedAt
    };
  }
}
