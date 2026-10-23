# AGENTS.md — 给 AI / 智能体的须知

处理本仓库的代码、测试、提交、发布任务前：

1. 先读 `CONTRIBUTING.md` 与 `docs/ARCHITECTURE.md`；
2. 修改后必须跑 `bun run check`（typecheck + vitest + build），涉及真实链路再跑 `scripts/smoke.mjs`；
3. 不提交 `data/`、`.env`、真实 token、日志、`dist/`；
4. 不实现验证码自动识别/绕过；GeeTest 必须由人在浏览器完成；
5. 浏览器操作只用本机约定的 `ego_*` 工具，不引入 Playwright / Puppeteer；
6. 上游是私有接口：新增行为要有降级与错误路径，不要把猜测写成事实；
7. 提交格式遵循 `CONTRIBUTING.md`，一个提交只做一件事。

## 架构约束

- **provider adapter 是唯一的扩展点**。新增提供商 = 在 `src/server/providers/<id>/` 下实现
  `ProviderAdapter` 并在 `registry.ts` 注册。**不要**把任何提供商的字段写进网关层
  （`gateway/*`、`store/schema.ts` 的公共字段、`shared/types.ts` 的公共类型）。
- 提供商私有数据放 `StoredAccount.credentialsEnc`（密文）与 `StoredAccount.profile`（明文非敏感状态）。
  网关只读公共运行态，不解释 adapter 私有字段。
- 能力位（签到、余额、续期、目录刷新）必须由 adapter 自己声明。不支持就如实返回
  `capabilities.xxx = false`，面板显示「该提供商不支持」，**不要造默认值或假数据**。
- 模型名不加提供商前缀。同名冲突按「Key 提供商范围 → 提供商优先级 → providerId 字典序」
  确定性 tie-break，并在响应头 `x-myapi-provider` 回带实际命中方。不猜、不静默。

本项目与任何上游厂商无关联；只驱动使用者自己的账号，仅供个人学习与研究。
