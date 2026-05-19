# Portkey BYOG Guardrail Worker

Cloudflare Worker webhook for Portkey "Bring Your Own Guardrails".

This Worker seals both the request and response with Cryptowerk Horizon:

- `beforeRequestHook`: hashes the Portkey request body at `request.json`, registers it with Horizon, and returns a transformed Portkey request container when registration succeeds
- `afterRequestHook`: hashes the Portkey response body at `response.json`, registers it with Horizon, and returns a transformed Portkey response container when registration succeeds

When both hooks succeed, the final API response body includes a visible `cryptowerk` block with:

- request retrieval ID
- request SHA-256
- response retrieval ID
- response SHA-256
- retrieval-specific verification URLs

If Horizon is unavailable or too slow, the Worker fails open and returns `verdict: true` without blocking the request.

## Demo mode

If you just want to try the integration today, you do not need your own Cloudflare account or Cloudflare credentials.

You can use the already deployed demo guardrail as the Portkey webhook URL:

```text
https://portkey-byog-guardrail.i001962.workers.dev
```

In that mode:

- you do not need to run `wrangler login`
- you do not need to deploy your own Worker first
- you can test directly from Portkey using either a saved config slug or an inline `x-portkey-config`

You still need:

- a Portkey API key
- a Portkey provider/integration that can call your target model

You only need your own Cloudflare setup if you want to deploy and operate your own copy of this Worker which we recommend.

## Project files

- `src/index.ts`: Worker implementation
- `wrangler.toml`: Wrangler configuration
- `package.json`: install and deploy scripts
- `.gitignore`: local ignores

## Prerequisites

You need:

- a Cloudflare account with Workers access
- Cryptowerk Horizon access
- a Horizon base URL
- optionally a Horizon API key credential pair
- Node.js and npm installed locally

## Install dependencies

```bash
npm install
```

## Authenticate Wrangler with Cloudflare

Before deploying or setting secrets, log Wrangler into your Cloudflare account:

```bash
npx wrangler login
```

## Configure `CW_BASE_URL`

Use the shared Horizon base URL unless Cryptowerk gave you an account-specific Horizon URL:

```bash
printf 'CW_BASE_URL="https://aiagent.cryptowerk.com/platform/API/v8"\n' > .dev.vars
```

For deployed environments, set `CW_BASE_URL` in one of these places:

1. Cloudflare dashboard for the Worker
2. `wrangler.toml` under `[vars]`

Example:

```toml
[vars]
CW_BASE_URL = "https://aiagent.cryptowerk.com/platform/API/v8"
```

## Set `CW_API_KEY` as a Wrangler secret
Visit cryptowerk.com to get a free api key.
Most Horizon examples use a space between key and credential:

```text
X-API-Key: <apiKey> <apiCred>
```

Store that full value as the `CW_API_KEY` secret:

```bash
npx wrangler secret put CW_API_KEY
```

Paste:

```text
<apiKey> <apiCred>
```

## Local development

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

Wrangler prints the deployed URL, typically in this shape:

```text
https://portkey-byog-guardrail.<your-subdomain>.workers.dev
```

## Portkey webhook setup

Use the deployed Worker URL as your Portkey guardrail webhook URL:

```text
https://portkey-byog-guardrail.<your-subdomain>.workers.dev
```

Portkey webhook headers can be empty unless you add your own Worker-side auth:

```json
{}
```

## Use with Portkey

You can use this Worker with Portkey in two ways:

1. configure the guardrails in the Portkey dashboard and call the config slug
2. pass the guardrail configuration inline in `x-portkey-config`

### Option 1: Saved Portkey config slug

If you created a Portkey config in the dashboard, call it with the slug:

```bash
curl https://api.portkey.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-portkey-api-key: YOUR_PORTKEY_API_KEY" \
  -H "x-portkey-config: YOUR_PORTKEY_CONFIG_SLUG" \
  -d '{
    "model": "@YOUR_INTEGRATION/gpt-3.5-turbo",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "What is fifa world cup?"
      }
    ],
    "max_tokens": 512
  }'
```

### Option 2: Inline `x-portkey-config`

If you do not want to depend on a saved dashboard config, you can define the guardrails directly in the request header:

```bash
curl https://api.portkey.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-portkey-api-key: YOUR_PORTKEY_API_KEY" \
  -H 'x-portkey-config: {
    "retry": { "attempts": 3 },
    "cache": { "mode": "simple" },
    "input_guardrails": [
      {
        "id": "pg-test1-705065",
        "default.webhook": {
          "webhookURL": "https://portkey-byog-guardrail.<your-subdomain>.workers.dev",
          "headers": {},
          "timeout": 3000,
          "failOnError": false,
          "is_enabled": true,
          "credentials": {},
          "id": "default.webhook"
        },
        "deny": true,
        "async": false,
        "sequential": false
      }
    ],
    "output_guardrails": [
      {
        "id": "pg-test1-705065",
        "default.webhook": {
          "webhookURL": "https://portkey-byog-guardrail.<your-subdomain>.workers.dev",
          "headers": {},
          "timeout": 3000,
          "failOnError": false,
          "is_enabled": true,
          "credentials": {},
          "id": "default.webhook"
        },
        "deny": true,
        "async": false,
        "sequential": false
      }
    ]
  }' \
  -d '{
    "model": "@YOUR_INTEGRATION/gpt-3.5-turbo",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "What is fifa world cup?"
      }
    ],
    "max_tokens": 512
  }'
```

## Cryptowerk Horizon details

Base URL:

- `https://aiagent.cryptowerk.com/platform/API/v8`
- or the account-specific Horizon base URL provided by Cryptowerk

Register endpoint used by this Worker:

```text
POST ${CW_BASE_URL}/register?hashes=<sha256>&publiclyRetrievable=true
```

Expected successful Horizon response:

```json
{
  "documents": [
    {
      "retrievalId": "..."
    }
  ]
}
```

Verification URL format:

```text
https://aiagent.cryptowerk.com/platform/portal/CertificateDownload?mode=html&retrievalId=<retrievalId>
```

Additional notes:

- API key issuance is handled by Cryptowerk
- additional blockchain sources across multiple blockchains require Cryptowerk support
- secret seals using `publiclyRetrievable=false` require Cryptowerk account policy and rollout support

## Response shape

When both request and response seals succeed, the final response body includes:

```json
{
  "cryptowerk": {
    "verify": "https://aiagent.cryptowerk.com/platform/portal/CertificateDownload?mode=html&retrievalId=<responseRetrievalId>",
    "request": {
      "retrievalId": "...",
      "sha256": "...",
      "verify": "https://aiagent.cryptowerk.com/platform/portal/CertificateDownload?mode=html&retrievalId=<requestRetrievalId>",
      "hashSource": "request.json",
      "hashAlgorithm": "SHA-256",
      "hashSerialization": "canonical-json-stable-key-order"
    },
    "response": {
      "retrievalId": "...",
      "sha256": "...",
      "verify": "https://aiagent.cryptowerk.com/platform/portal/CertificateDownload?mode=html&retrievalId=<responseRetrievalId>",
      "hashSource": "response.json",
      "hashAlgorithm": "SHA-256",
      "hashSerialization": "canonical-json-stable-key-order"
    }
  }
}
```

## Worker behavior summary

- Uses TypeScript on Cloudflare Workers
- Uses the Web Crypto API, not Node `crypto`
- Does not mutate the original request/response objects directly
- Registers request and response hashes with Horizon
- Uses `publiclyRetrievable=true` when registering
- Returns retrieval-specific certificate URLs
- Fails open if Horizon is unavailable or too slow
