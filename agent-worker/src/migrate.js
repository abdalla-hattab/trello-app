import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from './config.js';

const config = loadConfig(process.env, { requireAuth: false });
if (!config.database) throw new Error('PostgreSQL configuration is required for migrations.');
const { Client } = await import('pg');
const client = new Client({ ...config.database, ssl: config.databaseSsl ? { rejectUnauthorized: true } : false });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'migrations');
const filenames = (await fs.readdir(directory)).filter(name => /^\d+_[a-z0-9_-]+\.sql$/i.test(name)).sort();
if (!filenames.length) throw new Error('No database migrations were found.');
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('agencygrow.website-agent.migrations'))");
  await client.query(`CREATE TABLE IF NOT EXISTS agent_schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const filename of filenames) {
    const sql = await fs.readFile(path.join(directory, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query('SELECT checksum FROM agent_schema_migrations WHERE version=$1', [filename]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration ${filename} has changed. Create a new migration instead of editing history.`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO agent_schema_migrations(version,checksum) VALUES($1,$2)', [filename, checksum]);
      await client.query('COMMIT');
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log('Database migrations are current.');
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('agencygrow.website-agent.migrations'))").catch(() => {});
  await client.end();
}
