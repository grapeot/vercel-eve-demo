# PRD：Personal Research Workbench V0

## 产品判断

这是一个只供单个受信任用户使用的 Web research harness，不是公开网站，也不是多租户 SaaS。它把深度调研、thesis 发现、external-facing 写作、运行过程检查和反馈续写放进一个 Eve session，让用户既能拿到最终文章，也能检查 Agent 如何搜索、读写文件和组织中间工件。

V0 的主交付不是 chat answer，而是 Sandbox workspace 中的一组可检查文件，其中 `report.md` 是最终 external-facing research report。Web UI 负责实时展示 session event、tool call 和文件变化，并把 Markdown 安全渲染成 HTML。Chat 负责提交任务、解释进度和继续反馈，不承担最终文档的唯一存储。

## 目标用户与部署范围

- 唯一用户：项目 owner。
- 主要运行环境：localhost。
- 验证环境：短期部署到 Vercel Pro，使用 owner 明确接受风险的非官方 Codex device flow 完成端到端验证，随后删除部署。
- 不开放注册，不接 Superlinear Academy SSO，不设计 tenant 或 team membership。
- Vercel 部署同时使用来源 IP allowlist 和 256-bit challenge secret 两道入口限制。
- 模型只使用用户自己的 ChatGPT/Codex subscription OAuth，不接受 OpenAI API key，也不使用项目方 AI Gateway credits。

## 用户任务

用户提交一个研究问题和必要背景。Agent 应完成：

1. 理解真正的决策问题，并建立研究计划。
2. 按 progressive disclosure 加载 deep research、Tavily 和 external writing skills。
3. 使用 Tavily 搜索和提取网页，不使用 Tavily answer/question-answering。
4. 生成 claim table、source index、fact check、thesis candidates 和 writing brief 等中间工件。
5. 在必要时派出 subagent 做独立调研、反方压力测试或 prose review。
6. 自己选择 thesis，完成 external-facing 中文 report，而不是事实摘要。
7. 将最终稿写入 `report.md`，同时在 chat 中返回简短结论和 artifact link。
8. 接收用户针对 report 或过程的反馈，在同一 session 和 workspace 中继续修改。

## 核心体验

### 1. 入口 Challenge

Vercel 请求只有同时满足以下条件才能进入应用：

- 来源 IP 命中私有 allowlist。
- 浏览器已经通过 256-bit challenge secret。

Challenge secret 不写入 repository。通过后服务端签发短期、`HttpOnly`、`Secure`、`SameSite=Strict` cookie。失败响应不泄露是 IP、challenge 还是 cookie 校验失败。

localhost 也保留 challenge 流程，IP allowlist 允许 loopback。生产 allowlist 中的实际公网 IP 只存在于 private deployment config。

### 2. Codex OAuth

通过入口 challenge 后，如果没有可用的 Codex credential，页面只显示 Connect ChatGPT/Codex。localhost 使用 OpenCode/Codex 的 localhost PKCE flow 做 owner-only experimental integration。应用保存继续调用所需的 access token、refresh token、expiry 和 account metadata；所有 credential 必须加密保存，不进入 Eve message、session event、artifact、日志或浏览器 storage。

OpenAI 当前没有公开任意第三方 Web app 注册 Codex OAuth client 和 HTTPS callback 的 contract。Vercel 不能把 localhost redirect 简单替换成 Preview URL。Owner 已决定在短期、单用户、受 IP/challenge 保护且部署后删除的实验中使用 OpenCode reference 的 device flow 和 private Codex backend。V0 不把这条路径宣称为受 OpenAI 支持的产品能力，也不允许扩展给第二个用户。

Credential 失效、refresh 失败或 subscription 达到用量限制时，当前 run 明确暂停并要求重新授权，不得回退到项目方模型 credential。

### 3. Research Request

用户可以填写：

- research question；
- 背景、目标读者和使用场景；
- 可选的已有判断或希望验证的 thesis；
- 可选的时间、来源或篇幅约束。

V0 不提供 batch upload、cron、公开 API 或任意模型选择。每次只允许一个 active run。

### 4. Live Run Inspector

运行页同时展示：

- assistant 可见消息；
- subagent 创建、开始、完成和失败状态；
- tool 名称、开始时间、结束时间、参数摘要、结果摘要和错误；
- skill load 事件；
- 文件读取、写入和修改事件；
- token/search usage；
- session 和 run 状态。

点击 file/tool event 后，用户能查看对应输入输出或文件快照。任何 credential、Authorization header、完整 process environment 和模型隐藏 reasoning 都不展示。

### 5. Workspace 与 Report

每个 research run 拥有一个隔离 workspace，推荐结构：

```text
workspace/
  request.md
  plan.md
  scratchpad.md
  claim_table.md
  source_index.md
  fact_check.md
  brainstorm_brief.md
  brainstorm_synthesis.md
  writing_brief.md
  article_structural.md
  article_qa.md
  report.md
```

文件按需产生，不要求每次都机械创建全部模板。`report.md` 是成功 run 的必要交付。

Web UI 提供：

- workspace file tree；
- Markdown source；
- sanitized HTML preview；
- 文件下载；
- report 全屏阅读；
- 回到同一 Eve session 继续反馈。

### 6. Feedback Continuation

用户可以提交 general feedback，也可以从当前 report 选中一段文字后反馈。V0 不建立 skill self-evolution、proposal 或 Git version control，但保存：

- feedback text；
- feedback 时对应的 report content hash 和快照引用；
- Eve session ID、run ID 和 workspace ID；
- 当时使用的 Skill Bundle version。

这组字段为后续 feedback-to-skill pipeline 留出接口。

## Skill Bundle

V0 必须把所有运行时可能读取的 Markdown 依赖一起 ship，不能引用开发机器上的 workspace 路径。

### Root skills

- `deep-research`：研究计划、claim extraction、来源分层、交叉验证、fact check 和 artifact contract。
- `tavily`：search/extract 语义、参数、输出 envelope、成本和来源使用规范。
- `external-writing`：thesis 发现、reasoning architecture、结构稿、自然中文重写和独立 QA。

### Progressive-disclosure references

- parallel subagent workflow；
- Thesis Catalog；
- external prose best practice；
- app-specific communication rules；
- 3-5 篇经过筛选、允许随应用分发的 voice calibration samples；
- artifact schemas 和 final report acceptance rubric。

原 external-writing skill 中的 Gemini/AGY 调用必须改成 Eve 内部的 GPT-5.6 Sol 主 Agent / subagent passes。V0 不调用 Gemini。原 skill 的 `gpt-image-2` 配图硬约束不进入 V0；图片生成属于后续独立 capability。

## Model 与 Tool

### Model

- Harness：Eve。
- Model：ChatGPT/Codex subscription 当前允许的 GPT-5.6 系列模型，目标为 Sol。
- Reasoning：medium。
- 路由：localhost 使用 browser PKCE flow，Vercel 使用非官方 device flow；两者最终进入同一个 owner-only Codex custom provider adapter，不经过 Vercel AI Gateway。
- 失败策略：fail closed，不存在 system credential fallback。

### Tavily

Tavily 暴露为 authored typed tool，而不是让模型使用通用 shell：

- `web_search`：默认 advanced、最多 6 个结果、answer off。
- `web_extract`：读取已选择 URL 的正文或相关 chunks。
- tool input/output 使用稳定 schema。
- Tavily credential 只存在于 app-side credential boundary，不进入 Sandbox process。
- localhost 与 Vercel 使用同一个 tool implementation 和相同网络调用路径，不提供交互式 mock 模式。

自动化测试可以使用 fixture 或 fake provider；用户实际运行路径只能是 live。

## 数据管理

Turso 保存产品级状态：

- access challenge session metadata；
- Codex OAuth encrypted credential records；
- research request、run、Eve session 映射；
- normalized event index；
- report 和 workspace artifact manifest；
- feedback；
- Skill Bundle version/hash；
- usage summary。

Sandbox filesystem 保存任务现场。Vercel persistent Sandbox 可以跨 turn snapshot/resume，但默认 snapshot 并非永久保存，sandbox definition 变化也会更换 workspace。V0 将 `report.md`、feedback 对应快照和继续编辑所需的 Markdown artifacts 同步进 Turso；UI 仍以 workspace file tree 呈现，不能让产品数据库结构泄漏进 Agent 工作界面。

## 安全边界

- 公网 IP 与 challenge secret 不进入 Git、日志或前端 bundle。
- 32 bytes 随机 secret，不使用 32-bit secret。
- Challenge 比较使用 constant-time comparison，成功 cookie 可撤销并有明确 TTL。
- OAuth state、PKCE verifier 和 credential 绑定当前 challenge session。
- OAuth refresh token 使用 application-level authenticated encryption；master key 只存在于 private server config。
- Markdown HTML preview 禁止原始 HTML，必须 sanitize link、image 和 code rendering。
- 文件 API 只允许访问 server-issued workspace ID 下的相对路径，禁止 `..`、绝对路径和 symlink escape。
- Tool inspector 对 secret、header、cookie、token、完整网页原文和 hidden reasoning 做结构化 redaction。
- 一个 active run、固定模型、固定 reasoning、固定搜索预算，不提供 batch。

## V0 非目标

- 多用户、团队 workspace、SSO、RBAC。
- OpenAI API key BYOK。
- Vercel AI Gateway inference。
- 自动修改或发布 skill。
- Git version control 和 skill proposal UI。
- 自动发布到博客、Yage Share、Circle 或其他外部渠道。
- 图片生成和自动配图。
- batch、cron、public API、Slack 或其他 channel。
- 长期公开运行的生产 SLA。

## 成功标准

1. localhost 和临时 Vercel deployment 都使用 Eve、完整 Skill Bundle、experimental Codex adapter 和 Tavily typed tools完成真实端到端 run；localhost 使用 browser PKCE，Vercel 使用 device flow。
2. 未通过 IP/challenge/Codex OAuth 任一门控时不能创建或继续 Eve session。
3. 一次真实 research 产生可下载的 `report.md`，HTML preview 与 Markdown 语义一致。
4. 用户可以检查 tool call、skill load、subagent 和文件读写记录，不暴露 credential 或 hidden reasoning。
5. 用户反馈能在同一 session 中触发 report revision，并保留反馈对应的旧 report 快照。
6. Agent 能加载完整 progressive-disclosure references，自主形成 thesis，并完成 external-facing report。
7. 没有 Gateway/system model fallback；Codex credential 失败时 run 明确停止。
8. Turso 或 artifact persistence 层能在页面刷新、Eve service 重启和 Sandbox 结束后恢复 run index 与最终 report。

## 已接受的实验风险

- Vercel Codex device flow 与 private backend 没有第三方 Web 服务的公开稳定 contract，可能无预告失效。
- 这项风险接受只覆盖 owner 的短期 personal evaluation，不构成对其他用户开放的依据。
- OpenAI 后续若提供正式第三方 OAuth contract，应替换实验 adapter，不保留兼容分支。
- OpenAI 若阻止该 flow，应用必须明确停止，不尝试绕过限制或回退到项目方 credential。
