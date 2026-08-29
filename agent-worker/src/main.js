import { loadConfig } from './config.js';
import { createStore } from './store/index.js';
import { OpenAIClient } from './ai/openai-client.js';
import { createApiServer } from './api/server.js';
import { log } from './lib/logger.js';

const config = loadConfig();
const store = await createStore(config);
const embeddings = config.openAIKey ? new OpenAIClient(config) : null;
const server = createApiServer({ config, store, embeddings });

server.listen(config.port, config.host, () => log('info', 'api.started', { host: config.host, port: config.port, database: config.databaseUrl ? 'postgres' : 'sqlite' }));

const shutdown = async signal => {
  log('info', 'api.stopping', { signal });
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
