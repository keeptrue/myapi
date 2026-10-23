# TASK — 实施清单

## 阶段状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 脚手架、品牌改名、LICENSE、README、AGENTS/CONTRIBUTING | done |
| M1 | provider adapter 接口 + registry + 账号模型 v2 + 加密改造 + 迁移器 + AStudio 迁移 + 统一目录 | done |
| M2 | 网关跨提供商路由、Key 绑定提供商范围、`owned_by` | done |
| M3 | 四路账号接入：短信+GeeTest、粘贴、导入、OAuth 回调 + 降级粘贴 | done |
| M4 | Qoder adapter（登录 → 目录 → 对话 → 余额 → 签到 → 权益） | pending |
| M5 | 面板鉴权改注册管理员 + 改密 + 环境变量预置 | pending |
| M6 | 调度器多提供商化 + benefitSnapshot 归一化 + Benefits 通用渲染 | pending |
| M7 | 八页 UI：提供商列、动态能力菜单、按提供商选添加方式、优先级排序 | pending |
| M8 | Docker / compose / 启动脚本 / smoke / CI / GHCR / 中英 README / docs | pending |

## M0 已完成

- 从 `astudio2api` 复制整份代码，剔除 `.git` / `node_modules` / `dist` / `data` / `.env`。
- `git init` + 远端 `https://github.com/zhuchunshu/myapi.git`，分支 `main`。
- 全量改名：`ASTUDIO_*` → `MYAPI_*`、`astudio2api` → `myapi`、`AStudio2API` → `myapi`、
  `8777` → `8787`、`x-astudio-csrf` → `x-myapi-csrf`、`astudio-theme` → `myapi-theme`、
  `astudio:unauthorized` → `myapi:unauthorized`、`astudio_panel` → `myapi_panel`、
  `sk-ast-` → `sk-myapi-`、加密 pepper 与 AAD 域、logger 名、favicon 改为 M 标。
- 测试里的硬编码前缀改为引用 `API_KEY_PREFIX` 常量。
- LICENSE 改为 MIT 正文 + 使用声明（禁商用 / 禁二次分发牟利 / 禁批量账号运营）。
- README 中英、AGENTS.md、CONTRIBUTING.md 按 myapi 重写，AGENTS.md 补入 provider adapter 架构约束。
- `bun run check` 全绿：14 个测试文件 69 个用例通过，tsdown + vite build 成功。

## M1 要做

1. `src/server/providers/types.ts` —— `ProviderAdapter` 接口、`ProviderCapabilities` 能力位、
   `AccountDraft` / `WebLoginSession` / `BalanceSnapshot` / `CheckinResult` / `ClaimResult` /
   `BenefitSnapshot` / `CredentialDescriptor` / `ModelRecord` 等通用结构。
2. `src/server/providers/registry.ts` —— providerId → adapter 注册表。
3. `store/schema.ts` —— `StoredAccount` 重构为公共层 + adapter 私有层（`credentialsEnc` 整体
   密文 blob，AAD 绑定 `accountId + providerId`；`profile` 明文非敏感状态）。`schemaVersion: 2`。
4. `crypto/secretbox.ts` —— AAD 域从 `myapi:<owner>:<field>` 改为 `myapi:<accountId>:<providerId>:creds`。
5. 迁移器 —— `schemaVersion: 1 → 2`，把 astudio2api 的 `tokenEnc / ssoSessionEnc / modelBearerEnc`
   三个密文字段打包重新加密，AStudio 专属数值字段搬进 `profile`。迁移前备份到 `data/backups/`。
6. `src/server/providers/astudio/*` —— 由 `src/server/astron/*` 迁移，AStudio 成为第一个 adapter。
7. `src/server/providers/catalog.ts` —— 统一目录，取代 `astron/catalog.ts`。同名模型聚合到
   `MergedModel.providers[]`，不去重丢弃。
8. 测试 —— adapter 契约、AAD 跨提供商挪用必须失败、目录合并与同名聚合、迁移往返。

## 验收（v0.1.0）

1. `bun run build && ./start.sh`，浏览器登录面板；
2. 短信 + GeeTest 添加真实 AStudio 账号，确认积分/会员出现；
3. 网页登录添加真实 Qoder 账号，确认回调自动接住、目录拉到；
4. 创建 API Key（指定允许的提供商），`curl /v1/models` 返回集合与 Key 范围一致；
5. `/v1/chat/completions` 非流式 + 流式、`/v1/responses`、`/v1/messages` 各一次；
6. 重启进程，账号/Key/统计/日志持久化，再发一条请求确认仍在轮换；
7. 两家各执行一次签到/领权益，结果按真实增量报告；
8. `bun run check` 全绿；
9. `docker compose up -d --build` 后重走第 2–7 步；
10. 打 `v0.1.0` tag，CI 与 GHCR Release 成功。

## 风险

- **M4 最高**：Qoder 的登录、Token 续期、模型目录、签到/权益接口目前没有任何公开资料，
  必须靠真实账号抓包/试错摸出来。缓解：M3 先用假 adapter 把 OAuth 回调机制端到端验证通，
  机制与具体提供商解耦，M4 卡住时 M3 成果不浪费。
- **「两家都做完整签到权益」会拉长工期**：Qoder 若确实没有签到机制，adapter 应如实声明
  `checkin: false`，面板显示「该提供商不支持」，而不是造假数据。
- GeeTest 与人机验证必须人工完成，不实现自动识别/绕过。
- 公开仓库：代码中不出现真实 token、Cookie、手机号；`data/`、`.env` 进 `.gitignore`；
  README 示例用虚构值。

## 后续可选

- 从 astudio2api 的 `data/state.json` 一键迁移已有账号（M1 迁移器落地后提供 CLI 入口）；
- 按 Key 的更细粒度限流/配额；
- 日志归档与外部存储；
- 前端英文词典；
- 更多提供商 adapter。
