# Production deployment and runbook

## Required production services

Run the API and worker as separate processes from the same release artifact:

- API: `npm start`
- Worker: `npm run worker`
- PostgreSQL with the `pgvector` extension and automated backups
- an OIDC identity provider that issues short-lived access tokens
- an OpenAI API project with budget and usage alerts

The API may scale horizontally. Workers may also scale horizontally; database
leases prevent two workers from completing the same job. SQLite is for local
development only.

## Recommended first deployment: Render

Create one Render web service and one Render background worker from the same
GitHub branch. For both services set the root directory to `agent-worker`, the
runtime to Docker, and the Dockerfile path to `./Dockerfile`.

- Web service command: `npm start`; health path: `/health/ready`
- Background worker command: `npm run worker`; do not assign it a public URL
- PostgreSQL: a paid Render Postgres database with `pgvector` enabled
- Migration command before the web release: `npm run migrate`

Set `HOST=0.0.0.0` on the web service. Give the worker the OpenAI key. Both
services need the private PostgreSQL URL. Render supports background workers,
Docker builds, and PostgreSQL `pgvector`; keep the database and worker on private
networking.

## Release sequence

1. Build one immutable release from a reviewed commit and run `npm ci`.
2. Install the matching Chromium runtime with `npx playwright install chromium`.
3. Run `npm test` and `npm run check`.
4. Back up PostgreSQL, then run `npm run migrate`. Migration files are applied in
   order, checksummed, and protected by a PostgreSQL advisory lock.
5. Deploy the API with no worker traffic and verify `/health/live` and
   `/health/ready`.
6. Deploy the worker. Run one internal canary store and review its evidence,
   scores, and memory correction flow before opening normal traffic.
7. Roll back the application image if the canary fails. Do not reverse a schema
   migration by editing an applied SQL file; add a new forward migration.

## Secrets and identity

Store all secrets in the hosting platform's encrypted environment store. Never
put them in `agent-executor.js`, Git, screenshots, logs, or support messages.

- `OPENAI_API_KEY` is available only to the worker (and optionally the API if
  lesson embeddings are enabled there).
- `DATABASE_URL` is available to the API, migration job, and worker.
- Use `AUTH_MODE=oidc` in production. Configure the exact issuer, audience, JWKS
  URL, accepted asymmetric algorithm, and organization mapping.
- Set `ALLOWED_ORIGINS=https://managing.masaratkobra.com`.
- The app must provide a fresh user token through:

```js
window.AGENT_EXECUTOR_CONFIG = {
  apiUrl: 'https://agent-api.example.com/v1/checks',
  getAccessToken: async () => yourIdentityProvider.getAccessToken()
};
```

The OpenAI key and database password must never be returned by that callback.

## Backup and retention

- Enable point-in-time recovery and daily database backups; test restoration at
  least quarterly.
- Retain job and feedback history according to the company's privacy policy.
- The current release stores screenshot hashes and metadata, not screenshot
  files. Add an encrypted object-storage adapter and retention rule before using
  screenshots as permanent audit evidence.
- Revoke or supersede incorrect lessons instead of deleting audit history.

## Monitoring and cost controls

Alert on API 5xx rate, queue age, failed/retried jobs, lease loss, worker memory,
browser crashes, model latency, token spend, and PostgreSQL storage. Put a
distributed rate limit and request-size limit at the API gateway. Start with one
worker and low concurrency, then raise concurrency only after measuring browser
memory and model limits.

## Incident actions

- **Queue growing:** pause new checks at the gateway, inspect worker errors and
  provider limits, then resume without deleting queued jobs.
- **Bad model output:** do not confirm it. Save a human correction, preserve the
  evidence, and add an evaluation case before changing the prompt or model.
- **Compromised token or key:** revoke it at the issuer/provider, rotate the
  hosting secret, restart affected processes, and review access logs.
- **Database problem:** stop workers first, keep the API in maintenance mode,
  restore to a separate database, validate counts and recent feedback, then
  switch traffic.
