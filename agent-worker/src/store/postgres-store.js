import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { rankLessons } from '../memory/rank.js';

const vector = value => Array.isArray(value) ? `[${value.join(',')}]` : null;
const parseVector = value => typeof value === 'string' && value.startsWith('[')
  ? value.slice(1, -1).split(',').map(Number)
  : null;

export class PostgresStore {
  constructor(pool) { this.pool = pool; }

  static async connect({ connection, ssl }) {
    const { Pool } = await import('pg');
    const pool = new Pool({ ...connection, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000, ssl: ssl ? { rejectUnauthorized: true } : false });
    const store = new PostgresStore(pool);
    await store.health();
    return store;
  }

  async init() {}

  async health() {
    const result = await this.pool.query('SELECT 1 AS ok');
    return result.rows[0].ok === 1;
  }

  async workerStarted({ workerId, provider, model }) {
    await this.pool.query(`INSERT INTO agent_workers(worker_id,provider,model,status,started_at,last_seen_at)
      VALUES($1,$2,$3,'online',now(),now())
      ON CONFLICT(worker_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,status='online',
        started_at=now(),last_seen_at=now(),updated_at=now()`, [workerId, provider, model]);
  }

  async workerHeartbeat(workerId) {
    await this.pool.query("UPDATE agent_workers SET status='online',last_seen_at=now(),updated_at=now() WHERE worker_id=$1", [workerId]);
  }

  async workerStopped(workerId) {
    await this.pool.query("UPDATE agent_workers SET status='offline',last_seen_at=now(),updated_at=now() WHERE worker_id=$1", [workerId]);
  }

  rowToJob(row) {
    if (!row) return null;
    return {
      id: row.id, organizationId: row.organization_id, requestId: row.request_id,
      storeId: row.store_id, status: row.status, payload: row.payload,
      response: row.response, attempts: row.attempts, maxAttempts: row.max_attempts,
      leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at,
      error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
      createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
    };
  }

  async event(client, organizationId, jobId, eventType, data = {}) {
    await client.query('INSERT INTO agent_events(organization_id,job_id,event_type,data) VALUES($1,$2,$3,$4)', [organizationId, jobId, eventType, data]);
  }

  async createJob({ organizationId, payload, idempotencyKey, maxAttempts }) {
    const id = newId();
    const inserted = await this.pool.query(`INSERT INTO agent_jobs(id,organization_id,request_id,idempotency_key,store_id,status,payload,max_attempts)
      VALUES($1,$2,$3,$4,$5,'queued',$6,$7)
      ON CONFLICT DO NOTHING RETURNING *`, [id, organizationId, payload.requestId, idempotencyKey, payload.storeId, payload, maxAttempts]);
    if (inserted.rowCount) {
      await this.event(this.pool, organizationId, id, 'job.queued', { requestId: payload.requestId });
      return { job: this.rowToJob(inserted.rows[0]), created: true };
    }
    const existing = await this.pool.query('SELECT * FROM agent_jobs WHERE organization_id=$1 AND (request_id=$2 OR idempotency_key=$3) LIMIT 1', [organizationId, payload.requestId, idempotencyKey]);
    return { job: this.rowToJob(existing.rows[0]), created: false };
  }

  async getJob(organizationId, id) {
    const result = await this.pool.query('SELECT * FROM agent_jobs WHERE organization_id=$1 AND id=$2', [organizationId, id]);
    return this.rowToJob(result.rows[0]);
  }

  async claimJob({ workerId, leaseMs }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query(`SELECT * FROM agent_jobs
        WHERE ((status IN ('queued','retry') AND next_attempt_at<=now()) OR (status='running' AND lease_expires_at<now()))
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!selected.rowCount) { await client.query('COMMIT'); return null; }
      const row = selected.rows[0];
      const updated = await client.query(`UPDATE agent_jobs SET status='running',attempts=attempts+1,lease_owner=$1,
        lease_expires_at=now()+($2::text || ' milliseconds')::interval,updated_at=now() WHERE id=$3 RETURNING *`, [workerId, leaseMs, row.id]);
      await this.event(client, row.organization_id, row.id, row.status === 'running' ? 'job.reclaimed' : 'job.started', { workerId });
      await client.query('COMMIT');
      return this.rowToJob(updated.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async heartbeat(jobId, workerId, leaseMs) {
    const result = await this.pool.query(`UPDATE agent_jobs SET lease_expires_at=now()+($1::text || ' milliseconds')::interval,updated_at=now()
      WHERE id=$2 AND status='running' AND lease_owner=$3`, [leaseMs, jobId, workerId]);
    return result.rowCount === 1;
  }

  async completeJob(job, result) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const runId = newId();
      const response = { requestId: job.requestId, jobId: job.id, runId, status: 'completed', overallScore: result.overallScore, summary: result.summary, results: result.results };
      const updated = await client.query(`UPDATE agent_jobs SET status='completed',response=$1,lease_owner=NULL,lease_expires_at=NULL,updated_at=now(),completed_at=now()
        WHERE id=$2 AND status='running' AND lease_owner=$3`, [response, job.id, job.leaseOwner]);
      if (!updated.rowCount) throw new AppError('The job lease was lost before completion.', { code: 'JOB_LEASE_LOST', retryable: true });
      await client.query(`INSERT INTO agent_runs(id,job_id,organization_id,store_id,website,rubric_hash,model,overall_score,started_at,completed_at,evidence_manifest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)`, [runId, job.id, job.organizationId, job.storeId, job.payload.website, job.payload.rubricHash, result.model, result.overallScore, result.startedAt, JSON.stringify(result.evidenceManifest || [])]);
      for (const item of result.results) {
        await client.query(`INSERT INTO agent_rule_results(id,run_id,organization_id,store_id,rule_id,rule_text,score,explanation,recommendation,evidence)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [newId(), runId, job.organizationId, job.storeId, item.ruleId, item.ruleText, item.score, item.explanation, item.recommendation, JSON.stringify(item.evidence || [])]);
      }
      await this.event(client, job.organizationId, job.id, 'job.completed', { runId, overallScore: result.overallScore });
      await client.query('COMMIT');
      return response;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async failJob(job, error, { retryAt }) {
    const retry = Boolean(error.retryable) && job.attempts < job.maxAttempts;
    const status = retry ? 'retry' : 'failed';
    await this.pool.query(`UPDATE agent_jobs SET status=$1,next_attempt_at=$2,lease_owner=NULL,lease_expires_at=NULL,error_code=$3,error_message=$4,
      updated_at=now(),completed_at=CASE WHEN $1='failed' THEN now() ELSE NULL END WHERE id=$5 AND lease_owner=$6`,
      [status, retryAt, error.code || 'CHECK_FAILED', String(error.message || 'Check failed').slice(0, 2000), job.id, job.leaseOwner]);
    await this.event(this.pool, job.organizationId, job.id, retry ? 'job.retry_scheduled' : 'job.failed', { code: error.code || 'CHECK_FAILED', attempt: job.attempts });
    return status;
  }

  async findContext({ organizationId, storeId, query, embedding, lessonLimit = 12, historyLimit = 8 }) {
    const selectLessons = `SELECT id,store_id AS "storeId",rule_id AS "ruleId",content,source,
      embedding::text AS embedding,updated_at AS "updatedAt"
      FROM agent_lessons WHERE organization_id=$1 AND status='verified' AND (store_id IS NULL OR store_id=$2)
      ORDER BY updated_at DESC LIMIT $3`;
    const recentPromise = this.pool.query(selectLessons, [organizationId, storeId, Math.max(100, lessonLimit * 8)]);
    const semanticPromise = embedding
      ? this.pool.query(`SELECT id,store_id AS "storeId",rule_id AS "ruleId",content,source,
          embedding::text AS embedding,updated_at AS "updatedAt"
          FROM agent_lessons WHERE organization_id=$1 AND status='verified' AND (store_id IS NULL OR store_id=$2) AND embedding IS NOT NULL
          ORDER BY embedding <=> $3::vector LIMIT $4`, [organizationId, storeId, vector(embedding), Math.max(48, lessonLimit * 4)])
      : Promise.resolve({ rows: [] });
    const historyPromise = this.pool.query(`SELECT rr.rule_id AS "ruleId",rr.rule_text AS "ruleText",rr.score,rr.explanation,
      rr.verification_status AS "verificationStatus",r.rubric_hash AS "rubricHash",r.completed_at AS "completedAt"
      FROM agent_rule_results rr JOIN agent_runs r ON r.id=rr.run_id
      WHERE rr.organization_id=$1 AND rr.store_id=$2 ORDER BY r.completed_at DESC LIMIT $3`, [organizationId, storeId, historyLimit]);
    const [recentResult, semanticResult, historyResult] = await Promise.all([recentPromise, semanticPromise, historyPromise]);
    const candidates = new Map();
    for (const row of [...semanticResult.rows, ...recentResult.rows]) candidates.set(row.id, { ...row, embedding: parseVector(row.embedding) });
    const lessons = rankLessons([...candidates.values()], {
      query, embedding, storeId, limit: lessonLimit
    });
    return { lessons, history: historyResult.rows, query };
  }

  async addLesson({ organizationId, storeId, ruleId, content, source = 'human', embedding, actorId, supersedesId = null }) {
    const client = await this.pool.connect();
    const id = newId();
    try {
      await client.query('BEGIN');
      if (supersedesId) await client.query("UPDATE agent_lessons SET status='superseded',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='verified'", [supersedesId, organizationId]);
      const result = await client.query(`INSERT INTO agent_lessons(id,organization_id,store_id,rule_id,content,source,status,supersedes_id,embedding,created_by)
        VALUES($1,$2,$3,$4,$5,$6,'verified',$7,$8::vector,$9) RETURNING id,organization_id AS "organizationId",store_id AS "storeId",rule_id AS "ruleId",content,source,status,created_at AS "createdAt"`,
        [id, organizationId, storeId, ruleId, content, source, supersedesId, vector(embedding), actorId]);
      await this.event(client, organizationId, null, 'lesson.created', { lessonId: id, storeId, ruleId, source });
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async listLessons({ organizationId, storeId = null, limit = 100 }) {
    const result = storeId
      ? await this.pool.query(`SELECT id,organization_id AS "organizationId",store_id AS "storeId",rule_id AS "ruleId",content,source,status,
          supersedes_id AS "supersedesId",created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt"
          FROM agent_lessons WHERE organization_id=$1 AND (store_id IS NULL OR store_id=$2) ORDER BY updated_at DESC LIMIT $3`, [organizationId, storeId, limit])
      : await this.pool.query(`SELECT id,organization_id AS "organizationId",store_id AS "storeId",rule_id AS "ruleId",content,source,status,
          supersedes_id AS "supersedesId",created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt"
          FROM agent_lessons WHERE organization_id=$1 AND store_id IS NULL ORDER BY updated_at DESC LIMIT $2`, [organizationId, limit]);
    return result.rows;
  }

  async revokeLesson({ organizationId, lessonId, actorId }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT id,status FROM agent_lessons WHERE id=$1 AND organization_id=$2 FOR UPDATE', [lessonId, organizationId]);
      if (!found.rowCount) throw new AppError('Lesson not found.', { code: 'LESSON_NOT_FOUND', status: 404 });
      if (found.rows[0].status !== 'revoked') {
        await client.query("UPDATE agent_lessons SET status='revoked',updated_at=now() WHERE id=$1", [lessonId]);
        await this.event(client, organizationId, null, 'lesson.revoked', { lessonId, actorId });
      }
      await client.query('COMMIT');
      return { id: lessonId, status: 'revoked' };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async applyFeedback({ organizationId, jobId, feedback, actorId, embedding }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT r.id AS run_id,r.store_id,rr.id AS result_id,rr.rule_text,rr.score,rr.explanation
        FROM agent_runs r JOIN agent_rule_results rr ON rr.run_id=r.id
        WHERE r.job_id=$1 AND r.organization_id=$2 AND rr.rule_id=$3 FOR UPDATE`, [jobId, organizationId, feedback.ruleId]);
      if (!found.rowCount) throw new AppError('The completed rule result was not found.', { code: 'RESULT_NOT_FOUND', status: 404 });
      const row = found.rows[0];
      const status = feedback.action === 'confirm' ? 'confirmed' : feedback.action === 'correct' ? 'corrected' : 'rejected';
      await client.query('UPDATE agent_rule_results SET verification_status=$1,score=COALESCE($2,score) WHERE id=$3', [status, feedback.correctedScore, row.result_id]);
      await client.query('INSERT INTO agent_feedback_events(id,organization_id,run_id,rule_id,action,payload,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [newId(), organizationId, row.run_id, feedback.ruleId, feedback.action, feedback, actorId]);
      let lesson = null;
      if (feedback.action !== 'reject') {
        const content = feedback.action === 'correct' ? feedback.lesson : `Verified check for “${row.rule_text}”: score ${row.score ?? 'unscored'}. ${row.explanation}`;
        const added = await client.query(`INSERT INTO agent_lessons(id,organization_id,store_id,rule_id,content,source,status,embedding,created_by)
          VALUES($1,$2,$3,$4,$5,'corrected_finding','verified',$6::vector,$7) RETURNING id,content,status`,
          [newId(), organizationId, row.store_id, feedback.ruleId, content, vector(embedding), actorId]);
        lesson = added.rows[0];
      }
      await this.event(client, organizationId, jobId, 'result.feedback_recorded', { ruleId: feedback.ruleId, action: feedback.action, lessonId: lesson?.id });
      await client.query('COMMIT');
      return { runId: row.run_id, ruleId: feedback.ruleId, verificationStatus: status, lesson };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async close() { await this.pool.end(); }
}
