# Production deployment and runbook

## Required production services

Run the API and worker as separate processes from the same release artifact:

- API: `npm start`
- Worker: `npm run worker`
- PostgreSQL with the `pgvector` extension and automated backups
- an OIDC identity provider that issues short-lived access tokens
- either an OpenAI API project with budget alerts or a dedicated always-on Mac
  signed in to Codex with sufficient plan allowance

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

## Low-cost worker: always-on macOS

Keep the authenticated API hosted initially, but move browser and model work to
the always-on Mac:

1. Install Node.js 24+ and sign in to the Codex desktop app with the intended
   ChatGPT account.
2. Clone the public repository and check out the reviewed production branch.
3. From `agent-worker`, run `npm run install:macos` and enter the Supabase owner
   password when prompted. It is used once to migrate and provision a restricted
   worker role.
4. Run `~/Library/Application Support/Masarat Website Agent/app/scripts/macos/status-worker.sh`
   and confirm the LaunchAgent is running without database or Codex errors.
5. Queue one canary check, review its evidence, then pilot 10 sites per day for
   three days before raising volume.

The installer stores the generated worker password in macOS Keychain and only
non-secret settings in an owner-readable file. The LaunchAgent starts after that
macOS user logs in, restarts after failures, polls Supabase outbound-only, and
uses `gpt-5.6-sol` through `codex exec`. It does not expose a port on the Mac.

Codex plan allowance is finite. If the CLI reports a usage limit, queued jobs
remain durable in PostgreSQL and resume after the allowance resets. Do not add
an API key as an automatic fallback unless API spend has been explicitly
approved.

## Release sequence

1. Build one immutable release from a reviewed commit and run `npm ci`.
2. Set `BROWSER_EXECUTABLE_PATH` to an installed Google Chrome/Chromium binary,
   or install the matching runtime with `npx playwright install chromium`. Use
   installed Google Chrome on macOS 13, where current Playwright releases no
   longer distribute a compatible bundled Chromium.
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

- `OPENAI_API_KEY` is available only to an OpenAI-backed worker (and optionally
  the API if lesson embeddings are enabled there). A Codex-backed worker has no
  API key and performs lexical/recent verified-memory retrieval without paid
  embeddings.
- `DATABASE_URL` is available to the API, migration job, and worker. Alternatively,
  set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` separately so
  passwords containing URI-reserved characters never need manual encoding.
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
