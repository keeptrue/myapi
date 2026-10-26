# 贡献指南

## 本地门禁

提交前必须全部通过：

```bash
bun install --frozen-lockfile
bun run check        # typecheck + vitest + build
```

涉及真实链路的改动，还要：

```bash
MYAPI_API_KEY=sk-myapi-… node scripts/smoke.mjs
```

浏览器验证按本机约定使用 `ego_*` 工具，不引入 Playwright / Puppeteer / Selenium。

## 提交规范

- 标题：`<type>(<scope>): 中文摘要 / english summary`
- type：`feat` / `fix` / `perf` / `test` / `docs` / `refactor` / `chore`
- 一个提交只做一件事；不要在同一个提交里混重构、功能与格式化。
- 不要 amend 已推送的提交；不要强推 main。
- 不提交 `data/`、`.env`、真实 token、日志、`dist/`。

## 代码约定

- TypeScript strict；服务端避免 `any`；共享类型放 `src/shared/`。
- 所有上游响应视为不可信：限制大小、校验字段、失败降级。
- 新增上游行为必须有单元测试或路由测试；流式转换要有合成 SSE fixture。
- 新增管理面写接口必须走面板会话 + `x-myapi-csrf` 校验。
- 任何日志/错误信息不得包含 token、Cookie、手机号全量；证件脱敏。
- 前端文案集中在组件内；保持中文为主，术语与 API 字段用原文。
- 扩展新提供商只写 adapter：字段进 `credentialsEnc` / `profile`，能力位如实声明，
  不往网关层与公共类型里塞提供商私有字段（详见 `AGENTS.md` 的架构约束）。

## PR 自查

1. 变更动机与影响面；
2. 做了哪些具体改动（字段、默认值、开关、边界）；
3. 跑过的命令与结果；
4. 回滚方式；
5. 是否涉及凭据、数据迁移或上游协议变化。

## 发布

- tag `v*` 必须与 `package.json` 版本一致；
- Release 工作流会跑全量 check、推送 `ghcr.io/keeptrue/myapi` 镜像并创建 GitHub Release；
- 发版前确认 `data/` 未被提交、README 的版本/端口与实际一致。
