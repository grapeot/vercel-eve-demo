# 测试策略

## 默认离线测试

`npm test` 不读取真实 `.env`，不访问网络，不创建 Vercel project。

覆盖：

- runtime config 默认 mock 与 live fail-closed。
- Turso schema 幂等迁移、access session、credential CAS、run event、artifact revision 和 feedback anchor。
- AES-256-GCM credential envelope 的 context binding、篡改拒绝和错误 key 拒绝。
- challenge constant-time comparison、signed cookie expiry/tamper、IPv4/IPv6 CIDR 和 Vercel trusted IP header。
- Codex PKCE/device request schema、account metadata extraction、encrypted token persistence、distributed refresh lease/CAS 和 private Responses transport header/endpoint boundary。
- Tavily CLI envelope normalization、错误脱敏。
- usage credits 与美元估算。
- Skill Bundle manifest 与 lockfile 生成。
- deep-research skill 的必要 contract。

## eve Session Smoke

`npm run test:eve` 启动 `eve dev --no-ui`，等待 health，创建 mock session，读取 NDJSON stream，看到 `session.waiting` 后退出。它验证真实 eve compiler、session route、mock model、tool call 和 stream，不调用模型或 Tavily。

## Build

`npm run build` 先执行 `eve build`，再执行 `next build`。两步都必须在没有 credential 时成功。

`npm run test:web` 使用临时本地 libSQL database 和独立 Next dist directory 启动 Next dev server。它先验证未授权请求进入统一 challenge gate、错误 challenge 返回 401、正确 challenge 签发 cookie，再检查首页、`/api/health` 和 Next 到 Eve 的 `/eve/v1/info` rewrite。测试结束删除临时 database，不读取 `.env.local`。

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

测试使用 mock model 触发一次 Sandbox `web_search`，验证固定 Tavily CLI、credential transport、结果 schema 与 usage，不调用付费模型。它会消耗 Tavily credits；首次运行还会建立 Sandbox template。

模型 live smoke 通过浏览器、curl 或 `npm run test:eve:live` 执行。验收：能加载 baked-in skill、调用 authored `web_search` override、返回 Tavily来源，并在 run metadata 中看到 token/tool timing。

也可显式运行 `npm run test:eve:live`。它要求 `RUN_LIVE_EVE_SMOKE=1`（由 npm script 设置）、`EVE_DEMO_MODE=live`、`SEARCH_BACKEND=tavily`、`ALLOW_LIVE_API=1` 和两个 credential；测试有 120 秒硬超时，且不属于默认 CI。

## Public 检查

`npm run check:public` 扫描 tracked candidate files中的私有路径、vault reference、token pattern和误提交 `.env`。自动检查不能替代人工 diff review。

## 完整验收

```bash
npm run verify
npm run test:eve
npm run test:web
```

live test 保持 opt-in，不属于默认 CI。
