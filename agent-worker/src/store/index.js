import { SqliteStore } from './sqlite-store.js';
import { PostgresStore } from './postgres-store.js';

export async function createStore(config) {
  const store = config.database
    ? await PostgresStore.connect({ connection: config.database, ssl: config.databaseSsl })
    : new SqliteStore(config.sqlitePath);
  await store.init();
  return store;
}
