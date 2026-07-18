# Working Notes

## Changelog

### 2026-07-17

- 将 normalized timeline durability 从浏览器 React effect 移入 Eve authored hook：root stream event 在 durable accept 后完成 session mapping、脱敏投影、稳定 fingerprint、幂等 Turso 写入、run heartbeat 和 terminal-absorbing 状态迁移；浏览器现在只轮询 timeline，不再上传 `agent.events`。
- 修复 Artifact Preview 高度脱离容器的问题：viewer 改为 column flex，Preview、Source 和 empty state 填满 toolbar 之外的剩余空间；移动端只约束 viewer 外层，避免父子同时使用 `58vh`。
- 定位本地卡死 run 的故障边界并修复 smoke sandbox 泄漏：两个互不相关的 Microsandbox `0.5.10` VM（其中一个只执行 mock smoke）都出现 host `msb` vCPU 约 105%、guest metrics 完全静止、采样停在 Hypervisor `hv_trap` 的相同模式；`test:eve` 现在按 Eve `sessionId` label 精确 stop/remove 自己创建的 VM，并在强制终止 Eve 后等待进程真正退出。
- 修复 live dev server 使用旧 Eve runtime generation、以及 Eve 0.24.4 hook 收到未加 `meta.at` 的原始 accepted event 时，首个 session attach 后整条 inspector 断链：root hook 发现 session 尚未映射时，任意首个 durable event 都可在相同 owner principal 边界内补绑最新 queued run，不再只依赖一次性的 `session.started`；事件缺少 stream timestamp 时用 session turn + raw event hash 生成无原文、可 replay 去重的稳定 cursor。回归测试和真实 Eve smoke 覆盖从 unstamped `turn.started` 恢复 mapping、状态与 event persistence。
- 将 Codex credential 从 8 小时 challenge access session 提升为稳定 owner identity：schema v3 保留最新 active credential，首次 resolve 将旧 session AAD 密文 rewrap 为 owner AAD；OAuth attempt 仍绑定短期 session。服务重启、cookie 到期或重新 challenge 不再触发重复 Codex OAuth。
- 修复本地 live run 在 Docker daemon 不存在时重试失败并永久停在 `queued`：local Eve 改用无需 Docker daemon 的 microsandbox；若 session 建立前 `agent.send` 失败，则以条件更新将 unattached queued run 标记 `failed`，释放 single-active-run guard。
- QUESTION STARTERS 改为完整 decision question presets；新增“今天美国股市为什么大跌？”，自动填入美国股市 context、基础从业者 audience 和 1000-2000 字篇幅。

### 2026-07-16

- 修复 live run 永久停留 `queued` 的映射竞态：Eve 已启动 durable root session 时，server-side `step.started` 现在按已认证 owner 原子绑定唯一 queued Workbench run；浏览器 PATCH 仅作为幂等补充，页面刷新或 stream 生命周期不再让 product run 与 Eve session 脱钩。
- 完成真实 owner Codex + Tavily 产品验收：首轮 research 产生 248 个 Eve raw events，包含 4 次 search、1 次 extract、3 个 child stages 和 2 次 artifact checkpoints；normalized timeline 持久化 140 个 events，最终保留 7 个 latest artifacts。随后对当前 report hash 提交 feedback，同一 session 产生 60 个续写 events，并成功写入 2,272-byte、parent-linked 的新 `report.md` revision。
- live 验收发现并修复两项只会在 Codex subscription backend 暴露的兼容性：Responses 强制 `store=false`，同时通过 AI SDK middleware 请求并 replay `reasoning.encrypted_content`、移除不可复用的 persisted reasoning ID；`publish_artifacts` JSON Schema 删除 provider 不支持的 regex lookaround，并在 executor 内继续 fail-closed 拒绝 absolute/traversal path。
- 删除不再符合架构的 direct Eve + AI Gateway live smoke。live 模型验收现在必须经 owner challenge access session、Codex OAuth、Workbench run mapping 和 artifact persistence 完整执行，避免用无法携带 owner principal 的旧脚本制造假阳性。
- 完成 Personal Research Workbench 产品层：三栏 UI 支持 run history、研究约束、normalized Eve timeline、artifact tree、Markdown source/sanitized preview/download、Codex connect 和 hash-anchored feedback continuation；页面刷新后可恢复最近 waiting session。
- 新增 owner-scoped run APIs：创建/list/detail、Eve root session attach、cancel、event batch ingest/query、artifact list/read/download/report 与 feedback；同一 owner access session 同时只允许一个 active run，跨 run/session mapping 冲突 fail closed。
- 新增 Eve event projector：reasoning event 不持久化，secret/credential/token 字段递归脱敏，Tavily search 只保留来源 metadata，extract 只保留 URL/content length，并把 skill、tool、subagent、file、usage、waiting/failure 状态映射为可检查 timeline。
- 新增 `publish_artifacts` typed tool：只接受安全的相对 Markdown path，从共享 Sandbox 读回文件并写入 Turso immutable revision；每版记录 SHA-256、parent artifact ID 和 size，agent contract 强制完成前 checkpoint `report.md`。
- Workbench 阶段验证通过：8 files / 33 tests；独立 Web smoke 覆盖 challenge、run/session attach、event projection/redaction、完整 Skill Bundle 与 publish tool manifest；Node 24 `npm run verify` 完成 Eve/Next production build 和 public-content scan。真实 owner Codex browser OAuth、report publish 与 feedback revision 仍是下一步 opt-in acceptance。
- 将 Tavily production transport 从 Sandbox CLI 完整迁移到 app-runtime TypeScript REST executor：`web_search` 强制 `include_answer=false` / `include_raw_content=false`，新增 `web_extract`，localhost/Vercel 复用相同 schema、normalization、redaction 和 usage contract；Sandbox 不再接触 Tavily key。
- 完整 vendor progressive Skill Bundle：3 个 root skills（deep-research、Tavily、external-writing）和 11 个 reference/voice files，覆盖来源分层、artifact contract、parallel children、search/extract、Thesis Catalog、自然中文 prose、report rubric 和 3 份 synthetic public-safe voice samples；lockfile 记录全部 14 个文件 hash。
- 使用 private `.env.local` 的 Tavily credential 完成真实 app-runtime search + extract smoke：2 个搜索来源、1 个正文提取，credential 未进入输出。默认测试现为 7 files / 30 tests；Web smoke 额外检查两个 typed tools 与三个 static skills。
- 完成 owner-only Codex OAuth foundation：localhost browser PKCE 使用 `localhost:1455` callback；Vercel-compatible device flow 每个 poll route 只请求一次并由 Turso `next_poll_at` 限速；attempt 中的 verifier/device ID 使用 AES-GCM 加密，浏览器只看到 user code、verification URL 和 opaque attempt ID。
- Turso schema 升级到 v2；OAuth token exchange/refresh 使用 Zod fail-closed validation，account ID 只从可信 token endpoint 返回的 JWT 中提取为 transport metadata，不将 token 放入 Eve/session/event/browser storage。
- Codex credential resolver 使用 Turso refresh lease + credential version CAS 处理多实例并发 rotation；private Responses fetch 只允许 `/responses` 请求，替换 SDK placeholder auth，注入 bearer/account ID 后路由到 Codex endpoint。
- Eve live model 改为 `defineDynamic` 的 `step.started` resolver，按 challenge access session 取 credential；fallback 是无网络、无 credential 的 failing model，不再使用 AI Gateway string。live Eve channel 只接受经过 IP/cookie/Turso 校验的 owner principal，mock mode 使用固定的 offline-only principal。
- 新增 `CODEX_EXPERIMENT_ENABLED` kill switch、OpenCode MIT notice 和 5 个 Codex-specific 单元测试；默认测试现为 7 files / 29 tests。真实 OpenAI OAuth/inference 仍保持 owner 手动 opt-in，不进入默认验证。
- 安全读取 1Password 中已有的 Turso Platform API token，创建 owner-only development database 与 Oregon primary group；database URL、database auth token 和新生成的 256-bit credential encryption key 只写入 mode `0600`、gitignored `.env.local`，Platform token 不落盘。
- 新增幂等 `init:turso` 与 `db:migrate`：Turso schema v1 覆盖 access session、OAuth attempt/credential、research request/run、normalized event、artifact revision、feedback anchor、Skill Bundle version 和 usage summary；真实开发数据库已完成迁移。
- 新增 typed repositories：access metadata 只保存 SHA-256 hash，OAuth refresh rotation 使用 credential version CAS，artifact revision immutable 并保留 parent/hash，event cursor 在 `(run_id, sequence)` 上唯一。
- 新增 AES-256-GCM credential envelope：每条密文使用随机 96-bit IV、authentication tag 和 context AAD；master key强制为 32 bytes，不进入数据库。
- 接通 owner challenge gate：Next proxy 对页面、API 和 Eve rewrite 统一检查可信 client IP、signed cookie 和 Turso revoke/status；challenge route 使用 constant-time comparison，签发 `HttpOnly` / `SameSite=Strict` cookie，失败统一返回 Access denied。
- Web smoke 改为临时 libSQL + 独立 Next dist directory，避免干扰正在运行的开发 server；覆盖 locked page、错误 challenge、正确 cookie、受保护首页、health 和 Eve rewrite。默认测试现为 6 files / 23 tests。
- 将产品重新定义为 owner-only Personal Research Workbench：localhost 为主要运行环境，临时 Vercel Pro deployment 通过 WAF IP allowlist + 256-bit challenge gate 保护；实际公网 IP 和 challenge secret 只进入 private config，不进入 repo。
- 重写 PRD/RFC：最终交付改为 Sandbox `report.md` + HTML preview，加入 root/child event inspector、workspace file browser、feedback continuation、Turso artifact checkpoint 和完整 progressive-disclosure Skill Bundle。
- 将 external-writing 的 app fork确定为 GPT-5.6 Sol 三遍成文：三个 sequential Eve built-in `agent` children 分别完成结构稿、自然重写和独立 QA；删除 Gemini/AGY、Antigravity 和 `gpt-image-2` 配图硬门槛。
- 核对 Eve subagent/event/sandbox 语义：built-in child 拥有 fresh history/state 并共享 root Sandbox；child 详细事件需按 `childSessionId` 单独订阅；Vercel persistent Sandbox 跨 turn snapshot/resume，但历史 report 与 feedback 快照仍同步到 Turso。
- 核对 Tavily runtime：推荐 authored typed tool 在可信 app runtime 直接调用 Tavily REST，localhost/Vercel 复用同一 TypeScript executor；不再把 key 注入 Sandbox env，也不让 CLI承担 Eve production transport。
- 核对 Codex OAuth：localhost 可基于 OpenCode reference 做 owner-only experimental integration；没有找到任意第三方 Vercel Web callback/private Codex backend 的公开 contract，因此先将 Vercel full subscription inference 标记为待产品决策。
- Owner 选择 Vercel 非官方 device flow 作为短期 personal evaluation 路径：RFC 增加 encrypted attempt/token、poll interval、Turso CAS refresh、kill switch、fail-closed 和部署后删除约束；不把这项风险接受推广到第二个用户。
- 新增 `init:private-access`：自动检测当前公网 IPv4，并把 `/32` allowlist、两个独立的 32-byte challenge/cookie secrets 写入 mode `0600` 的 gitignored `.env.local`；脚本不打印 secret，实际 IP 不进入公开文件。
- 修正 public scanner 对本地 secret 文件的判定：`.env*` 存在时必须被 Git ignore，而不是禁止开发机上存在；已验证 `.env.local` 权限为 `0600`、被 Git ignore，public scan 通过。
- 核对 Eve 0.24.4 的模型路由：string model 走 Vercel AI Gateway，`step.started` 返回 provider-authored `LanguageModel` 可直接调用 provider，适合从外部加密 secret store 按 verified principal 临时解析 per-user BYOK；live provider object 不进入 durable serialization。
- 核对 Superlinear Logto admin gate 与 OpenCode ChatGPT/Codex OAuth：推荐首版只支持用户 OpenAI API key，直接调用 OpenAI；不复用 OpenCode 的 localhost OAuth client、refresh token 和非公开 Codex transport，除非取得 OpenAI 对第三方 Web 服务的明确支持。
- 新增可复现的 Parallel Search vs Tavily 十题 benchmark 脚本。Parallel smoke 成功，但完整 benchmark 被 Vercel AI Gateway 免费层模型 rate limit 阻断；脚本现会逐题落盘并记录局部失败，不把 429 当成搜索质量结论。
- 完成 Context Infrastructure 在线服务化架构分析：将 filesystem 定位为 Agent 的统一工作界面、可检查投影视图和可退出格式，而不是账户、task、credential 与 workflow 的唯一真相源。
- 提出 `Portable Context Kernel + Native Runtime Shells` 目标架构，比较 Eve / Cloudflare native adapter 与 per-user OpenCode Cell 两条路线，并定义 Context Bundle、task envelope、credential broker、correction pipeline 和跨 harness conformance tests。
- 使用进程级 credential 注入完成 Tavily live smoke：1 个测试通过，真实 API 返回 source 与 usage；密钥未写入项目文件或测试输出。
- 新增显式 opt-in 的 `test:eve:live`，带双重 credential 检查、全部 live 安全门和 120 秒硬超时。
- 使用 AI Gateway 与 Tavily 的进程级 credential 注入完成 full Eve live smoke：真实模型调用 `search_web` 后正常到达 `session.waiting`；测试限制为最多 2 次搜索和 `$0.25` 应用预算。
- 将 provider-managed `web_search` 覆盖为 authored Tavily CLI tool；固定 CLI source commit，并通过 Sandbox template bootstrap 安装。
- 将 `deep-research` Markdown 保持为 baked-in static skill；`eve info` 只暴露 `web_search` authored tool 和 `deep-research` skill，built-in `bash` 已禁用。
- Tavily CLI-only smoke 与 AI Gateway + Tavily CLI full smoke 均通过；full session 为 `wrun_01KXNRNSQ992SB71FAVNK9XJTY`。
- 最终 `npm run verify`、mock Eve smoke、Web smoke 全部通过；Web smoke 额外断言 `web_search` 替换 framework tool、`deep-research` 可发现且 built-in `bash` 已禁用。

### 2026-07-15

- 建立 public-ready 独立项目骨架与中文 PRD、RFC、测试策略。
- 固定 Next.js、eve、React、TypeScript 和 Node 版本。
- 设计 mock-first、live fail-closed 的 deep research Demo。
- 完成 Next.js 中文前端、eve Agent、Markdown skill、Tavily adapter、usage 估算和 Skill Bundle lock。
- `npm run verify` 通过：lint、typecheck、4 个测试文件中的 12 个测试、eve/Next production build 和 public content scan 均成功。
- `npm run test:eve` 通过：真实创建 mock session，执行 `search_web` 并到达 `session.waiting`。
- `npm run test:web` 通过：首页、`/api/health` 和 Next 到 Eve 的 rewrite 均返回预期内容。
- 初始化独立本地 Git repository；按约束未 commit、push、创建 GitHub repo 或部署。

## Lessons Learned

- eve `0.24.4` 要求 Node 24；本机默认 Node 22 只能通过 Node 24 runner 执行安装和验证。
- eve mock model 必须显式提供 `modelContextWindowTokens`，否则 compaction compiler 无法启动。
- `withEve()` 在本地和 Vercel 都会维护独立 eve service；不能只验证 Next build。
- `placeholderAuth()` 在 Vercel Production 中主动拒绝请求，这是公开 Demo 的安全默认值。
- stream 到 `session.waiting` 后仍保持连接，smoke test 必须主动终止读取，不能把 timeout 当作 turn 失败。
- Microsandbox freeze 不能归因于研究 prompt 或 guest command：独立 mock smoke VM 只执行一次简单命令后也复现；冻结时 guest CPU、disk、memory 和 network counter 不再变化，host vCPU 线程停在 `hv_trap`，runtime relay 不再活动，`kernel.log` 没有 panic。证据将边界收窄到本地 Microsandbox runtime/Hypervisor 层，但不足以证明具体 Hypervisor 或 macOS 根因。
- Microsandbox `0.6.0`/`0.6.1` 包含 runtime wait 和 stale sandbox cleanup 相关改动，但当前 Eve `0.24.4` 只声明 `microsandbox ^0.5.0`，也没有上游证据证明 0.6.x 直接修复本次 `hv_trap` freeze。不要在主路径盲目跨 major；先在独立兼容性分支重跑 Eve build、smoke、长时间 idle 和 stop/restart soak test。
- Next `16.2.6` 当前传递依赖 `postcss <8.5.10`，`npm audit --omit=dev` 报告 `GHSA-qx2v-qp2m-jg93`（moderate）。npm 给出的 `--force` 修复会降级到不兼容的 Next `9.3.3`，因此不采用；等待 Next 发布非破坏性修复后再升级并重跑完整验证。
- microsandbox `0.5.10` 的 network transform 实测没有覆盖 Tavily SDK 已存在的 Authorization header，Tavily 返回 401。旧版本曾使用 Vercel Sandbox broker / local Docker env；当前实现已删除这条 credential transport，改由可信 app runtime 直接调用 Tavily REST。不要重新把 Tavily key 注入 Sandbox。
