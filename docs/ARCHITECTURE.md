# 架构

> **进度说明**：本文描述的是当前代码的实际结构。多提供商改造（provider adapter 层）正在
> 进行中，目标结构见 [TASK.md](../TASK.md) 的 M1。当前版本只内置 AStudio 一个提供商，
> `src/server/astron/*` 即为它将来要迁移成的 adapter。

## 1. 进程与模块

单进程 Node.js 服务（Fastify 5），同时提供数据面、控制台 API 与静态前端。

```text
Browser (React SPA)
   │  /api/*  panel session cookie + CSRF header
   ▼
Fastify
   ├─ routes/auth       面板密码、会话、短信登录
   ├─ routes/accounts   账号导入、刷新、签到、兑换
   ├─ routes/keys       API Key 生命周期
   ├─ routes/models     目录、显隐、探测、别名
   ├─ routes/usage      统计、日志、导出
   ├─ routes/settings   运行参数
   ├─ routes/v1         三协议数据面
   ├─ gateway/          选号、重试、协议转换、流式中继
   ├─ astron/           上游 HTTP 客户端、会话解析、目录
   ├─ modelsdev/        models.dev 拉取、缓存、匹配与能力对照
   ├─ models/           探测 service（消息/档位/账号/图片）
   ├─ store/            state.json、JSONL 日志、benefits.jsonl
   ├─ crypto/           AES-GCM、scrypt、HMAC、会话签名
   └─ scheduler/        目录刷新、保活、每日签到
```

| 模块 | 职责 |
|---|---|
| `config.ts` | CLI/env 解析、默认值、上游地址 |
| `crypto/secretbox.ts` | AES-256-GCM；AAD 绑定 `astudio:<accountId>:<field>` |
| `crypto/password.ts` | scrypt 面板密码摘要 |
| `crypto/apikey.ts` | API Key 生成、HMAC 存储与常量时间比较 |
| `crypto/session.ts` | HMAC 签名面板会话（含 authVersion） |
| `store/state.ts` | 单文档状态、原子写、debounce、备份、迁移 |
| `store/logs.ts` | 请求日志 JSONL、benefits 事件、ring、保留策略 |
| `astron/client.ts` | workspace 信封请求、multipart 登录、推理 fetch |
| `astron/session.ts` | `config.toml` / `astron-session.json` 解析与 Cookie |
| `astron/accounts.ts` | 凭据刷新、权益快照、签到、保活、兑换 |
| `astron/catalog.ts` | 双源目录合并、可用性、别名、快照、倍率 |
| `modelsdev/client.ts` | models.dev 拉取、ETag、超时与体积上限 |
| `modelsdev/normalize.ts` | 官方 provider/模型精简、价格/模态/推理解析 |
| `modelsdev/match.ts` | 归一化匹配、官方 provider 选择、能力对照 |
| `modelsdev/service.ts` | 缓存、刷新、搜索、手动绑定、状态 |
| `models/probe.ts` | 探测请求构造、回复解析、错误分类、持久化 |
| `gateway/select.ts` | 游标轮询、冷却、绑定、余额感知 |
| `gateway/engine.ts` | 跨账号失败切换、401 刷新重放 |
| `gateway/chat.ts` | 请求修复、形状降级、400 诊断 |
| `gateway/messages.ts` | Anthropic ↔ Chat 双向转换 |
| `gateway/responses.ts` | Responses 透传 |
| `gateway/relay.ts` | SSE 中继、usage/首 token 提取 |
| `scheduler.ts` | 每分钟读设置并执行任务 |

## 2. 一次 Chat 请求

1. `/v1/chat/completions` 校验 `Authorization: Bearer` 或 `x-api-key`；Key 必须启用、在 RPM 内、模型在白名单内。
2. `catalog.resolve(model)` 把显示名 / slug / 目录 ID / 别名解析成上游 slug。
3. `ChatGateway` 修复 wire-format 问题（tool arguments 字符串化、null content、缺失 tool_call_id），按目录过滤 `reasoning_effort`，必要时加 `stream_options.include_usage`。
4. `GatewayEngine` 选账号；上游 401 时用 Cookie 重新换取 `modelBearerToken` 并重放一次；429 / 5xx 换号，最多 3 个账号。
5. 2xx 响应：
   - 非流式：读取 JSON、把 `model` 改回客户端请求名、提取 usage、写日志。
   - 流式：`reply.hijack()` + SSE 逐块转发；每块重置空闲计时器；提取 usage 与首 token 延迟；客户端断开即取消上游。
6. 400：先尝试更保守的请求形状（去平台字段、`developer`→`system`、文本块拍平）；仍失败则做一次有界诊断（`max_tokens` 上限、去 tools、去 effort），成功后把修复应用到后续请求。
7. 403 等权益错误原样透传，不换号、不误伤账号。
8. 用量写入内存聚合 + `data/logs/YYYY-MM-DD.jsonl`。

## 3. 账号选择

- 候选：启用、未冷却、有 Cookie 或 Bearer；按 Key 绑定账号时只取该账号。
- 游标：进程内递增，按账号列表顺序轮询。
- 余额感知（默认开）：先跳过通用与 Spark 都为 0 的账号，第二轮再回退到全部候选。
- 模型可用性：`bot/models/configs` 知道哪些账号能调用某模型；优先选可用账号，但不硬拒绝其他账号。
- 成功：`successes++`、`lastUsedAt=now`、清空错误。
- 失败：`failures++`、指数冷却（20s 起，上限 300s）；401 刷新失败冷却 300s。
- 流式请求一旦发出首字节，不再换号。

## 4. 状态与持久化

```text
data/
  state.json          # 设置、账号（密文）、Key（HMAC）、显隐、别名、探测、统计、签到
  secret.key          # 32 字节主密钥（0600）；可用 MYAPI_SECRET_KEY 替代
  catalog.json        # 最近一次目录快照
  modelsdev.json      # models.dev 精简快照（可删除后重拉）
  logs/YYYY-MM-DD.jsonl
  benefits.jsonl
  backups/state-*.json
```

- 状态写入：临时文件 → fsync → rename；1s debounce；串行写链。
- 启动时若已有状态文件，先复制到 `backups/`（保留 5 份）。
- 解密失败不崩溃：账号标记 `sessionOk=false`，提示重新导入。
- 统计聚合按 `total / byModel / byHour / byAccount / byKey`，30s 内随状态落盘。
- 日志保留天数与内存条数可配置；日志只含元数据。

## 5. 目录模型

两个来源：

1. `GET {modelsBase}/models`（Bearer `modelBearerToken`）：上下文窗口、最大输出、推理档位、可见性。
2. `GET {workspace}/bot/models/configs`（Cookie）：该账号可调用的模型、目录 ID、显示名、倍率、当前凭据。

合并规则：

- 只保留 `visibility = list`、`supported_in_api != false` 且上下文/输出为正的行。
- 账号配置里存在但目录没有的模型也会保留（来源 `bot-configs`）。
- `availableAccountIds` 记录哪些账号能调用；目录配置全空时视为未知，`available=true`。
- 刷新失败保留上次快照；完全无快照时目录为空，不用内置清单顶替。
- 显隐只影响选择器与 `/v1/models`；已选中的会话仍可调用。

## 5.1 官方元数据（models.dev）

models.dev 与 AStudio 目录分两层：AStudio 目录是网关实际能力，models.dev 只是官方对照。

- 拉取 `https://models.dev/api.json`，ETag 复用；304 只更新检查时间，失败保留上次快照。
- 精简为 `data/modelsdev.json`：只保留 text-output 的 chat 条目，丢掉 description/benchmarks/weights。
- 自动匹配顺序：手动绑定 → 归一化 name/id/prefix → token 子集（允许供应商前缀）→ 同 family 模糊（阈值 0.86、领先 0.05、上下文比 0.67–1.5）。
- 官方 provider 选择：canonical 前缀对应 first-party 优先，其次 lab 偏好（例如 GLM→zhipuai、Kimi→moonshotai、Seed→volcengine），第三方聚合商不作为官方价。
- 同一模型的不同官方区域报价（global / CN）作为 `alternatives` 最多列 3 个。
- 匹配失败返回 `null`；不猜。Spark 等 models.dev 未收录的模型由用户手动绑定。
- 官方价单位是 USD / 1M tokens；AStudio `point_multiplier` 按账号展示，换算成货币倍率需要用户显式开启估算。

## 6. 安全边界

- 默认回环绑定；Docker 默认只映射 `127.0.0.1`。
- 面板：scrypt 密码 + HMAC 会话 + `authVersion`；写操作要求同源、JSON、`x-myapi-csrf: 1`。
- API：Key 只存 HMAC；前缀索引；模型白名单、账号绑定、RPM。
- 凭据：AES-256-GCM；`data/` 0700；日志与错误信息不回显 token。
- 上游响应视为不可信：响应体上限、流式逐块、外部 GeeTest 脚本只从 `static.geetest.com` 加载。
- CSP 允许 `self` + GeeTest；`X-Frame-Options: DENY`；`nosniff`；`no-referrer`。
