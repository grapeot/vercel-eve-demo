# Teardown Runbook

删除单个 deployment、登出 Workbench 或清空浏览器 cookie 都不等于数据销毁。本 runbook 区分产品数据、runtime/platform 资源和上游 credential；操作不可恢复。

## Product Data

- Workbench 的 `Delete current` 会 hard-delete 对应 Turso run、request、events、artifacts、feedback 和 usage。它不会物理删除 Eve durable workflow history，也不能立刻终止已经进入的 Eve 0.24.4 model turn。
- `DELETE /api/codex/status` 会删除 Turso 中 owner 的加密 Codex access/refresh token。它不会声称调用上游 revoke endpoint；本项目使用的 compatibility transport 没有受支持的第三方 revoke contract。
- `DELETE /api/owner/data` 需要 authenticated owner cookie 和 JSON `{"confirmation":"PURGE OWNER DATA"}`。成功后清空所有产品表并注销当前 cookie。
- 无浏览器时可运行 `npm run teardown -- --owner-data --confirm="PURGE OWNER DATA"`。它只清空当前 `.env.local` 指向的 database，不删除 Vercel 或 Turso 资源。

## Platform Teardown

先删除 Vercel project，阻止 deployment 在清理期间继续写入；再删除 Turso database，使 database auth token 随 database 失效。脚本不会删除可能由其他应用共享的 Turso group。

```bash
VERCEL_TOKEN=replace-with-temporary-token \
VERCEL_PROJECT_ID=replace-with-project-id-or-name \
VERCEL_TEAM_ID=replace-with-team-id \
TURSO_PLATFORM_TOKEN=replace-with-temporary-token \
TURSO_ORGANIZATION=replace-with-organization \
TURSO_DATABASE_NAME=replace-with-database-name \
npm run teardown -- --platform \
  --confirm="DELETE replace-with-project-id-or-name AND replace-with-organization/replace-with-database-name"
```

Vercel 删除失败时脚本不会继续删除 Turso。Vercel 删除成功但 Turso 删除失败时，应使用 Turso dashboard/API 完成 database 删除；不要重新部署已删除的 project 指向残留 database。

## Provider Checks

平台脚本完成后仍需人工确认：

- 在 Tavily 控制台 revoke/rotate demo 使用的 API key；删除 Vercel env 只删除 key 的副本，不会让 provider key 失效。
- 在 OpenAI/ChatGPT 的 account security 页面撤销相关 session 或授权（如果上游 UI 提供）。本项目只能删除本地 token，不能保证上游 grant 被撤销。
- 删除临时 `VERCEL_TOKEN` 和 `TURSO_PLATFORM_TOKEN`，并检查 Vercel project/deployments/env、Turso database/tokens 均不再存在。
- 检查本地 Git-ignored `.env.local`、`.vercel/`、`.eve/` 和临时数据库。使用可恢复的系统 trash 或安全的 secret-management 流程处理本地文件，不把 secret 写入 shell history 或 Git。
- Vercel project 删除是当前对其托管 Eve runtime 的 teardown 边界，但 Eve 0.24.4 未提供独立的 durable workflow physical-erasure API；不要对 workflow history 作超出平台保证的删除承诺。
