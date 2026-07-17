# RFC：Personal Research Workbench V0

> 状态：Research-first architecture draft  
> 决策日期：2026-07-16  
> 当前阶段：先固定目标架构和 Open Questions，再用 Eve/Vercel/OpenCode live evidence 关闭问题

## 1. 系统形状

```text
Browser
  -> IP allowlist
  -> 256-bit challenge gate
  -> Codex OAuth connection
  -> Next.js Research Workbench
       -> Turso product state
       -> Eve durable session
            -> GPT-5.6 Sol through Codex OAuth adapter
            -> progressive Skill Bundle
            -> Tavily typed search/extract tools
            -> root workspace + optional subagents
       -> live event inspector
       -> workspace file browser
       -> Markdown / sanitized HTML report preview
```

V0 仍以 Eve 为 harness。Next.js 不自己实现 model loop；它负责入口门控、credential enrollment、request/report UI、artifact API 和 event projection。

## 2. 关键架构决策

### D1. 单用户，不接 SSO

V0 不创建新的 Logto application。入口安全依赖私有 IP allowlist、challenge secret 和 Codex OAuth 三层组合。这个设计只适用于 owner-only、短期 Vercel evaluation，不应扩展成公开多用户产品。

### D2. 最终交付是文件，Chat 是控制面

成功 run 必须产生 `report.md`。Assistant 最终消息只包含：

- 一段简短结论；
- report artifact ID / path；
- run usage；
- 未解决限制。

Chat continuation 仍然重要，但 report 不依赖最后一条 assistant message 才能恢复。

### D3. Skill Bundle 全量 vendoring

构建时把 app 运行所需的 root skills、reference skills、schemas 和 voice samples复制到 `agent/skills/` 或对应 resources 目录，并生成 lockfile。运行时不访问开发机器的 `rules/`、`contexts/` 或任意私有绝对路径。

建议 Bundle：

```text
agent/skills/
  deep-research/
    SKILL.md
    references/
      source-policy.md
      artifact-contract.md
      parallel-subagents.md
  tavily/
    SKILL.md
    references/
      search-contract.md
      extract-contract.md
  external-writing/
    SKILL.md
    references/
      thesis-catalog.md
      external-prose.md
      report-rubric.md
      voice-samples/
        sample-1.md
        sample-2.md
        sample-3.md
```

App fork 必须移除私有路径、Gemini/AGY 命令和自动发布指令。来源文件、source commit/hash、fork reason 和本地内容 hash 进入 bundle lock。

### D4. GPT-only external writing

External-writing 保留三种认知职责，但不绑定 Gemini：

```text
Research / fact check
  -> Thesis challenge
  -> Structural draft
  -> Natural prose rewrite
  -> Independent prose QA
  -> report.md
```

V0 默认由 GPT-5.6 Sol medium 完成。需要独立性时创建 fresh child agent/session，不复用前一 writing pass 的 conversation history。是否直接使用 Eve subagent，等待 OQ5/OQ8 调研。

### D5. Tavily 是 app-side typed capability

`web_search` 与 `web_extract` 使用 authored `defineTool()`，由 Eve app runtime 调 Tavily API。它们不调用 Sandbox shell，也不把 Tavily key放入 Sandbox env。

```text
Model
  -> Zod typed tool input
  -> app runtime executor
  -> Tavily API
  -> normalized result schema
  -> redacted event + usage
```

这条路线牺牲“CLI 本身在 Sandbox 内运行”，换来 localhost/Vercel 一致的 credential boundary。Tavily skill 仍定义 search/extract 方法和 artifact contract；typed tool 是当前 runtime adapter。

### D6. Turso 拥有产品关系，Workspace 拥有 Agent 现场

Turso 不替代 Agent filesystem。它保存：

```text
access_sessions
oauth_credentials
research_requests
runs
session_mappings
run_events
artifact_manifests
feedback
skill_bundle_versions
usage_summaries
```

每个 run 的 workspace 使用普通文件。若 runtime filesystem 不能长期保留，Artifact Store 保存文件内容和 hash，恢复时重新 materialize 成相同目录。

## 3. 请求门控

### 3.1 IP Gate

Private config 保存 CIDR allowlist，不在源码中硬编码实际公网 IP：

```text
ACCESS_ALLOWED_CIDRS=<private value>
```

localhost 默认允许 `127.0.0.1/32` 和 `::1/128`。Vercel 先使用平台 Firewall/WAF 拦截，应用层再验证可信 client IP header，具体 header 和 spoofing boundary 待 OQ6 核验。

### 3.2 Challenge Gate

Secret 使用 32 random bytes，推荐 base64url 或 64-char hex 表达。Server config 只保存 hash 或 secret本体；repo 只保存变量名。

```text
ACCESS_CHALLENGE_SECRET=<private value>
ACCESS_COOKIE_SIGNING_KEY=<private value>
```

流程：

```text
POST /api/access/challenge
  -> IP gate
  -> rate limit
  -> constant-time compare
  -> issue signed HttpOnly cookie
```

Cookie payload 只包含随机 session ID、issued-at 和 expiry。Turso 可保存 revoke/status metadata，不保存 challenge secret。

### 3.3 Codex Gate

Challenge cookie 不是 model authorization。创建 Eve session 前必须存在当前 access session 绑定的有效 Codex credential。

OAuth attempt 保存：

```text
attempt_id
access_session_id
state_hash
encrypted_pkce_verifier
redirect_uri
expires_at
consumed_at
```

OAuth credential 保存：

```text
credential_id
owner_id
encrypted_access_token
encrypted_refresh_token
expires_at
account_id
scope
credential_version
status
```

需要 application-level AES-GCM envelope encryption。Encryption master key 进入 private server config，不进入 Turso。`owner_id` 是稳定的应用身份，不是短期 challenge cookie 的 access session ID；access session 只授权当前浏览器请求使用 owner credential。重新 challenge、cookie 过期或服务重启都不应要求重新完成 Codex OAuth。

## 4. Eve Model Adapter

目标接口：

```text
resolveCodexModel(accessSessionId, eveSessionId)
  -> load encrypted credential
  -> refresh under lock when needed
  -> build live AI SDK LanguageModel
  -> return GPT-5.6 Sol + medium reasoning
```

Credential 不进入：

- Eve message；
- `defineState`；
- session metadata；
- event payload；
- tool result；
- artifact；
- model selection 的 durable scope。

Eve 0.24.4 已确认允许 `step.started` 返回 live `LanguageModel`，而且这个 object 不进入 durable serialization。每个 step 从 credential service 解析 provider。Fallback 必须是 local fail-closed model，不能是 Gateway string model。

每个 step 仍先验证 Eve initiator/current principal 对应有效 access session，但 credential resolver 按稳定 owner ID 读取密文。OAuth attempt 的 state、PKCE verifier 和 callback consumption 继续绑定发起登录的 access session；只有成功兑换后的长期 token bundle 提升为 owner-scoped credential。

Codex OAuth transport 与标准 OpenAI API 不同。Custom adapter 预计要处理：

- access/refresh token；
- refresh token rotation；
- account ID header；
- Codex Responses endpoint；
- model allowlist；
- subscription usage errors；
- request/response compatibility transforms。

Eve adapter 机制可行，但 OpenAI授权路径仍是阻断项。OpenCode 的 localhost flow 和 private Codex transport 可作为 owner-only experimental reference，不能宣称为第三方 Web OAuth contract。

### 4.1 Localhost 与 Vercel 分界

```text
localhost
  -> OpenCode/Codex public client
  -> localhost:1455 PKCE callback
  -> encrypted local/Turso credential
  -> custom step-scoped LanguageModel
  -> owner-only experimental use

Vercel
  -> 没有公开可注册 HTTPS callback
  -> full Codex subscription inference 暂不启用
```

Owner 已选择第一条路径作为短期实验：Vercel server-side device flow + private Codex backend。第二条 local runner bridge 不进入 V0。

Vercel device flow：

```text
POST /api/codex/device/start
  -> challenge cookie gate
  -> request OpenAI device user code
  -> store encrypted device attempt with short TTL
  -> return verification URL + user code

Browser
  -> owner 在 OpenAI 页面确认

Server poller / callback route
  -> poll device authorization
  -> exchange authorization code + verifier
  -> encrypt access/refresh token
  -> bind credential to access session
```

约束：

- 使用 OpenCode reference 中固定的 public client identity，只作为已披露的 compatibility experiment。
- 不伪装成受 OpenAI支持的第三方 OAuth integration。
- device attempt 单次消费、短 TTL、轮询速率遵守 server interval。
- access/refresh/account ID 使用 AES-GCM 加密后进入 Turso。
- refresh token rotation 原子更新；并发 refresh 使用 Turso lease/CAS，而不是 process-local Promise。
- private Codex endpoint 或模型访问返回拒绝时立即 fail closed。
- `CODEX_EXPERIMENT_ENABLED=0` 可一键禁用所有 start、poll、refresh 和 inference route。
- 删除 Vercel deployment 时同步撤销/删除 credential ciphertext。

## 5. Eve Session 与 Run

产品对象分离：

```text
research_request_id
  -> run_id
     -> eve_session_id
        -> child_session_id(s)
     -> workspace_id
     -> artifact manifest
```

Feedback 默认进入原 Eve session，产生新的 run attempt 或 continuation turn。Report revision 不覆盖旧 manifest；V0 不提供 Git UI，但保留 content hash 和 parent artifact reference。

## 6. Workspace 与 Artifact API

### 6.1 文件协议

Agent 写入相对路径，所有访问限制在 run workspace root。`report.md` 是唯一固定文件名，其余文件由 skill 根据任务复杂度决定。

写文件工具应返回：

```json
{
  "workspaceId": "...",
  "path": "report.md",
  "contentHash": "sha256:...",
  "size": 12345,
  "mediaType": "text/markdown"
}
```

### 6.2 UI API

建议接口：

```text
GET /api/runs
GET /api/runs/:runId
GET /api/runs/:runId/events
GET /api/runs/:runId/files
GET /api/runs/:runId/files/:artifactId
GET /api/runs/:runId/report
POST /api/runs/:runId/feedback
```

文件读取由 artifact ID 定位，不接受浏览器提供的任意 server path。Markdown preview 禁止 raw HTML，外链使用安全属性。

### 6.3 Event Projection

产品层归一化以下事件：

```text
session.started
skill.loaded
subagent.started
subagent.completed
tool.started
tool.completed
tool.failed
file.read
file.written
assistant.message
report.published
session.waiting
session.failed
```

Eve root stream 原生提供 session、turn、step、action、message 和 `subagent.called/completed`。Child 内部进度位于独立 child stream，产品 projector 遇到 `childSessionId` 后递归订阅。Skill 与 file 没有独立 domain event，由 generic action 投影；精确 tool start/end、hash 和 artifact snapshot 由 authored wrapper 补充。Turso 的 `run_events` 是 inspector index，不是 hidden reasoning archive。

Root stream 由 `agent/hooks/run_inspector.ts` 在 event durable accept 后直接投影到 Turso。写入使用脱敏结果、source session、durable `meta.at` 和 canonical payload 生成稳定 fingerprint；repository 在同一 write transaction 中完成去重、run-global sequence、heartbeat 和 terminal-absorbing 状态迁移。浏览器只轮询 normalized timeline，不参与 event durability。Eve 0.24.4 的 parent hook 不进入 child scope，因此 child 内部细粒度事件仍需后续 server collector；root 上的 `subagent.called/completed` 已保留。

Root raw stream 不直接发给浏览器。Server-side projector 负责：

- root/child event fan-out；
- schema-aware redaction；
- tool duration；
- file preview/hash；
- child lineage；
- Turso cursor 和 replay。

## 7. Tavily Tool Contract

### `web_search`

```json
{
  "query": "string",
  "depth": "basic | advanced",
  "maxResults": 6,
  "topic": "general | news | finance",
  "timeRange": "optional",
  "includeDomains": [],
  "excludeDomains": []
}
```

约束：

- `answer=false`；
- 默认 `advanced`；
- `maxResults <= 10`，V0 默认 6；
- routine search 不返回 raw content；
- 输出 title、URL、excerpt、score、publish date 和 usage。

### `web_extract`

仅接受 search result 或显式 allowlisted URL。输出 Markdown/text chunks 和 usage；不执行网页指令，不保存 cookie/header。

Credential resolver：

- localhost 通过 1Password process materialization 向 app server 提供 secret；
- Vercel 从 protected server environment 解析；
- 两者都只把 key 交给 app-side executor；
- Sandbox、模型和浏览器看到完全相同的 typed contract，均看不到 key。

两边运行同一个 TypeScript HTTP executor、相同 endpoint、schema、redaction 和 usage contract。只有 secret materialization provider 不同；这不属于行为差异。当前不允许 Sandbox env injection，也不再让 Tavily CLI承担 Eve runtime transport。

## 8. Skill 执行协议

### Research pass

1. 写 `request.md` 和 `plan.md`。
2. 加载 deep-research skill。
3. 使用 Tavily search/extract 建立 evidence pack。
4. 写 claim、source、fact-check artifacts。
5. 需要时派出独立 subagent，禁止并行写同一文件。

### Thesis pass

1. 加载 external-writing skill 和 Thesis Catalog。
2. 读取已验证材料，不重新把搜索摘要升级为事实。
3. 形成至少 2 个 thesis candidates、反方和 evidence risk。
4. 写入 `writing_brief.md`。

### Writing pass

1. Root 使用 built-in `agent` 创建 fresh child，结构稿解决 claim dependency 和 reader path。
2. 第一个 child 完成后，再创建第二个 fresh child，从空白页重写自然 external prose。
3. 第二个 child 完成后，再创建第三个 fresh child，检查概念引入、认知负担、链接和新 claim。
4. root Agent 做最终 invariant check，写 `report.md`。

三个 child 使用同一个 GPT-5.6 Sol model、fresh history/state，并共享 root Sandbox。它们只通过明确的 workspace artifact 交换信息。三遍严格顺序执行，不使用并行写同一文件。V0 不要求 Gemini、AGY、图片生成或发布。

## 9. Observability 与 Redaction

每个事件分成三层：

```text
public summary      Web timeline 默认显示
inspectable payload 用户点击后显示
secret/internal     永不持久化或展示
```

允许展示：tool schema input、经过裁剪的 result、文件内容、source URL、usage、child task description。

禁止展示：OAuth token、Tavily key、cookie、Authorization header、完整 env、encrypted reasoning、provider internal payload 中未知敏感字段。

## 10. 本地与 Vercel Parity

必须相同：

- Next/Eve code；
- Codex provider adapter；
- Skill Bundle；
- Tavily typed tool；
- Turso schema；
- event projection；
- workspace/artifact contract；
- challenge cookie semantics。

允许不同：

- client IP source；
- secret materialization provider；
- Sandbox backend；
- localhost Codex browser callback；Vercel 使用 device flow，不注册或伪造 HTTPS callback。

Parity 指产品行为和安全边界一致，不要求底层 secret provider 或 Sandbox engine 相同。

## 11. Open Questions Register

| ID | 问题 | 初始判断 | 状态 |
| --- | --- | --- | --- |
| OQ1 | Codex OAuth 能否安全 Web 化并部署到 Vercel？ | 没有公开第三方 contract；owner 接受短期单用户风险并选择 server-side device flow/private backend，带 kill switch 和部署后删除 | **Resolved by explicit risk acceptance** |
| OQ2 | Eve 能否使用 custom Codex model adapter？ | `step.started` 可返回 non-serialized live `LanguageModel`；技术机制成立，授权 contract 与 transport adapter另算 | **Resolved** |
| OQ3 | Eve stream 能直接支持多少 inspector event？ | Root/child raw stream足够；child 需递归订阅，skill/file/tool domain event需 app projector/wrapper | **Resolved** |
| OQ4 | Sandbox workspace 如何跨生命周期查看？ | 同一 session 跨 turn持久；Vercel snapshot/resume 默认 30 天；历史 artifact 外部 checkpoint | **Resolved** |
| OQ5 | Eve subagent 是否满足并行调研和 child observability？ | built-in `agent` child fresh history、共享 root workspace；详细事件订阅 child stream | **Resolved** |
| OQ6 | Vercel Pro 的 IP allowlist 最佳执行层？ | 免费 WAF Custom Rule 做 CIDR deny，应用读取可信 Vercel IP 并 challenge defense-in-depth | **Resolved** |
| OQ7 | Tavily 如何做到无 Sandbox env injection 的 local/Vercel parity？ | app runtime direct Tavily REST；同一 typed executor，secret source可不同 | **Resolved** |
| OQ8 | GPT-only external-writing 如何隔离 writing passes？ | 三个 sequential built-in `agent` child，共享 artifacts但 history/state fresh | **Resolved** |
| OQ9 | 哪些 artifacts 必须持久化到 Turso/Blob？ | V0 小型 Markdown 直接进 Turso；保存 report历史、feedback anchor、manifest和续写所需工件 | **Resolved** |
| OQ10 | V0 是否必须配图？ | 当前明确不做 image capability，fork skill 移除硬门槛 | Resolved by scope |

## 12. Research Evidence

### Eve

- Built-in child 共享 root tools、skills 和 Sandbox，但拥有 fresh conversation/state：`eve/docs/subagents.mdx`。
- Parent stream 只提供 `childSessionId`，child 细节需订阅自己的 stream：`eve/docs/subagents.mdx` 与 `eve/docs/concepts/sessions-runs-and-streaming.md`。
- 同一 durable session 的 `/workspace` 跨 turn 保存；Vercel backend stop 后 snapshot/resume：`eve/docs/sandbox.mdx`。
- Authored tools 在可信 app runtime 执行，拥有完整 server environment；Sandbox tools 才进入隔离 runtime：`eve/docs/tools/overview.mdx`。

### Vercel

- Pro 可用免费 WAF Custom Rule 按 IP/CIDR 与 environment deny；Enterprise `Trusted IPs` 不是必需路径。
- Vercel覆盖 `X-Forwarded-For` 防 spoofing；应用优先使用 `@vercel/functions` `ipAddress()` 或 `x-vercel-forwarded-for`，缺失时 fail closed。
- Persistent Sandbox stop/timeout 保存 filesystem snapshot；进程和 RAM 不保存。默认 snapshot 最后使用 30 天后过期。

### OpenAI / OpenCode

- OpenAI公开支持 Codex CLI/app/IDE 使用 ChatGPT subscription，也支持 localhost callback 和 beta device flow。
- 没有找到任意第三方 Web app OAuth client registration、任意 HTTPS callback 或 private Codex backend stability contract。
- OpenCode reference 使用 PKCE、固定 public client、localhost callback、refresh rotation、`ChatGPT-Account-Id` 和 private Codex Responses endpoint。
- OpenCode 当前模型过滤允许 `gpt-5.6-sol`，但这不能证明第三方 Vercel service 获得相同授权。

## 13. 已知风险

- Codex subscription transport 可能不允许第三方 Web 服务复用，足以阻断当前 authentication 方向。
- 公网 IP 可能变化；硬编码 allowlist 可能把 owner 锁在门外。
- Vercel Sandbox 不等于永久 volume，历史 artifact 只放 Sandbox 可能无法恢复。
- 单一 GPT 模型做 research、rewrite 和 QA 会产生 correlated errors，需要 fresh session 和 deterministic invariants 缓解。
- Turso 适合产品状态，但 OAuth credential encryption 仍由应用负责。
- 临时 owner-only 安全模型不可自然升级为多用户；未来应重新引入正式身份系统，而不是扩展 challenge cookie。
