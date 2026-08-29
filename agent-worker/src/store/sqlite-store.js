import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { rankLessons } from '../memory/rank.js';

const parse = value => value === null || value === undefined ? null : JSON.parse(value);

export class SqliteStore {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  }

  async init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, request_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, store_id TEXT NOT NULL, status TEXT NOT NULL,
        payload TEXT NOT NULL, response TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL, next_attempt_at TEXT NOT NULL,
        lease_owner TEXT, lease_expires_at TEXT, error_code TEXT, error_message TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(organization_id, request_id), UNIQUE(organization_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, next_attempt_at, created_at);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
        organization_id TEXT NOT NULL, store_id TEXT NOT NULL, website TEXT NOT NULL,
        rubric_hash TEXT NOT NULL, model TEXT NOT NULL, overall_score REAL,
        started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
        evidence_manifest TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_store_idx ON runs(organization_id, store_id, completed_at DESC);
      CREATE TABLE IF NOT EXISTS rule_results (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        organization_id TEXT NOT NULL, store_id TEXT NOT NULL, rule_id TEXT NOT NULL,
        rule_text TEXT NOT NULL, score REAL, explanation TEXT NOT NULL,
        recommendation TEXT, evidence TEXT NOT NULL, verification_status TEXT NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(run_id, rule_id)
      );
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, store_id TEXT, rule_id TEXT,
        content TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL,
        supersedes_id TEXT, embedding TEXT, created_by TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS lessons_scope_idx ON lessons(organization_id, store_id, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS feedback_events (
        id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, run_id TEXT NOT NULL,
        rule_id TEXT NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL,
        actor_id TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL,
        job_id TEXT, event_type TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
  }

  async health() {
    return this.db.prepare('SELECT 1 AS ok').get().ok === 1;
  }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  event(organizationId, jobId, eventType, data = {}) {
    this.db.prepare('INSERT INTO events(organization_id,job_id,event_type,data,created_at) VALUES(?,?,?,?,?)')
      .run(organizationId, jobId, eventType, JSON.stringify(data), nowIso());
  }

  rowToJob(row) {
    if (!row) return null;
    return {
      id: row.id, organizationId: row.organization_id, requestId: row.request_id,
      storeId: row.store_id, status: row.status, payload: parse(row.payload),
      response: parse(row.response), attempts: row.attempts, maxAttempts: row.max_attempts,
      leaseOwner: row.lease_owner, leaseExpiresAt: row.lease_expires_at,
      error: row.error_code ? { code: row.error_code, message: row.error_message } : null,
      createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
    };
  }

  async createJob({ organizationId, payload, idempotencyKey, maxAttempts }) {
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM jobs WHERE organization_id=? AND (request_id=? OR idempotency_key=?) LIMIT 1')
        .get(organizationId, payload.requestId, idempotencyKey);
      if (existing) return { job: this.rowToJob(existing), created: false };
      const id = newId();
      const now = nowIso();
      this.db.prepare(`INSERT INTO jobs(id,organization_id,request_id,idempotency_key,store_id,status,payload,max_attempts,next_attempt_at,created_at,updated_at)
        VALUES(?,?,?,?,?,'queued',?,?,?,?,?)`)
        .run(id, organizationId, payload.requestId, idempotencyKey, payload.storeId, JSON.stringify(payload), maxAttempts, now, now, now);
      this.event(organizationId, id, 'job.queued', { requestId: payload.requestId });
      return { job: this.rowToJob(this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id)), created: true };
    });
  }

  async getJob(organizationId, id) {
    return this.rowToJob(this.db.prepare('SELECT * FROM jobs WHERE organization_id=? AND id=?').get(organizationId, id));
  }

  async claimJob({ workerId, leaseMs }) {
    return this.transaction(() => {
      const now = nowIso();
      const row = this.db.prepare(`SELECT * FROM jobs
        WHERE ((status IN ('queued','retry') AND next_attempt_at<=?) OR (status='running' AND lease_expires_at<?))
        ORDER BY created_at LIMIT 1`).get(now, now);
      if (!row) return null;
      const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
      const changed = this.db.prepare(`UPDATE jobs SET status='running', attempts=attempts+1, lease_owner=?, lease_expires_at=?, updated_at=?
        WHERE id=? AND updated_at=?`).run(workerId, leaseExpiresAt, now, row.id, row.updated_at).changes;
      if (!changed) return null;
      this.event(row.organization_id, row.id, row.status === 'running' ? 'job.reclaimed' : 'job.started', { workerId });
      return this.rowToJob(this.db.prepare('SELECT * FROM jobs WHERE id=?').get(row.id));
    });
  }

  async heartbeat(jobId, workerId, leaseMs) {
    const leaseExpiresAt = new Date(Date.now() + leaseMs).toISOString();
    return this.db.prepare("UPDATE jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND status='running' AND lease_owner=?")
      .run(leaseExpiresAt, nowIso(), jobId, workerId).changes === 1;
  }

  async completeJob(job, result) {
    return this.transaction(() => {
      const now = nowIso();
      const runId = newId();
      const response = { requestId: job.requestId, jobId: job.id, runId, status: 'completed', overallScore: result.overallScore, summary: result.summary, results: result.results };
      const changed = this.db.prepare("UPDATE jobs SET status='completed',response=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?,completed_at=? WHERE id=? AND status='running' AND lease_owner=?")
        .run(JSON.stringify(response), now, now, job.id, job.leaseOwner).changes;
      if (!changed) throw new AppError('The job lease was lost before completion.', { code: 'JOB_LEASE_LOST', retryable: true });
      this.db.prepare(`INSERT INTO runs(id,job_id,organization_id,store_id,website,rubric_hash,model,overall_score,started_at,completed_at,evidence_manifest,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId, job.id, job.organizationId, job.storeId, job.payload.website, job.payload.rubricHash, result.model, result.overallScore, result.startedAt, now, JSON.stringify(result.evidenceManifest || []), now);
      const insert = this.db.prepare(`INSERT INTO rule_results(id,run_id,organization_id,store_id,rule_id,rule_text,score,explanation,recommendation,evidence,verification_status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const item of result.results) insert.run(newId(), runId, job.organizationId, job.storeId, item.ruleId, item.ruleText, item.score, item.explanation, item.recommendation, JSON.stringify(item.evidence), 'unverified', now);
      this.event(job.organizationId, job.id, 'job.completed', { runId, overallScore: result.overallScore });
      return response;
    });
  }

  async failJob(job, error, { retryAt }) {
    return this.transaction(() => {
      const retry = Boolean(error.retryable) && job.attempts < job.maxAttempts;
      const status = retry ? 'retry' : 'failed';
      const now = nowIso();
      this.db.prepare(`UPDATE jobs SET status=?,next_attempt_at=?,lease_owner=NULL,lease_expires_at=NULL,error_code=?,error_message=?,updated_at=?,completed_at=? WHERE id=? AND lease_owner=?`)
        .run(status, retryAt, error.code || 'CHECK_FAILED', String(error.message || 'Check failed').slice(0, 2000), now, retry ? null : now, job.id, job.leaseOwner);
      this.event(job.organizationId, job.id, retry ? 'job.retry_scheduled' : 'job.failed', { code: error.code || 'CHECK_FAILED', attempt: job.attempts });
      return status;
    });
  }

  async findContext({ organizationId, storeId, query, embedding, lessonLimit = 12, historyLimit = 8 }) {
    const lessonRows = this.db.prepare(`SELECT * FROM lessons WHERE organization_id=? AND status='verified' AND (store_id IS NULL OR store_id=?) ORDER BY updated_at DESC LIMIT 1000`).all(organizationId, storeId);
    const lessons = rankLessons(lessonRows.map(row => ({
      id: row.id, storeId: row.store_id, ruleId: row.rule_id, content: row.content,
      source: row.source, embedding: parse(row.embedding), updatedAt: row.updated_at
    })), { query, embedding, storeId, limit: lessonLimit });
    const history = this.db.prepare(`SELECT rr.rule_id AS ruleId,rr.rule_text AS ruleText,rr.score,rr.explanation,rr.verification_status AS verificationStatus,
      r.rubric_hash AS rubricHash,r.completed_at AS completedAt
      FROM rule_results rr JOIN runs r ON r.id=rr.run_id
      WHERE rr.organization_id=? AND rr.store_id=? ORDER BY r.completed_at DESC LIMIT ?`).all(organizationId, storeId, historyLimit);
    return { lessons, history };
  }

  async addLesson({ organizationId, storeId, ruleId, content, source = 'human', embedding, actorId, supersedesId = null }) {
    const id = newId();
    const now = nowIso();
    this.transaction(() => {
      if (supersedesId) this.db.prepare("UPDATE lessons SET status='superseded',updated_at=? WHERE id=? AND organization_id=? AND status='verified'").run(now, supersedesId, organizationId);
      this.db.prepare(`INSERT INTO lessons(id,organization_id,store_id,rule_id,content,source,status,supersedes_id,embedding,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'verified',?,?,?,?,?)`).run(id, organizationId, storeId, ruleId, content, source, supersedesId, embedding ? JSON.stringify(embedding) : null, actorId, now, now);
      this.event(organizationId, null, 'lesson.created', { lessonId: id, storeId, ruleId, source });
    });
    return { id, organizationId, storeId, ruleId, content, source, status: 'verified', createdAt: now };
  }

  async listLessons({ organizationId, storeId = null, limit = 100 }) {
    const rows = storeId
      ? this.db.prepare(`SELECT * FROM lessons WHERE organization_id=? AND (store_id IS NULL OR store_id=?) ORDER BY updated_at DESC LIMIT ?`).all(organizationId, storeId, limit)
      : this.db.prepare(`SELECT * FROM lessons WHERE organization_id=? AND store_id IS NULL ORDER BY updated_at DESC LIMIT ?`).all(organizationId, limit);
    return rows.map(row => ({
      id: row.id, organizationId: row.organization_id, storeId: row.store_id, ruleId: row.rule_id,
      content: row.content, source: row.source, status: row.status, supersedesId: row.supersedes_id,
      createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at
    }));
  }

  async revokeLesson({ organizationId, lessonId, actorId }) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT id,status FROM lessons WHERE id=? AND organization_id=?').get(lessonId, organizationId);
      if (!row) throw new AppError('Lesson not found.', { code: 'LESSON_NOT_FOUND', status: 404 });
      if (row.status !== 'revoked') {
        this.db.prepare("UPDATE lessons SET status='revoked',updated_at=? WHERE id=? AND organization_id=?").run(nowIso(), lessonId, organizationId);
        this.event(organizationId, null, 'lesson.revoked', { lessonId, actorId });
      }
      return { id: lessonId, status: 'revoked' };
    });
  }

  async applyFeedback({ organizationId, jobId, feedback, actorId, embedding }) {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT r.id AS run_id,rr.id AS result_id,rr.rule_text,rr.score,rr.explanation
        FROM runs r JOIN rule_results rr ON rr.run_id=r.id WHERE r.job_id=? AND r.organization_id=? AND rr.rule_id=?`).get(jobId, organizationId, feedback.ruleId);
      if (!row) throw new AppError('The completed rule result was not found.', { code: 'RESULT_NOT_FOUND', status: 404 });
      const status = feedback.action === 'confirm' ? 'confirmed' : feedback.action === 'correct' ? 'corrected' : 'rejected';
      this.db.prepare('UPDATE rule_results SET verification_status=?,score=COALESCE(?,score) WHERE id=?').run(status, feedback.correctedScore, row.result_id);
      const now = nowIso();
      this.db.prepare('INSERT INTO feedback_events(id,organization_id,run_id,rule_id,action,payload,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(newId(), organizationId, row.run_id, feedback.ruleId, feedback.action, JSON.stringify(feedback), actorId, now);
      let lesson = null;
      if (feedback.action !== 'reject') {
        const content = feedback.action === 'correct'
          ? feedback.lesson
          : `Verified check for “${row.rule_text}”: score ${row.score ?? 'unscored'}. ${row.explanation}`;
        const id = newId();
        this.db.prepare(`INSERT INTO lessons(id,organization_id,store_id,rule_id,content,source,status,embedding,created_by,created_at,updated_at)
          SELECT ?,organization_id,store_id,? ,?,'corrected_finding','verified',?,?,?,? FROM runs WHERE id=?`)
          .run(id, feedback.ruleId, content, embedding ? JSON.stringify(embedding) : null, actorId, now, now, row.run_id);
        lesson = { id, content, status: 'verified' };
      }
      this.event(organizationId, jobId, 'result.feedback_recorded', { ruleId: feedback.ruleId, action: feedback.action, lessonId: lesson?.id });
      return { runId: row.run_id, ruleId: feedback.ruleId, verificationStatus: status, lesson };
    });
  }

  async close() { this.db.close(); }
}
