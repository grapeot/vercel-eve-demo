# Vercel Eve 深度调研 Demo

这是一个中文、mock-first 的 Vercel eve Web Demo。它验证两件事：Markdown skill 可以脱离特定 Agent harness 被按需加载；独立 CLI/API capability 可以通过薄 adapter 接入 eve，而不把 credential 暴露给浏览器或模型上下文。

默认模式不调用模型、不调用 Tavily、不需要 Vercel账号。切换 live 必须显式开启，避免本地或公开 Preview 因为环境里碰巧存在 key 就产生费用。

## 产品形态

用户从 Next.js 网页提交研究问题。eve 创建 durable session，加载 baked-in 的 `deep-research` Markdown skill，调用由 Tavily CLI 覆盖的 `web_search` tool，并把报告流式返回网页。

```text
Browser
  -> Next.js + useEveAgent
  -> eve session / Workflow
  -> deep-research Markdown skill
  -> web_search override
  -> Eve Sandbox 中的 tavily-skill CLI
  -> mock fixture 或 Tavily API
```

eve 同时暴露原生 API：

```http
POST /eve/v1/session
GET  /eve/v1/session/:sessionId/stream
POST /eve/v1/session/:sessionId
```

## 环境要求

- Node.js 24
- npm 11+
- live 模式可选：Vercel账号、AI Gateway 和 Tavily key

项目固定 `eve@0.24.4`。eve 仍处于 beta，升级时先阅读 changelog并运行完整验证。

## 本地 Mock

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。默认 mock model 会调用 mock `web_search` override，生成一份确定性报告，不启动付费搜索。

完整离线验证：

```bash
npm run verify
npm run test:eve
npm run test:web
```

`test:eve` 会启动真实 eve dev server、创建 session、读取 NDJSON stream，确认 tool call 和 `session.waiting` 后退出。

## 注入 Tavily Credential

### 本地

创建 gitignored `.env.local`：

```dotenv
EVE_DEMO_MODE=live
SEARCH_BACKEND=tavily
ALLOW_LIVE_API=1
EVE_MODEL=openai/gpt-5.4-mini
RESEARCH_BUDGET_USD=2
RESEARCH_MAX_SEARCHES=10
TAVILY_API_KEY=replace-with-your-real-key
TAVILY_PROJECT=replace-with-your-project-id
```

再运行：

```bash
npm run dev
```

`TAVILY_API_KEY` 不进入浏览器、prompt 或 tool output。Vercel Sandbox 通过 firewall credential brokering 注入请求 header；本地单用户 Docker smoke 将 key 作为 container env 注入，因此项目禁用了模型可见的 built-in `bash`。不要添加 `NEXT_PUBLIC_` 前缀。

### 从 1Password 注入本地进程

使用你自己的 secret reference 文件，不把 vault path 写进本 repo：

```dotenv
TAVILY_API_KEY=op://your-vault/your-item/your-field
```

然后让 `op run --env-file=<your-secret-reference-file> -- npm run dev` 只向目标进程注入。仍需通过普通环境变量设置 `EVE_DEMO_MODE=live`、`SEARCH_BACKEND=tavily` 和 `ALLOW_LIVE_API=1`。

### Vercel Preview / Production

1. 在 Vercel Project Settings 分别为 Preview 和 Production 添加上述变量。
2. 将 `TAVILY_API_KEY` 标记为 Sensitive。
3. Preview 和 Production 最好使用不同 key 或不同 Tavily Project ID。
4. 保存后重新部署；环境变量不会追溯应用到旧 deployment。
5. 设置 Spend Management、Tavily quota 和应用预算。

模型调用在 Vercel部署上优先使用自动 OIDC，不需要把 provider key放进 repo。

## Production Auth

默认 `EVE_AUTH_MODE=placeholder`。它允许 localhost 开发和 Vercel OIDC 内部调用，但在 Vercel Production 中拒绝普通浏览器请求。

内部单用户测试可以临时使用 HTTP Basic：

```dotenv
EVE_AUTH_MODE=basic
EVE_AUTH_USERNAME=replace-with-your-username
EVE_AUTH_PASSWORD=replace-with-your-password
```

固定密码不能在浏览器中真正保密，不适合公开多用户产品。正式公开前应接入 Auth.js、Clerk 或自己的 OIDC，并为每个用户返回稳定 principal ID，再校验 session ownership、rate limit 和预算。

## Live Test

默认测试不会读取 key。真实 Tavily smoke test 会消耗至少 1 credit：

```bash
RUN_LIVE_TESTS=1 \
ALLOW_LIVE_API=1 \
SEARCH_BACKEND=tavily \
TAVILY_API_KEY=replace-with-your-real-key \
npm run test:live
```

模型 live test 从网页提交，或使用 eve API：

```bash
curl -X POST http://127.0.0.1:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"调研 Vercel eve 的状态模型，并附来源。"}'
```

返回 `sessionId` 与 `continuationToken` 后读取：

```bash
curl http://127.0.0.1:3000/eve/v1/session/<sessionId>/stream
```

stream 到 `session.waiting` 后仍可能保持连接，这不是失败。

## Skill Bundle

`skills/bundle.json` 登记两个固定 source：

- DOC：Context Infrastructure 的 deep research workflow。
- REPO：standalone `tavily-skill`。

运行：

```bash
npm run bundle
```

它生成 `skills/skills.lock.json`，记录 source commit、root skill、安装 contract、credential 与本地 skill hash。`sandbox/Dockerfile` 展示如何把同一 Tavily CLI 安装进 Linux image，证明它不依赖 OpenCode。

运行时的 `agent/tools/web_search.ts` 覆盖 eve provider-managed `web_search`，通过 `ctx.getSandbox()` 调用固定 commit 的 `tavily-skill` CLI。输入先写成 JSON，再由固定 Python wrapper 使用 argv 调 CLI，避免把用户 query 拼进 shell。Vercel Sandbox 使用 firewall credential brokering；本地 Docker 只用于单用户开发，并关闭模型的 `bash` 工具。

## 测试层次

- `npm test`：配置、搜索 adapter、usage 和 skill contract。
- `npm run test:eve`：真实 eve session/tool/stream，离线 mock。
- `npm run test:web`：Next 首页、health API 与 Eve rewrite smoke。
- `npm run build`：eve Nitro build + Next production build。
- `npm run test:live`：显式付费 Tavily smoke。
- `npm run check:public`：公开内容隐私扫描。

完整策略见 [`docs/test.md`](docs/test.md)，架构边界见 [`docs/rfc.md`](docs/rfc.md)。

## 安装到其他 Agent Workspace

这个 repo 的 root instructions 是 `agent/skills/deep-research/SKILL.md`。Codex、Claude Code、Cursor、OpenCode 或其他 coding agent 可以 clone/vendor 本 repo，读取 `AGENTS.md`，再把 root skill接入目标 workspace 的 skill discovery chain。私有路径、alias 与 credentials 留在目标 workspace overlay，不进入本 repo。

## License

MIT
