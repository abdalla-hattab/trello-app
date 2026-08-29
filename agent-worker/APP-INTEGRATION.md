# App integration contract

This is the boundary between the main app and the isolated website agent. The
agent implementation does not need access to Trello, Pipedrive, Firebase data,
or the complete store card.

## Existing card action

The main app already calls this function from the Play button inside a store
card:

```js
window.startAgentExecution(cardData, agentDescription, agentRules)
```

Keep that call on the per-store card button. The unrelated top-right Play button
is outside this integration.

## Required identity hook

After the main app has authenticated its user, it must configure the agent once:

```js
window.AGENT_EXECUTOR_CONFIG = {
  apiUrl: 'https://agent-api.example.com/v1/checks',
  getAccessToken: async () => {
    // Return a fresh, short-lived OIDC access token for the signed-in user.
    return identitySession.getAccessToken();
  }
};
```

`getAccessToken` may be asynchronous and is called immediately before a check.
Do not put a permanent token, OpenAI key, database password, or hosting secret in
this object. The API derives the company and user from the verified token; the
browser cannot choose another company in the JSON payload.

## Data sent by the agent popup

Only these fields cross the boundary: request ID, stable store ID, store name,
website URL, agent description, rules, and stable rule IDs. The full card object
and unrelated company data are not sent.

The API returns `202` with a same-origin `statusUrl`. The popup polls that URL
until the durable job completes, then renders the score and evidence. Confirmed
findings, corrections, and explicit store lessons are sent to the dedicated
feedback and lessons endpoints.

## Acceptance check

Before release, verify all of the following with a test account:

1. The card Play button opens the large score dashboard for the correct store.
2. The browser request contains a short-lived Bearer token and no AI key.
3. A completed result shows overall and per-rule scores plus evidence.
4. A human correction appears in `GET /v1/lessons?storeId=...` and is retrieved
   on the next check.
5. A user from another organization cannot read that job or lesson.
