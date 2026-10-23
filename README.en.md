# myapi

A local gateway that turns **your logged-in AI client accounts** into one OpenAI-compatible
API. Any client that accepts a custom `base_url` can call these accounts directly at
`http://127.0.0.1:8787/v1` — **no upstream API key, no client modification**.

> Reuses the login state of your own accounts. Not affiliated with any upstream vendor.
> For personal learning and research only.

<p>
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A522.12-3c873a?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/License-MIT%2B%E8%AF%B4%E6%98%8E-f2b544?style=flat-square">
  <img alt="Protocols" src="https://img.shields.io/badge/API-Chat%20%7C%20Responses%20%7C%20Messages-4fd1c5?style=flat-square">
</p>

## What it solves

Many AI clients (AStudio, Qoder, and friends) ship with built-in model quota but no standard
API. Their login state lives inside the local client — you can only use them by opening that
client.

myapi takes over that login state and exposes a standard OpenAI-compatible endpoint locally.
OpenAI SDK, Codex, Claude Code and any self-hosted service can connect directly, with
multi-account rotation, rate limiting, cooldowns and usage statistics.

## Status

| Phase | Content | Status |
|---|---|---|
| M0 | Scaffold, branding, LICENSE, docs skeleton | done |
| M1 | Provider adapter interface, account model v2, AStudio migration | doing |
| M2 | Cross-provider gateway routing, key-scoped providers | pending |
| M3 | Four account onboarding paths (SMS / paste / import / OAuth web login) | pending |
| M4 | Qoder adapter | pending |
| M5 | Admin registration | pending |
| M6 | Multi-provider scheduler, check-in and benefits | pending |
| M7 | Console pages | pending |
| M8 | Docker, CI, GHCR, docs | pending |

See [TASK.md](TASK.md).

**The current build ships with AStudio (iFlytek Astron) as its only provider.** Multi-provider
support is being refactored in. The architecture is already provider-adapter based, so adding a
vendor means adding one implementation rather than touching the gateway.

## Features

- **Three protocols** — `/v1/chat/completions`, `/v1/responses`, `/v1/messages` (incl. `count_tokens`). OpenAI SDK, Codex and Claude Code all connect directly.
- **Account pool** — cursor rotation, 401 credential refresh with replay, 429/5xx failover, exponential cooldown, balance-aware deprioritisation.
- **Real catalog** — merges the upstream `model-manager` with the account's `bot/models/configs`. No fabricated models; if it cannot fetch, the catalog is honestly empty.
- **Model aliases** — display name, slug, directory ID and custom aliases all work as `model`.
- **Reasoning effort** — filtered against what the catalog declares; probing supports arbitrary message, thinking tier and account scope.
- **Official metadata** — models.dev reference pricing, context, modalities and reasoning options; auto-match plus manual binding, last-good snapshot retained on refresh failure.
- **Full console** — overview, accounts, keys, models, usage, logs, benefits, settings; responsive, dark-first.
- **Credential safety** — AES-256-GCM at rest, scrypt panel password, HMAC-only API keys; conversation content never logged.
- **Benefits** — points, membership, daily check-in, popup claiming, download bonus, Beta, redeem codes; results reported as real balance deltas.
- **Complete delivery** — Dockerfile, compose, launch scripts, smoke script, CI and GHCR release.

## Quick start

### Requirements

- Node.js **≥ 22.12** (22 LTS or 24 recommended).
- [Bun](https://bun.sh/) recommended for install; `npm install` works too but only `bun.lock` is committed.
- Network access to upstream domains.
- For SMS login, the browser must reach `static.geetest.com` (human verification is completed by you, manually).

### Run locally

```bash
bun install
bun run build
./start.sh
# or: node dist/server/main.mjs
```

First launch prints:

```text
  myapi v0.1.0
  console    http://127.0.0.1:8787/
  data dir   ./data
  upstream   https://maas-api.cn-huabei-1.xf-yun.com/v1

  first launch: generated console password
  9f2c7e41d8a64b03c5f10e6a2b9d8471
```

Open `http://127.0.0.1:8787/`, log in with that password, then add an AStudio account on the
Accounts page. Change the password in Settings immediately; or set `MYAPI_ADMIN_PASSWORD` at
launch.

```bash
node dist/server/main.mjs --port 8787 --host 127.0.0.1 --data-dir ./data
node dist/server/main.mjs --lan            # listen on all interfaces (loopback by default)
```

### Docker

```bash
docker compose up -d --build
docker compose logs -f
```

Open `http://127.0.0.1:8787/`. There is no desktop client inside the container, so use
**phone + SMS code + GeeTest**, or paste credentials directly. Everything (state, logs, master
key) lives in the `./data` volume.

### Adding an account

On the Accounts page click **Add account**. Three ways:

- **SMS login** — enter your phone number, a GeeTest slider appears in the browser and **you drag
  it yourself**, then enter the SMS code. The gateway never solves it automatically.
- **Paste credentials** — copy `experimental_bearer_token` from the desktop client's `config.toml`
  plus fields from `astron-session.json`. A Bearer-only account works for model calls but cannot
  check in.
- **Import file** — pick the local `config.toml` and `astron-session.json` directly. The browser
  reads them as text locally and submits to the gateway for parsing; nothing is uploaded to a third
  party.

### Verify

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/v1/models -H "Authorization: Bearer sk-myapi-…"

curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Authorization: Bearer sk-myapi-…' \
  -H 'Content-Type: application/json' \
  -d '{"model":"GLM-5.2","messages":[{"role":"user","content":"hello"}],"stream":true}'
```

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="sk-myapi-…")
resp = client.chat.completions.create(
    model="GLM-5.2",
    messages=[{"role": "user", "content": "hello"}],
)
print(resp.choices[0].message.content)
```

Real-link smoke test:

```bash
MYAPI_API_KEY=sk-myapi-… node scripts/smoke.mjs

BASE_URL=http://127.0.0.1:8787 MODEL=GLM-5.2 MYAPI_API_KEY=sk-myapi-… node scripts/smoke.mjs
```

## Configuration

Copy `.env.example` to `.env` (never commit it), or export the variables.

| Variable | Default | Notes |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address. Keep loopback unless you deliberately expose the panel. |
| `PORT` | `8787` | Listen port. |
| `MYAPI_DATA_DIR` | `./data` | State, logs and master key. **Back this up.** |
| `MYAPI_SECRET_KEY` | — | Optional base64 32-byte key. Otherwise `secret.key` is generated in the data dir. |
| `MYAPI_ADMIN_PASSWORD` | — | Optional; authoritative when present. |
| `MYAPI_LOG_LEVEL` | `info` | Log level. |
| `MYAPI_MAX_BODY_MB` | `32` | Request body limit. |
| `MYAPI_MAX_CONCURRENCY` | `8` | Upstream concurrency limit. |
| `MYAPI_TRUST_PROXY` | `false` | Set `true` to trust `X-Forwarded-For`. |
| `TZ` | `Asia/Shanghai` | Timezone. |

Advanced upstream overrides: `MYAPI_UPSTREAM_BASE`, `MYAPI_MODELS_BASE`, `MYAPI_WORKSPACE_BASE`,
`MYAPI_STUDIO_VERSION`, `MYAPI_CLIENT_TYPE`.

## Security notes

- Loopback by default. Use `--lan` or a Docker mapping for LAN access, and **always set a strong
  panel password**.
- Account credentials are encrypted at rest with AES-256-GCM, AAD bound to the account ID. API
  keys are stored as HMAC only.
- Logs carry metadata only — no conversation content, tokens or cookies.
- Console write operations require same-origin plus the `x-myapi-csrf` header.
- Upstream responses are treated as untrusted: size caps, chunked streaming, field validation,
  graceful degradation.

## Disclaimer

For personal learning and research, driving **your own** accounts. Calls made through this project
do not enter the upstream client's turn-billing chain — that does not make them free; upstream
tokens are still consumed. Upstream endpoints are private client interfaces and may change at any
time; this project degrades to the last successful snapshot and makes no long-term compatibility
promise.

Please respect each upstream's terms of service. You assume all responsibility for account
restrictions, quota changes or service interruptions resulting from use. This project is not
affiliated with, endorsed by, or sponsored by any upstream vendor. Trademarks belong to their
owners.

Full terms in [LICENSE](LICENSE).

## Development

```bash
bun run dev            # dev mode (server + web, hot reload)
bun run typecheck      # typecheck both sides
bun run test           # vitest
bun run build          # tsdown + vite build
bun run check          # typecheck + test + build — required before commit
```

Code conventions: [CONTRIBUTING.md](CONTRIBUTING.md). Notes for AI agents: [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE), with an appended **usage statement** adding restrictions (no commercial use, no
redistribution for profit, no bulk account operation). Where the two disagree, the stricter one
wins.

## Credits

The console visual language and engineering skeleton come from the author's other project
[astudio2api](https://github.com/zhuchunshu/astudio2api). The multi-provider account-management
product shape is informed by [agent2api](https://github.com/aimod-cc/agent2api). Thanks to both.
