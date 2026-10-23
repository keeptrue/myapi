# API

所有管理面接口默认需要面板会话 Cookie；所有写操作还需要 `x-myapi-csrf: 1` 且 Origin 与 Host 一致。数据面需要 API Key。

## 鉴权

```http
Authorization: Bearer sk-myapi-...
# 或
x-api-key: sk-myapi-...
```

未创建任何 Key 时返回 `401 no_api_key_configured`。

## 数据面

### GET /v1/models

```json
{
  "object": "list",
  "data": [
    {
      "id": "xopglm52",
      "object": "model",
      "created": 0,
      "owned_by": "astudio",
      "name": "GLM-5.2",
      "context_window": 1000000,
      "max_output_tokens": 8192,
      "reasoning_efforts": ["low", "high", "max"],
      "available": true,
      "source": "merged",
      "directory_id": "lm_glm52",
      "astron": { "slug": "xopglm52", "available": true }
    }
  ]
}
```

隐藏模型与 Key 白名单外的模型不会出现。

### POST /v1/chat/completions

标准 OpenAI Chat Completions。支持流式、工具调用、`reasoning_effort`（按目录声明过滤）。

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-myapi-…" \
  -H "Content-Type: application/json" \
  -d '{"model":"GLM-5.2","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

### POST /v1/responses

原生透传 `responses` 请求，只重写 `model`。流式事件原样转发。

### POST /v1/messages

Anthropic Messages 兼容：

- `system` 字符串或 text blocks → system message；
- `text` / `image` / `tool_use` / `tool_result` → chat messages；
- `tools` / `tool_choice` / `stop_sequences` 映射；
- 非流式返回 `message` + `text` / `tool_use` 块；
- 流式返回 `message_start`、`content_block_start|delta|stop`、`message_delta`、`message_stop`。

## 管理面

### 会话

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{password}`；设置会话 Cookie |
| GET | `/api/auth/session` | `{authenticated, version, passwordGenerated}` |
| POST | `/api/auth/logout` | 清除 Cookie |
| POST | `/api/auth/password` | `{current, next}`；旧会话失效 |

### 登录与账号

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/login/geetest` | 取 GeeTest 配置 |
| POST | `/api/login/sms` | `{mobile, geetest_challenge, geetest_validate, geetest_seccode}` |
| POST | `/api/login/verify` | `{mobile, verify_code}` → 账号 |
| GET | `/api/accounts` | 账号列表（脱敏） |
| POST | `/api/accounts/import` | 粘贴 `token/ssoSessionId/accountId/uid/mobile/modelBearerToken/name` |
| POST | `/api/accounts/import-file` | `{configToml, sessionJson, name?}` |
| PATCH | `/api/accounts/:id` | `{name?, enabled?, domainAccount?}` |
| DELETE | `/api/accounts/:id` | 删除账号 |
| POST | `/api/accounts/:id/refresh` | 换 Bearer + 刷权益 |
| POST | `/api/accounts/:id/test` | 最小对话测试 |
| POST | `/api/accounts/:id/checkin` | 单账号签到 |
| POST | `/api/accounts/checkin-all` | 全员签到 |
| POST | `/api/accounts/:id/keepalive` | 保活 |
| POST | `/api/accounts/:id/redeem` | `{code}` |
| GET | `/api/accounts/:id/events` | 权益事件 |

### 密钥

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/keys` | 列表（只有前缀/后四位） |
| POST | `/api/keys` | `{name, allowedModels, boundAccountId, rpm}` → 完整 Key 仅此一次 |
| PATCH | `/api/keys/:id` | 修改名称/启停/白名单/绑定/RPM |
| POST | `/api/keys/:id/rotate` | 轮换并返回新 Key |
| DELETE | `/api/keys/:id` | 删除 |

### 模型

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/models` | 目录 + 显隐 + 探测 + 倍率 + models.dev 官方对照 |
| POST | `/api/models/refresh` | 手动刷新 AStudio 目录 |
| PATCH | `/api/models/:slug` | `{visible}` |
| POST | `/api/models/:slug/probe` | `{message?, effort?, maxTokens?, accountId?, allAccounts?, image?}` |
| PUT | `/api/models/:slug/reference` | `{key: "provider/model" \| null}`；手动绑定 models.dev 条目 |
| GET | `/api/models-dev` | models.dev 缓存状态 |
| POST | `/api/models-dev/refresh` | 手动刷新 models.dev |
| GET | `/api/models-dev/search?q=&limit=` | 搜索 models.dev 条目，供手动绑定 |
| GET/PUT | `/api/model-aliases` | `{aliases: {alias: target}}` |

`GET /api/models` 的每个模型新增：

- `pointMultipliers`：`[{accountId, accountName, value}]`，来自账号 `bot/models/configs.point_multiplier`；
- `official`：models.dev 条目（`key/provider/context/modalities/reasoning/cost/alternatives/confidence`），未匹配为 `null`；
- `capabilities`：平台值与官方值的对照（上下文、输出、模态、推理、工具能力）。
- 顶层 `modelsDev`：`{enabled, source, fetchedAt, checkedAt, error, refreshing, providers, models}`。

探测请求默认 `message="hi"`、`maxTokens=512`、打首个可调用账号；`effort` 省略时跟随目录 `default_reasoning_level`，传 `null`/`""` 表示不发送 `reasoning_effort`。`allAccounts=true` 最多探测 3 个账号。`image=true` 需要平台目录或 models.dev 声明图片输入。

```json
{
  "results": [
    {
      "accountId": "…",
      "accountName": "…",
      "slug": "xopglm52",
      "effort": "high",
      "effortDeclared": true,
      "modality": "text",
      "state": "ok",
      "validation": "validating",
      "reason": "",
      "httpStatus": 200,
      "latencyMs": 1234,
      "content": "你好！…",
      "reasoning": "",
      "finishReason": "stop",
      "usage": { "promptTokens": 8, "completionTokens": 12, "totalTokens": 20, "cachedTokens": 0, "reasoningTokens": 0 }
    }
  ],
  "probe": {
    "slug": "xopglm52",
    "results": [],
    "latest": {},
    "acceptedEfforts": ["high"],
    "rejectedEfforts": []
  }
}
```

`state`：`ok`（2xx）、`rejected`（400 且上游指出档位/参数未通过）、`failed`（其他 HTTP/网络/超时）。探测只存 500 字预览与 usage，完整回复仅在本次响应中返回。

### 统计与日志

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/usage/summary?range=24h\|7d\|30d\|all` | 汇总、分组、时序 |
| GET | `/api/usage/recent?limit=50` | 最近请求 |
| GET | `/api/usage/by-model` | 按模型 |
| GET | `/api/usage/by-account` | 按账号 |
| GET | `/api/usage/by-key` | 按 Key |
| GET | `/api/logs?limit&model&accountId&status&from&to` | 日志分页 |
| GET | `/api/logs/export?format=csv\|jsonl` | 导出 |
| DELETE | `/api/logs` | 清空日志与统计 |

### 权益与设置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/benefits/summary` | 积分/账号/弹窗汇总 |
| GET | `/api/benefits/events?limit=100` | 权益事件 |
| POST | `/api/benefits/checkin` | `{accountId?}` |
| GET/PUT | `/api/settings` | 运行参数 |
| GET | `/api/system` | 版本、运行时长、目录状态 |

## 错误形状

OpenAI 风格：

```json
{ "error": { "message": "…", "type": "upstream_error", "code": "no_upstream_account" } }
```

Anthropic 风格：

```json
{ "type": "error", "error": { "type": "api_error", "message": "…" } }
```

本地错误码：`auth_required`、`no_api_key_configured`、`invalid_api_key`、`rate_limited`、`model_not_allowed`、`no_upstream_account`、`all_accounts_cooling`、`upstream_unavailable`、`upstream_client_error`。

## 探活

- `GET /healthz`：JSON，不暴露账号身份。
- `GET /ping`：纯文本 `pong`。
