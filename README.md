# Eve Personal Research Workbench

这是一个中文、owner-only、mock-first 的 Personal Research Workbench。浏览器提交研究任务，Eve 在隔离 Sandbox 中执行工作流，可信 app runtime 负责 Codex subscription OAuth、Tavily API 和 Turso persistence，最终交付可检查、可下载、可继续反馈的 Markdown artifacts。

默认模式不调用模型或 Tavily。live 模式必须同时通过显式开关和 owner OAuth，避免仅因环境中存在 credential 就触发付费调用。

> [!WARNING]
> 这是个人实验性质的 reference implementation，不是 production service、multi-user SaaS 或可安全一键部署的模板。Codex compatibility path 使用 OpenAI 未承诺为第三方 hosted Web app 提供的 public client identity 与 Responses transport；本项目不代表 OpenAI、OpenCode 或 Vercel，也未获得其认可。该路径可能无预告失效，并可能带来账号、条款与数据处理风险。它默认关闭，只应由理解这些边界的单个 owner 在短期受控环境中显式启用；不要把它扩展给第二个用户或作为商业认证方案。

## Reference Implementation Status

- 目标是展示 Eve harness、typed runtime capabilities、durable event projection、artifact checkpoint 和 owner-only experimental Codex adapter 如何组合，不提供 SLA、兼容性或生产安全保证。
- `CODEX_EXPERIMENT_ENABLED=0` 是默认值。Fork 必须主动 opt in，且不能在 Codex transport 失效时绕过限制或回退到项目方 credential。
- 公开源码不意味着 private Codex endpoint 或 public client identity 构成稳定、受支持的第三方 OAuth contract。正式产品应替换为 OpenAI 官方提供的 API 或 OAuth contract。
- 当前实现及已知限制按原样提供。部署者负责核对上游服务条款、数据保留、账号风险、费用和所在地区的合规要求。

## 产品边界

```text
Owner browser
  -> IP + challenge cookie + Turso access session
  -> Next.js Workbench (runs, timeline, artifacts, feedback)
  -> Eve root/child sessions + isolated Sandbox
  -> app-runtime typed tools
       -> Tavily REST search/extract
       -> Turso immutable artifact revisions
  -> owner Codex subscription OAuth transport
```

Workbench 提供三栏界面：历史 run 与约束、normalized Eve timeline、Markdown source/sanitized preview。每个 run 绑定唯一 Eve root session；event projector 丢弃 reasoning、脱敏 credential 字段，并只保存搜索来源和 extract 长度等审计信息。成功工作流必须在 Sandbox 写入 `report.md`，再由 `publish_artifacts` checkpoint 到 Turso。

这不是多用户 SaaS，也不应被包装成 reusable production template。临时 Vercel evaluation 必须使用 WAF IP allowlist、challenge gate、Codex experiment kill switch，并按 teardown runbook 清除外部资源与持久化数据；只删除单个 deployment 不等于完成数据销毁。

## 环境要求

- Node.js 24、npm 11+
- 固定 `eve@0.24.4`
- owner access 所需的 Turso database
- live research 可选：Tavily key 和 ChatGPT/Codex subscription OAuth

## 本地启动

安装依赖并生成 private access config：

```bash
npm install
npm run init:private-access
```

`init:private-access` 创建 mode `0600`、Git ignored 的 `.env.local`。随后使用自己的 Turso organization 与临时 platform token 初始化 database；platform token 不会写入文件：

```bash
TURSO_PLATFORM_TOKEN=replace-with-temporary-token \
TURSO_ORGANIZATION=replace-with-your-organization \
npm run init:turso
npm run db:migrate
```

启动后访问 `http://localhost:3000`，输入 `.env.local` 中的 `ACCESS_CHALLENGE_SECRET`。默认 mock model 会使用 deterministic `web_search` fixture，不调用外部服务：

```bash
npm run dev
```

如果 `.env.local` 已存在，不要重跑会拒绝覆盖文件的 `init:private-access`；按 `.env.example` 补齐缺失变量即可。

升级已有部署时先阻止新 run，再执行 `npm run db:migrate`，确认成功后部署新代码。Schema v5 增加预算 reservation，v6 增加已删除 Eve session 的迟到事件 tombstone，v7 会保守地取消升级时仍为 queued/running/waiting 的 run，避免它们带着迁移前无法重建的 usage 穿越新预算边界。不要先部署依赖新列的代码再迁移，也不要修改已经发布并记录的 migration。

## 启用 Live Research

Tavily 由 `agent/tools/web_search.ts` 与 `web_extract.ts` 在可信 app runtime 直接调用。key 不进入浏览器、prompt、Sandbox 或 tool output：

```bash
TAVILY_API_KEY=replace-with-your-real-key npm run configure:tavily
npm run enable:codex-experiment
```

在 `.env.local` 中显式设置：

```dotenv
EVE_DEMO_MODE=live
SEARCH_BACKEND=tavily
ALLOW_LIVE_API=1
CODEX_EXPERIMENT_ENABLED=1
CODEX_MODEL=gpt-5.6-sol
```

重新启动 `npm run dev`，通过 Workbench 的 Codex 按钮完成 owner OAuth。localhost 使用 browser PKCE callback；部署环境使用 device flow。该 transport 是 owner-only compatibility experiment，不接受 OpenAI API key，也不应扩展为多用户 auth contract。

`RESEARCH_MAX_SEARCHES` 限制每个 run 的付费 Tavily operation 总数（search 与 extract 合计），`RESEARCH_BUDGET_USD` 限制其预留费用。两项都由 Turso 在调用供应商前原子执行；child session 与 continuation 共用 root run 的 ledger，失败调用不退还 reservation。

## Skill Bundle

`agent/skills/` vendor 三个 progressive-disclosure roots：

- `deep-research`：来源分层、研究分解、artifact contract 和并行 child guidance。
- `tavily`：search/extract contract 与来源审计。
- `external-writing`：GPT-5.6 Sol 顺序三遍成文和独立 QA。

`npm run bundle` 生成 `skills/skills.lock.json`，记录 14 个 skill/reference 文件的 hash。Skill Bundle 只提供指令；credential 和网络能力始终留在可信 runtime。

## 验证

```bash
npm run verify
npm run test:eve
npm run test:web
```

- `npm test`：安全配置、Turso repositories、OAuth、Tavily、event projection、artifact revisions 和 Skill Bundle。
- `npm run test:eve`：真实 Eve compiler/session/tool/stream 的离线 mock smoke。
- `npm run test:web`：独立 Eve + Next + 临时 libSQL，覆盖 challenge gate、run/session mapping、event redaction 和 manifest。
- `npm run build`：Eve Nitro build + Next production build。
- `npm run test:live`：显式付费的 Tavily search/extract smoke。
- `npm run check:public`：public-repo privacy scan。

默认测试不读取真实 `.env.local`、不访问 OpenAI/Tavily，也不创建 Vercel project。完整策略见 [`docs/test.md`](docs/test.md)，架构与风险边界见 [`docs/rfc.md`](docs/rfc.md)。

删除 run、Codex credential、owner database 以及 Vercel/Turso 外部资源是不同操作。停止实验时按 [`docs/teardown.md`](docs/teardown.md) 执行，不要把删除 deployment 当作完整数据销毁。

## Security Notes

- `.env.local` 必须保持 `0600` 且 Git ignored；不要添加 `NEXT_PUBLIC_` credential。
- OAuth token 使用 AES-256-GCM envelope 存储，refresh 使用 Turso lease 与 credential-version CAS。
- proxy 对页面、API 和 Eve rewrite 使用同一 owner gate；所有 run/artifact API 再校验 access-session ownership。
- 当前 run history 按 8 小时 access session 分区。Cookie 过期、logout 或重新 challenge 后，旧 run 仍留在 Turso，但不会出现在新 session 的 Workbench UI；这不是稳定 owner archive，清理时仍须执行 owner-wide purge。
- artifact 是 immutable revision；feedback 绑定 `sha256` content hash，旧 revision 不能被静默覆盖。
- Next `16.2.6` 的传递依赖仍受 `GHSA-qx2v-qp2m-jg93` 影响。不要使用会破坏性降级 Next 的 `npm audit fix --force`。

## License

MIT
