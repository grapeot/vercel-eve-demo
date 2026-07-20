# 测试策略

## 默认离线测试

`npm test` 不读取真实 `.env`，不访问网络，不创建 Vercel project。

覆盖：

- runtime config 默认 mock 与 live fail-closed。
- Turso schema 幂等迁移、access session、credential CAS、run event、artifact revision 和 feedback anchor。
- AES-256-GCM credential envelope 的 context binding、篡改拒绝和错误 key 拒绝。
- challenge constant-time comparison、signed cookie expiry/tamper、IPv4/IPv6 CIDR 和 Vercel trusted IP header。
- Codex PKCE/device request schema、account metadata extraction、encrypted token persistence、distributed refresh lease/CAS 和 private Responses transport header/endpoint boundary。
- Tavily app-runtime search/extract request contract、response normalization、usage 和错误脱敏。
- usage credits 与美元估算。
- trusted runtime time 的 UTC、IANA timezone 和无效 timezone 拒绝。
- Skill Bundle manifest 与 lockfile 生成。
- deep-research skill 的必要 contract。
- Eve event projector 的 reasoning drop、credential redaction、Tavily output minimization 和 run status mapping。
- owner-scoped run/session mapping、runtime hook event fingerprint 幂等写入、并发 run-global cursor、terminal-absorbing 状态、immutable artifact parent revision 与 hash-anchored feedback。

## eve Session Smoke

`npm run test:eve` 创建临时 libSQL 和 queued product run，启动 `eve dev --no-ui`，创建 mock session并读取 NDJSON stream。看到 `session.waiting` 后，它断言 authored root hook 已绑定 Eve session、将 run 推进到 `waiting` 并持久化非空 timeline。它验证真实 eve compiler、hook runtime、session route、mock model、tool call 和 stream，不调用模型或 Tavily。测试结束按 `sessionId` label stop/remove 自己创建的 Microsandbox VM，避免 smoke 子进程退出后留下 detached runtime。

## Build

`npm run build` 先执行 `eve build`，再执行 `next build`。两步都必须在没有 credential 时成功。

`npm run test:web` 使用临时本地 libSQL database、独立 Eve app copy 和独立 Next dist directory。它验证统一 challenge gate、cookie、首页与 health；检查 Eve manifest 中三个 static skills、`current_time`、typed Tavily tools、`publish_artifacts` 和禁用的 `bash`；再创建 owner run、绑定 Eve session，并断言浏览器 event POST 返回 `405`、只读 timeline 不泄漏 credential/continuation token。最后验证 run hard-delete、Codex local disconnect、owner purge 精确确认以及 purge 后旧 cookie 失效。测试结束删除全部临时数据，不读取 `.env.local`。

## Turso Migration

`npm run db:migrate` 显式读取 gitignored `.env.local`，幂等迁移真实开发数据库。默认离线测试只使用内存 libSQL，不访问 Turso。

Codex 默认测试全部使用合成 JWT 和 fake fetch，不联系 OpenAI。真实 browser PKCE/device flow 与 subscription inference 必须显式设置 `CODEX_EXPERIMENT_ENABLED=1`，并由 owner 在 OpenAI 页面完成授权。

## Live Test

`npm run test:live` 只有在以下变量同时存在时才执行一次 Tavily请求：

```text
RUN_LIVE_TESTS=1
ALLOW_LIVE_API=1
SEARCH_BACKEND=tavily
TAVILY_API_KEY=<real key>
```

测试直接调用与 Eve tool 相同的 TypeScript executor，依次执行一次 `web_search` 和一次 `web_extract`，验证 Tavily REST credential boundary、结果 schema 与 usage，不调用模型。它会消耗少量 Tavily credits，但不创建 Sandbox 或向 Sandbox 注入 credential。

模型 live acceptance 以 Workbench 浏览器流程为准。验收：完成 owner Codex OAuth；创建 product run 并绑定 Eve root session；加载完整 Skill Bundle；调用 authored `web_search` / `web_extract`；写入并 checkpoint `report.md`；页面显示 normalized timeline、sanitized preview、source、download 与 content hash；对当前 hash 提交 feedback 后能续写同一 session 并生成 parent-linked revision。

旧的 direct Eve + AI Gateway live smoke 已删除：它无法携带 Workbench owner principal，也不符合 Codex subscription-only 边界。模型 live acceptance 必须从通过 challenge gate 的 Workbench 发起，确保 OAuth credential、run ownership、event projection 和 artifact persistence 在同一 access session 中被验证。

## Public 检查

`npm run check:public` 扫描 tracked candidate files中的私有路径、vault reference、token pattern和误提交 `.env`。自动检查不能替代人工 diff review。

## 完整验收

```bash
npm run verify
npm run test:eve
npm run test:web
```

Node 不是 24 时，在本地使用 `npx --yes --package=node@24 --call 'npm run verify'`。live test 和 owner browser OAuth acceptance 保持 opt-in，不属于默认 CI。
