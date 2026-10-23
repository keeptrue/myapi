# 上游协议笔记

> 以下事实来自 AStudio 客户端/公开社区项目的逆向研究，并通过真实账号链路验证。上游是私有接口，可能随时变化；本项目按「能取到就用、取不到就降级」处理。

## 1. 三个 Host

| 用途 | Base |
|---|---|
| 推理 | `https://maas-api.cn-huabei-1.xf-yun.com/v1` |
| 模型目录 | `https://astronstudio-api-volces-prod.xf-yun.com/api/v1/model-manager` |
| 工作区（登录/权益/凭据） | `https://agent.xfyun.cn/xingchen-studio` |

工作区请求统一带：

```http
clientType: 22          # Windows 21，其他 22
studioVersion: 3.4.4
Accept: application/json
User-Agent: AStudio/3.4.4
Cookie: ssoSessionId=<id>; sso_sessionid=<id>; account_id=<accountId>; token=<token>
```

## 2. 手机号短信登录

```text
GET  {workspace}/chat/gee-captcha               -> {gt, challenge, success, new_captcha}
POST {workspace}/login/mobile/send-verify-code   multipart，需 GeeTest 结果
POST {workspace}/login/phone-quick-login         multipart，短信码
POST {workspace}/tenant-app/v2/init-app          Cookie；返回 banned，并发放当日登录奖励
GET  {workspace}/userInfo                        Cookie；补齐 uid / mobile
GET  {workspace}/bot/models/configs              Cookie；换取 modelBearerToken
```

`send-verify-code` 的 multipart 字段：

- `geetest_challenge`
- `geetest_validate`
- `geetest_seccode`：浏览器 `getValidate().geetest_seccode` 的 **base64**
- `mobile`
- `countryCode=86`

`phone-quick-login` 的字段：`mobile`、`verifyCode`、`countryCode=86`。

GeeTest v3 由浏览器加载 `https://static.geetest.com/static/tools/gt.js`，按官方客户端参数初始化：

```js
initGeetest({ ...cfg, https: true, offline: !cfg.success, product: 'bind' }, inst => {
  inst.onReady(() => inst.verify())
  inst.onSuccess(() => inst.getValidate())
})
```

服务端强制校验 GeeTest；空验证码返回 `code=20009 geetest verify failed`。本项目不做自动解题。

## 3. 会话与 Cookie

`astron-session.json`（桌面端明文）关键字段：

```json
{
  "accountId": "…",
  "uid": "…",
  "token": "…",
  "ssoSessionId": "…",
  "modelBearerToken": "…",
  "mobile": "…",
  "nickname": "…"
}
```

Cookie 构造：

```text
ssoSessionId=<sso>; sso_sessionid=<sso>; account_id=<accountId>; token=<token>
```

`config.toml` 的兜底字段：

```toml
[model_providers.astron-spark]
experimental_bearer_token = "<32hex>:<base64>"
uid = "<uid>"
```

`config.toml` 只有模型 Bearer，没有会话 Cookie，因此不能签到/读取权益。

## 4. 凭据换取

```http
GET {workspace}/bot/models/configs
Cookie: …
```

应答 `data[]` 每项：

```json
{
  "id": "lm_glm52",
  "name": "GLM-5.2",
  "model": "xopglm52",
  "provider": "…",
  "base_url": "…",
  "api_key": "<32hex>:<base64>",
  "point_multiplier": "1",
  "is_default": true,
  "is_current": true
}
```

取 `is_current` → `is_default` → 第一条可用 `api_key`，即 `modelBearerToken`。401 时用同一 Cookie 重新换取并重放。

## 5. 模型目录

```http
GET {modelsBase}/models
Authorization: Bearer <modelBearerToken>
```

`data.models[]` 关键字段：

- `slug`：推理请求的 `model`
- `display_name`
- `context_window`
- `max_output_tokens`（部分版本为 `max_tokens`）
- `visibility`：只收 `list`
- `supported_in_api`
- `input_modalities`
- `supported_reasoning_levels[].effort`（`none` 表示可关闭思考）
- `default_reasoning_level`
- `priority`

`GET /v1/models` 是陈旧子集，不作为目录来源。

## 6. 权益接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `points/balance` | 通用 + Spark 余额、到期时间 |
| GET | `points/summary` | 积分摘要 |
| GET | `membership/me` | 套餐（`uid` 可能是数字） |
| GET | `client-popups/pending` | 待领弹窗 |
| POST | `client-popups/complete` | `{popupId, instanceKey}` 关闭横幅 |
| POST | `client-download-reward/claim` | 下载奖励 |
| GET | `beta/claim/eligibility` | Beta 资格 |
| POST | `beta/claim` | `{domainAccount}` |
| POST | `redeem-codes/redeem` | `{code}` |
| POST | `tenant-app/v2/init-app` | **真正的每日签到发奖** |

信封：

```json
{ "flag": true, "code": 0, "desc": "", "traceId": "…", "data": { } }
```

会话失效：HTTP 401/403，或 `code` 为 `1002` / `1005`。

签到说明：`init-app` 当日首次调用即入账；`client-popups/complete` 只关闭横幅，不发奖。重复调用不会重复发放。

## 7. 推理

```http
POST {upstream}/chat/completions
Authorization: Bearer <modelBearerToken>
Content-Type: application/json
clientType: 22
uid: <uid>            # 可选；"0" 不发送
Accept: application/json, text/event-stream
```

支持：

- 非流式 / SSE 流式
- `tools`、`tool_choice`
- `reasoning_effort`（上游词汇 `none` / `high` / `max` 等；`off` 不是合法值）
- `stream_options.include_usage`
- `/v1/responses`（Responses API）

上游对不认识的 body 返回 `10005 invalid request`，常常不指出字段。网关因此先修 wire-format 问题，再按「更保守的形状」重试，最后做一次有界诊断。

## 8. models.dev 参考数据

`https://models.dev/api.json` 是外部社区维护的模型规格与价格目录，不属于 AStudio 上游。本项目只把它当“官方参考层”：

- `cost.*` 单位是 **USD / 1M tokens**（见 models.dev README）；
- `canonical_model_id` 用于把不同 provider 的同一模型归并；
- `modalities.input/output`、`limit.context/input/output`、`reasoning_options`、`tool_call`、`structured_output`、`attachment`、`temperature`、`open_weights` 只作能力对照；
- 第三方聚合商（OpenRouter、Vercel 等）的报价不作为“官方价”；
- 上游没有公开“积分→货币、每百万 token 消耗多少积分”的基准，`point_multiplier` 与 models.dev 的 USD 价格只并列展示。

## 9. 参考

- [`Cwentor/dsh-myapi-connect`](https://github.com/Cwentor/dsh-myapi-connect)（MIT）
- [`2951461586/myapi`](https://github.com/2951461586/myapi)（MIT）

协议事实以真实请求为准；本文不包含任何真实 token。
