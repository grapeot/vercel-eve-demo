# AGENTS.md - Vercel Eve Demo

## 项目目标

这是一个面向公开 GitHub 的中文 Vercel eve 深度调研 Demo。它验证平台无关的 Markdown skill 与独立 CLI/API 能力能否在 eve harness 中保持可发现、可执行和可审计。

## 开始工作前

1. 阅读 `docs/prd.md`、`docs/rfc.md`、`docs/test.md`。
2. 查看 `docs/working.md` 中已经验证过的行为与已知限制。
3. 保持 `mock` 为默认模式；live 调用必须由显式环境变量开启。

## 目录

- `agent/`：eve agent、channel、skills 和 typed tools。
- `app/`：Next.js 前端与 server-side API。
- `src/`：平台无关配置、搜索、计费和 bundle 逻辑。
- `skills/`：平台无关 Skill Bundle manifest。
- `sandbox/`：可选的 Tavily CLI Sandbox image。
- `scripts/`：稳定的构建、检查和 smoke-test 入口。
- `tests/`：默认离线测试与 opt-in live tests。
- `docs/`：中文 PRD、RFC、测试与工作记录。

## 工程约束

- Node.js 固定为 24，eve 固定为 `0.24.4`；升级前必须重新跑全部测试。
- `src/` 的核心逻辑不要依赖浏览器状态；外部 API 必须通过可注入的 fetch 或 adapter 测试。
- 不拼接 shell command。需要 CLI 时使用 argv 数组。
- 不把 API key、OIDC token、真实 prompt、provider request ID 或原始网页正文写入日志、fixture、artifact 或 usage ledger。
- 每次实质改动更新 `docs/working.md`。

## Public Repo 约束

- 所有公开示例使用 `example.com`、`replace-with-your-real-key` 等假数据。
- `.env`、`.env.*`、`.vercel/`、`.eve/`、usage 数据和本地产物不得提交。
- 不写入真实 1Password vault 路径、内部 endpoint、本机绝对路径或客户信息。
- 提交前运行 `npm run verify` 和 `npm run check:public`。

## Git

这是独立 git repo。只在用户明确要求时 commit、push、创建 GitHub repo 或部署。
