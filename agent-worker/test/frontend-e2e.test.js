import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const executorPath = path.resolve(here, '../../standalone/agent-executor.js');
const accessPath = path.resolve(here, '../../standalone/agent-access.js');
const accessSource = readFileSync(accessPath, 'utf8');
const card = { id: 'store-7', title: 'Store Seven', agentWebsite: 'https://store.example/' };
const rules = ['Payment icons are visible', 'Product images open the correct collection'];

async function pageFixture(t) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  t.after(() => browser.close());
  await page.route('https://app.example/', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><html><body><button id="outside">Outside</button></body></html>'
  }));
  await page.goto('https://app.example/');
  await page.addScriptTag({ path: executorPath });
  return page;
}

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': 'https://app.example', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  });
}

test('access bridge restores only a session-scoped agent token', async t => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  t.after(() => browser.close());
  await page.addInitScript(() => {
    sessionStorage.setItem('masarat_agent_access_token', 'fixture-session-token');
    localStorage.setItem('managing_masarat_pw', 'legacy-password-value');
  });
  await page.route('https://app.example/', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><head><script>${accessSource}</script></head><body></body></html>`
  }));
  await page.goto('https://app.example/');

  const config = await page.evaluate(async () => ({
    apiUrl: window.AGENT_EXECUTOR_CONFIG.apiUrl,
    token: await window.AGENT_EXECUTOR_CONFIG.getAccessToken(),
    legacyPassword: localStorage.getItem('managing_masarat_pw')
  }));
  assert.equal(config.apiUrl, 'https://masarat-agent-api.onrender.com/v1/checks');
  assert.equal(config.token, 'fixture-session-token');
  assert.equal(config.legacyPassword, null);
  assert.equal(await page.locator('#global-pw-overlay').count(), 0);
});

test('access bridge asks for a password when the browser session is new', async t => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  t.after(() => browser.close());
  await page.route('https://app.example/', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><head><script>${accessSource}</script></head><body></body></html>`
  }));
  await page.goto('https://app.example/');

  assert.equal(await page.locator('#global-pw-overlay').isVisible(), true);
  assert.equal(await page.locator('#global-pw-input').getAttribute('type'), 'password');
  assert.equal(await page.evaluate(() => window.AGENT_EXECUTOR_CONFIG), undefined);
});

test('popup queues, polls, renders scores, and teaches verified memory', async t => {
  const page = await pageFixture(t);
  const calls = [];
  let requestId = '';
  let pollCount = 0;
  await page.route('https://agent.example/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON?.() || null;
    calls.push({ method: request.method(), path: url.pathname, authorization: request.headers().authorization, body });
    if (request.method() === 'POST' && url.pathname === '/v1/checks') {
      requestId = body.requestId;
      return json(route, { requestId, jobId: '11111111-1111-4111-8111-111111111111', status: 'queued', statusUrl: '/v1/checks/11111111-1111-4111-8111-111111111111' }, 202);
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/discussions')) {
      return json(route, { requestId: body.requestId, jobId: '22222222-2222-4222-8222-222222222222', status: 'queued', statusUrl: '/v1/discussions/22222222-2222-4222-8222-222222222222' }, 202);
    }
    if (request.method() === 'GET' && url.pathname.startsWith('/v1/discussions/')) {
      return json(route, {
        requestId: calls.find(call => call.path.endsWith('/discussions'))?.body.requestId,
        jobId: '22222222-2222-4222-8222-222222222222', status: 'completed',
        reply: 'The normal run sampled three product pages.',
        proposedSkill: { name: 'All products', instructions: 'Inspect every discoverable product page.', scopeMode: 'all_product_pages', maximumPages: 100 }
      });
    }
    if (request.method() === 'GET') {
      pollCount += 1;
      if (pollCount === 1) return json(route, { requestId, jobId: '11111111-1111-4111-8111-111111111111', status: 'running' });
      return json(route, {
        requestId, jobId: '11111111-1111-4111-8111-111111111111', status: 'completed',
        results: [
          { ruleId: calls[0].body.ruleIds[0], score: 99, explanation: 'Icons are visible in the captured footer.', recommendation: null, evidence: ['Homepage footer: <img src=x onerror="window.fixtureXss=true"> is shown as evidence text.'] },
          { ruleId: calls[0].body.ruleIds[1], score: 82, explanation: 'One image has no collection link.', recommendation: 'Link that image to its collection.', evidence: ['Homepage image 3 has no linked destination.'] }
        ]
      });
    }
    if (url.pathname.endsWith('/feedback')) return json(route, { verificationStatus: body.action === 'correct' ? 'corrected' : 'confirmed' });
    if (url.pathname === '/v1/lessons') return json(route, { id: 'lesson-1', status: 'verified' }, 201);
    if (url.pathname === '/v1/skills') return json(route, { id: 'skill-1', status: 'verified', ...body }, 201);
    return json(route, { error: { message: 'Unexpected fixture route' } }, 404);
  });
  await page.evaluate(() => {
    window.AGENT_EXECUTOR_CONFIG = {
      apiUrl: 'https://agent.example/v1/checks', pollIntervalMs: 100,
      getAccessToken: async () => 'short-lived-user-token'
    };
  });
  const result = await page.evaluate(({ card, rules }) => window.startAgentExecution(card, 'Audit carefully', rules), { card, rules });
  assert.equal(result.status, 'completed');
  assert.equal(result.overallScore, 90.5);
  assert.equal(calls[0].authorization, 'Bearer short-lived-user-token');
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['agentDescription', 'agentRules', 'requestId', 'ruleIds', 'storeId', 'storeName', 'website'].sort());
  assert.equal(await page.locator('#agency-agent-executor .gauge-large').getAttribute('data-tone'), 'yellow');
  assert.equal(await page.locator('#agency-agent-executor .feedback').count(), 2);
  assert.equal(await page.locator('#agency-agent-executor .evidence').first().isVisible(), true);
  assert.equal(await page.locator('#agency-agent-executor img').count(), 0);
  assert.equal(await page.evaluate(() => window.fixtureXss), undefined);

  await page.locator('#agency-agent-executor .confirm').first().click();
  await assert.doesNotReject(page.locator('#agency-agent-executor .feedback-status').first().waitFor({ state: 'visible' }));
  await page.locator('#agency-agent-executor .teach-box textarea').fill('These footer payment icons are approved for this store.');
  await page.locator('#agency-agent-executor .teach-box button').click();
  await page.waitForFunction(() => document.querySelector('#agency-agent-executor')?.shadowRoot?.querySelector('.teach-status')?.textContent.includes('Lesson saved'));
  assert.ok(calls.some(call => call.path.endsWith('/feedback') && call.body.action === 'confirm'));
  assert.ok(calls.some(call => call.path === '/v1/lessons' && call.body.content.includes('approved')));

  await page.locator('#agency-agent-executor .discuss').first().click();
  await page.locator('#agency-agent-executor .discussion-panel textarea').first().fill('Why only three? Next time check every product page.');
  await page.locator('#agency-agent-executor .send-discussion').first().click();
  await page.waitForFunction(() => document.querySelector('#agency-agent-executor')?.shadowRoot?.querySelector('.skill-proposal')?.hidden === false);
  assert.match(await page.locator('#agency-agent-executor .discussion-message[data-role="assistant"]').first().textContent(), /sampled three/i);
  await page.locator('#agency-agent-executor .save-skill').first().click();
  await page.waitForFunction(() => document.querySelector('#agency-agent-executor')?.shadowRoot?.querySelector('.save-skill')?.textContent === 'Skill saved');
  assert.ok(calls.some(call => call.path.endsWith('/discussions') && call.body.message.includes('every product page')));
  assert.ok(calls.some(call => call.path === '/v1/skills' && call.body.scopeMode === 'all_product_pages' && call.body.maximumPages === 100));
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator('#agency-agent-executor dialog').boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844);
});

test('popup refuses to send when secure sign-in is missing', async t => {
  const page = await pageFixture(t);
  let calls = 0;
  await page.route('https://agent.example/**', route => { calls += 1; return json(route, {}); });
  await page.evaluate(() => { window.AGENT_EXECUTOR_CONFIG = { apiUrl: 'https://agent.example/v1/checks' }; });
  const result = await page.evaluate(({ card, rules }) => window.startAgentExecution(card, '', rules), { card, rules });
  assert.equal(result.status, 'not-started');
  assert.equal(calls, 0);
  assert.match(await page.locator('#agency-agent-executor .notice').textContent(), /sign-in/i);
});

test('popup rejects a cross-origin job status URL', async t => {
  const page = await pageFixture(t);
  await page.route('https://agent.example/**', route => {
    const body = route.request().postDataJSON();
    return json(route, { requestId: body.requestId, jobId: '11111111-1111-4111-8111-111111111111', status: 'queued', statusUrl: 'https://evil.example/jobs/1' }, 202);
  });
  await page.evaluate(() => {
    window.AGENT_EXECUTOR_CONFIG = { apiUrl: 'https://agent.example/v1/checks', getAccessToken: async () => 'token' };
  });
  const result = await page.evaluate(({ card, rules }) => window.startAgentExecution(card, '', rules), { card, rules });
  assert.equal(result.status, 'error');
  assert.match(await page.locator('#agency-agent-executor .notice').textContent(), /unsafe cross-origin/i);
});

test('popup surfaces a durable job failure without inventing scores', async t => {
  const page = await pageFixture(t);
  let requestId;
  await page.route('https://agent.example/**', route => {
    if (route.request().method() === 'POST') {
      requestId = route.request().postDataJSON().requestId;
      return json(route, { requestId, jobId: '11111111-1111-4111-8111-111111111111', status: 'queued', statusUrl: '/v1/checks/11111111-1111-4111-8111-111111111111' }, 202);
    }
    return json(route, { requestId, jobId: '11111111-1111-4111-8111-111111111111', status: 'failed', error: { message: 'The browser could not open the website.' } });
  });
  await page.evaluate(() => {
    window.AGENT_EXECUTOR_CONFIG = { apiUrl: 'https://agent.example/v1/checks', pollIntervalMs: 100, getAccessToken: async () => 'token' };
  });
  const result = await page.evaluate(({ card, rules }) => window.startAgentExecution(card, '', rules), { card, rules });
  assert.equal(result.status, 'error');
  assert.equal(await page.locator('#agency-agent-executor .gauge-large .gauge-value').textContent(), '—');
  assert.match(await page.locator('#agency-agent-executor .notice').textContent(), /could not open/i);
});

test('popup refreshes an expired short-lived identity token while polling', async t => {
  const page = await pageFixture(t);
  let requestId;
  let ruleIds;
  const authorizations = [];
  await page.route('https://agent.example/**', route => {
    authorizations.push(route.request().headers().authorization);
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      requestId = body.requestId;
      ruleIds = body.ruleIds;
      return json(route, { requestId, jobId: '11111111-1111-4111-8111-111111111111', status: 'queued', statusUrl: '/v1/checks/11111111-1111-4111-8111-111111111111' }, 202);
    }
    if (route.request().headers().authorization === 'Bearer expired-token') {
      return json(route, { error: { message: 'expired' } }, 401);
    }
    return json(route, {
      requestId, jobId: '11111111-1111-4111-8111-111111111111', status: 'completed',
      results: ruleIds.map(ruleId => ({ ruleId, score: 98, explanation: 'Verified after token refresh.', recommendation: null, evidence: [] }))
    });
  });
  await page.evaluate(() => {
    let calls = 0;
    window.AGENT_EXECUTOR_CONFIG = {
      apiUrl: 'https://agent.example/v1/checks', pollIntervalMs: 100,
      getAccessToken: async () => (++calls === 1 ? 'expired-token' : 'fresh-token')
    };
  });
  const result = await page.evaluate(({ card, rules }) => window.startAgentExecution(card, '', rules), { card, rules });
  assert.equal(result.status, 'completed');
  assert.ok(authorizations.includes('Bearer expired-token'));
  assert.ok(authorizations.includes('Bearer fresh-token'));
});
