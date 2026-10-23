# myapi

把**多家 AI 客户端里已登录的账号**接到一起，共用一套 OpenAI 兼容接口的本地网关。
任何支持自定义 `base_url` 的客户端，填上 `http://127.0.0.1:8787/v1` 就能直接调用这些
账号的模型额度 —— **不需要上游 API Key，也不需要改客户端**。

> 复用你自己账号的登录态，不重新申请密钥。本项目与任何上游厂商均无关联，仅供个人学习与研究使用。

<p>
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A522.12-3c873a?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/License-MIT%2B%E8%AF%B4%E6%98%8E-f2b544?style=flat-square">
  <img alt="Protocols" src="https://img.shields.io/badge/API-Chat%20%7C%20Responses%20%7C%20Messages-4fd1c5?style=flat-square">
  <img alt="Stack" src="https://img.shields.io/badge/stack-Fastify%20%2B%20React%20%2B%20Tailwind-8b97a8?style=flat-square">
</p>

## 它解决什么问题

很多 AI 客户端（AStudio、Qoder 这类）自带模型额度，但不提供标准 API。它们的登录态存在
本机客户端里，你只能打开那个客户端用。

myapi 做的事是：**接管这些登录态，在本地暴露一个标准 OpenAI 兼容接口**。于是 OpenAI SDK、
Codex、Claude Code、任意自建服务都能直连，还能多账号轮换、限流冷却、用量统计。

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 脚手架、品牌、LICENSE、文档骨架 | done |
| M1 | provider adapter 接口 + 账号模型 v2 + AStudio 迁移 | doing |
| M2 | 网关跨提供商路由、Key 绑定提供商范围 | pending |
| M3 | 四路账号接入（短信 / 粘贴 / 导入 / 网页授权回调） | pending |
| M4 | Qoder adapter | pending |
| M5 | 面板注册管理员 | pending |
| M6 | 调度器与签到权益多提供商化 | pending |
| M7 | 控制台八页适配 | pending |
| M8 | Docker、CI、GHCR、文档 | pending |

详见 [TASK.md](TASK.md)。

**当前版本只内置 AStudio（讯飞星辰）一个提供商**，多提供商适配正在重构中。架构上已经按
provider adapter 设计，加新厂商是加一个实现，不是改网关。

## 特性

- **三套协议** —— `/v1/chat/completions`、`/v1/responses`、`/v1/messages`（含 `count_tokens`）。OpenAI SDK、Codex、Claude Code 都能直连。
- **多账号池** —— 游标轮询、401 刷新凭据并重放、429 / 5xx 换号、指数冷却、余额感知降权。
- **真实目录** —— 合并上游 `model-manager` 与账号 `bot/models/configs`，不内置假模型；取不到就如实为空。
- **模型别名** —— 显示名、slug、目录 ID、自定义别名都可以作为 `model`。
- **推理档位** —— 按目录声明过滤 `reasoning_effort`；探测支持任意消息、思考档位、账号范围。
- **官方元数据** —— 对接 models.dev，显示官方价、上下文、模态、推理选项；自动匹配 + 手动绑定，刷新失败保留上次快照。
- **完整控制台** —— 概览、账号、密钥、模型、统计、日志、权益、设置八个页面；响应式，深色优先。
- **凭据安全** —— AES-256-GCM 落盘加密，面板密码 scrypt，API Key 只存 HMAC；日志不记录对话内容。
- **权益管理** —— 积分 / 会员 / 每日签到 / 弹窗代领 / 下载奖励 / Beta / 兑换码，结果按余额真实增量报告。
- **交付完整** —— Dockerfile、docker-compose、启动脚本、smoke 联调脚本、CI 与 GHCR Release。

## 快速开始

### 前置

- Node.js **≥ 22.12**（推荐 22 LTS 或 24）。
- 安装依赖推荐用 [Bun](https://bun.sh/)；`npm install` 也能装，但仓库只提交 `bun.lock`。
- 能访问上游域名（AStudio 为 `agent.xfyun.cn`、`astronstudio-api-volces-prod.xf-yun.com`、`maas-api.cn-huabei-1.xf-yun.com`）。
- 短信登录需要浏览器能访问 `static.geetest.com`（人机验证由你在浏览器里手动完成）。

### 本机运行

```bash
bun install
bun run build
./start.sh
# 或： node dist/server/main.mjs
```

首次启动会在终端打印：

```text
  myapi v0.1.0
  控制台   http://127.0.0.1:8787/
  数据目录 ./data
  上游     https://maas-api.cn-huabei-1.xf-yun.com/v1

  首次启动：已生成控制台密码
  9f2c7e41d8a64b03c5f10e6a2b9d8471
```

打开 `http://127.0.0.1:8787/`，用这串密码登录，然后到「账号」页添加 AStudio 账号。
登录后请立刻在「设置」里改密码；也可以在启动时用 `MYAPI_ADMIN_PASSWORD` 指定。

常用参数：

```bash
node dist/server/main.mjs --port 8787 --host 127.0.0.1 --data-dir ./data
node dist/server/main.mjs --lan            # 监听所有网卡（默认只绑回环）
```

### Docker

```bash
docker compose up -d --build
docker compose logs -f
```

浏览器打开 `http://127.0.0.1:8787/`。容器里没有桌面客户端，所以用**手机号 + 短信码 +
GeeTest**登录，或直接粘贴凭据。数据（状态、日志、主密钥）都在 `./data` 一个卷里。

### 添加账号

「账号」页点「添加账号」，三种方式：

- **短信登录** —— 输入手机号，浏览器弹出 GeeTest 滑块，**由你本人拖过**，然后收短信填码。网关不做自动解题。
- **粘贴凭据** —— 从桌面端数据目录复制 `config.toml` 的 `experimental_bearer_token` 与 `astron-session.json` 的字段。只有 Bearer 也能当「模型专用」账号用，但无法签到。
- **导入文件** —— 直接选本机 `config.toml` 与 `astron-session.json`。浏览器只在本机读成文本再提交给网关解析，不上传第三方。

### 验证

网关起来后，用 curl 确认联通性（`model` 填 `GET /v1/models` 里任一实际存在的名字）：

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/v1/models -H "Authorization: Bearer sk-myapi-…"

curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Authorization: Bearer sk-myapi-…' \
  -H 'Content-Type: application/json' \
  -d '{"model":"GLM-5.2","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

客户端接入示例（Python SDK）：

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="sk-myapi-…")
resp = client.chat.completions.create(
    model="GLM-5.2",                       # 名单里有哪家就是哪家，见 GET /v1/models
    messages=[{"role": "user", "content": "你好"}],
)
print(resp.choices[0].message.content)
```

真实链路联调：

```bash
MYAPI_API_KEY=sk-myapi-… node scripts/smoke.mjs

BASE_URL=http://127.0.0.1:8787 MODEL=GLM-5.2 MYAPI_API_KEY=sk-myapi-… node scripts/smoke.mjs
```

## 配置

复制 `.env.example` 为 `.env`（不要提交），或直接导出环境变量。

| 变量 | 默认 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址。除非刻意暴露面板，否则保持回环。 |
| `PORT` | `8787` | 监听端口。 |
| `MYAPI_DATA_DIR` | `./data` | 状态、日志、主密钥所在目录。**备份它。** |
| `MYAPI_SECRET_KEY` | — | 可选，base64 编码的 32 字节主密钥。不填则在数据目录生成 `secret.key`。 |
| `MYAPI_ADMIN_PASSWORD` | — | 可选，启动时预置面板密码（存在时以此为准）。 |
| `MYAPI_LOG_LEVEL` | `info` | 日志级别。 |
| `MYAPI_MAX_BODY_MB` | `32` | 请求体上限。 |
| `MYAPI_MAX_CONCURRENCY` | `8` | 上游并发上限。 |
| `MYAPI_TRUST_PROXY` | `false` | 置 `true` 时信任 `X-Forwarded-For`。 |
| `TZ` | `Asia/Shanghai` | 时区。 |

高级上游覆盖（一般不需要动）：`MYAPI_UPSTREAM_BASE`、`MYAPI_MODELS_BASE`、`MYAPI_WORKSPACE_BASE`、`MYAPI_STUDIO_VERSION`、`MYAPI_CLIENT_TYPE`。

## 客户端接入

| 客户端 | 配置 |
|---|---|
| OpenAI SDK / NewAPI | Base URL `http://127.0.0.1:8787/v1`，Key `sk-myapi-…` |
| Claude Code / Anthropic SDK | `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`，Key `sk-myapi-…` |
| Codex | `model_providers.myapi.base_url = "http://127.0.0.1:8787/v1"` |

注意：浏览器页面用 `fetch` 直连会被跨源预检拒绝 —— 网关默认不应答 CORS。两种解法：①
设置页打开「跨域来源」白名单；② 页面与网关同源（本地静态托管页面并把 `/v1` 反代到
`127.0.0.1:8787`）。

## 安全须知

- 默认只绑 `127.0.0.1`。要局域网访问用 `--lan` 或 Docker 映射，并**务必设置强面板密码**。
- 账号凭证以 AES-256-GCM 加密落盘，AAD 绑定账号 ID；API Key 只存 HMAC。
- 日志只含元数据，不记录对话内容、token 或 Cookie。
- 控制台写操作要求同源 + `x-myapi-csrf` 头。
- 上游响应一律视为不可信：限制体积、逐块流式、字段校验、失败降级。

## 免责声明

本项目仅用于个人学习与研究，驱动使用者**自己的**账号。本项目的调用不进入上游客户端的
turn 计费链路，这不等于免费 —— 上游 token 照常消耗。上游都是客户端私有接口，可能随版本
变化；本项目按「上次成功快照」降级，不承诺长期兼容。

请遵守各上游服务的使用条款；因使用本项目产生的账号限制、额度变化、服务中断等后果由
使用者自行承担。本项目与各上游厂商及其官方产品均无关联，文中出现的名称仅用于描述兼容
关系，商标权利归各自所有。

完整条款见 [LICENSE](LICENSE)。

## 开发

```bash
bun run dev            # 开发模式（服务 + 前端一起热重载）
bun run typecheck      # 前后端类型检查
bun run test           # vitest
bun run build          # tsdown + vite build
bun run check          # typecheck + test + build，提交前必跑
```

代码约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，给 AI 的须知见 [AGENTS.md](AGENTS.md)。

## 许可

[MIT](LICENSE) 正文之上附有**使用声明**，追加了「禁止商业用途、禁止二次分发牟利、禁止批量
账号运营」的限制。两者对同一行为给出不同结论时以更严格的一方为准。

## 致谢

本项目的控制台视觉与工程骨架沿用作者的另一个项目
[astudio2api](https://github.com/zhuchunshu/astudio2api)，多提供商账号管理的产品形态参考了
[agent2api](https://github.com/aimod-cc/agent2api)。感谢两者的作者。
