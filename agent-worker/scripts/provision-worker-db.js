import { Client } from 'pg';

const required = name => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const host = required('DB_HOST');
const port = Number(process.env.DB_PORT || 5432);
const database = required('DB_NAME');
const ownerUser = required('DB_USER');
const projectRef = required('SUPABASE_PROJECT_REF');
const workerRole = String(process.env.WORKER_DB_ROLE || 'masarat_agent_worker').trim();
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DB_PORT is invalid.');
if (!/^[a-z][a-z0-9_]{2,62}$/.test(workerRole)) throw new Error('WORKER_DB_ROLE is invalid.');
if (!/^[a-z0-9]{8,40}$/.test(projectRef)) throw new Error('SUPABASE_PROJECT_REF is invalid.');

process.stdin.setEncoding('utf8');
let input = '';
for await (const chunk of process.stdin) input += chunk;
const separator = input.indexOf('\n');
if (separator < 1) throw new Error('Expected the owner and worker database passwords on standard input.');
const ownerPassword = input.slice(0, separator).replace(/\r$/, '');
const workerPassword = input.slice(separator + 1).replace(/[\r\n]+$/, '');
if (!ownerPassword || workerPassword.length < 32) throw new Error('Database password input is missing or too short.');

const ssl = { rejectUnauthorized: true };
const owner = new Client({ host, port, database, user: ownerUser, password: ownerPassword, ssl });
await owner.connect();
try {
  const existing = await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [workerRole]);
  if (!existing.rowCount) {
    await owner.query(`CREATE ROLE "${workerRole}" LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION`);
  }
  const passwordStatement = await owner.query(
    "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
    [workerRole, workerPassword]
  );
  await owner.query(passwordStatement.rows[0].sql);
  await owner.query(`GRANT USAGE ON SCHEMA public TO "${workerRole}"`);
  await owner.query(`GRANT SELECT, UPDATE ON agent_jobs TO "${workerRole}"`);
  await owner.query(`GRANT SELECT ON agent_lessons, agent_runs, agent_rule_results TO "${workerRole}"`);
  await owner.query(`GRANT INSERT ON agent_runs, agent_rule_results, agent_events TO "${workerRole}"`);
  await owner.query(`GRANT SELECT, INSERT, UPDATE ON agent_workers TO "${workerRole}"`);
  await owner.query(`GRANT USAGE, SELECT ON SEQUENCE agent_events_id_seq TO "${workerRole}"`);
} finally {
  await owner.end();
}

const workerUser = `${workerRole}.${projectRef}`;
const worker = new Client({ host, port, database, user: workerUser, password: workerPassword, ssl });
await worker.connect();
try {
  await worker.query('SELECT id,status FROM agent_jobs LIMIT 1');
  await worker.query('SELECT id,status FROM agent_lessons LIMIT 1');
  await worker.query('SELECT worker_id,status FROM agent_workers LIMIT 1');
} finally {
  await worker.end();
}
process.stdout.write(`${workerUser}\n`);
