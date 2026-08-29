import { SqliteStore } from './sqlite-store.js';
import { PostgresStore } from './postgres-store.js';

export async function createStore(config) {
  const store = config.databaseUrl
    ? await PostgresStore.connect({ connectionString: config.databaseUrl, ssl: config.databaseSsl })
    : new SqliteStore(config.sqlitePath);
  await store.init();
  return store;
}
