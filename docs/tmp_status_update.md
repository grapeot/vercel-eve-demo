# Workbench 实时状态同步设计

## 结论

当前 artifacts 已经能在任务运行中出现，因为 `publish_artifacts` 直接从可信 Eve runtime 写入 Turso。Run Inspector 没有实时事件，不是 Eve 没有产生事件，而是事件持久化依赖浏览器中的 React effect：只有前端拿到 `sessionId`、完成 attach，并持续保持页面存活，才会把 `agent.events` 回传到 `/api/runs/:runId/events`。

目标方案是把事件持久化移入 Eve runtime。新增 authored event hook，在 Eve durable stream 接受每个事件后完成 run 绑定、脱敏投影和幂等写入。浏览器只读取 Turso 中的 normalized timeline，不再承担 durability。现有 1.2 秒轮询已经足够提供近实时体验，第一版不需要再引入 WebSocket 或 SSE。

实现状态：阶段 A/B 的 root stream durability 已于 2026-07-17 落地。Eve 0.24.4 已确认 parent hook 不进入 child scope，因此 child 内部细粒度事件仍留在阶段 C；root stream 中的 subagent lifecycle 正常持久化。

## 目标

实现后应满足以下行为：

1. 用户提交任务后，无需等待 `agent.send()` 完成，Run Inspector 能持续出现 session、tool、file、subagent、usage 和 failure 事件。
2. 页面刷新、切换 tab、浏览器休眠或关闭页面，不影响事件持久化和 run terminal status。
3. Eve 在 session 建立后、首个 model step 前失败时，run 仍能进入 `failed`，不会留下 active orphan。
4. 同一个 durable event 即使因 workflow retry 或 collector retry 重放，也只写入一次。
5. `completed`、`failed`、`cancelled` 是吸收态，迟到事件不能把 terminal run 改回 `running`。
6. Raw Inspector 展示的是脱敏后的 normalized event，不是 provider raw payload，也不包含 hidden reasoning、token、cookie、credential、environment 或 continuation token。
7. Root session 至少可完整观察；child session 在第二阶段加入 lineage 和细粒度 child stream。第一阶段仍应显示 root stream 中的 `subagent.called/completed`。

## 当前事实

### 已经正常工作的路径

```text
Eve runtime
  -> authored publish_artifacts tool
  -> Turso artifacts
  -> GET /api/runs/:runId
  -> UI artifact tree
```

这条路径不依赖浏览器上传中间状态，因此当前 run 已经可以在执行期间显示 `request.md`、`plan.md`、fact-check 等文件。实现位置见 `agent/tools/publish_artifacts.ts` 和 `src/storage/repositories.ts`。

### 当前失效的路径

```text
Eve durable stream
  -> useEveAgent 的 agent.events
  -> React 取得 currentSessionId
  -> PATCH /api/runs/:runId 完成 attached=true
  -> POST /api/runs/:runId/events
  -> Turso run_events
  -> Run Inspector
```

当前页面在 `currentSessionId` 或 `attached` 缺失时直接跳过 event batch upload，见 `app/_components/research-console.tsx`。本轮 live run 已由 server-side `step.started` 成功绑定 Eve session，但浏览器没有发出 attach PATCH，导致 `run_events=0`。这证明产品 run mapping 和前端 upload gate 已经形成两个不一致的真相来源。

RFC 原本要求 Root raw stream 不直接交给浏览器，由 server-side projector 负责 redaction、cursor 和 replay，见 `docs/rfc.md` 的 Event Model。当前实现没有达到这条设计。

## 设计决策

### 1. Eve runtime hook 成为唯一事件写入者

新增 `agent/hooks/run_inspector.ts`：

```ts
export default defineHook({
  events: {
    "*": async (event, context) => {
      // resolve run -> project -> append idempotently -> advance status
    },
  },
});
```

Eve hook 在事件写入 durable stream 后执行，适合 audit、metrics 和外部数据库投影。Hook 可以读取 `context.session.id`、`context.session.auth`、turn 和 parent metadata。它不依赖 React，也不会因为浏览器断开而停止。

Hook 必须捕获自己的所有异常。Inspector 是 observability side effect，Turso 短暂失败不应反过来让 Eve turn 进入 `turn.failed`。异常只允许输出不含 event payload 和 secret 的结构化日志：session ID、event type、错误类别。

### 2. 在最早的 root event 绑定 run

`session.started` hook 使用 `context.session.auth.initiator.principalId` 调用 `attachQueuedSession()`，将当前 owner 最新且唯一的 queued run 原子绑定到 `context.session.id`。

绑定规则：

- initiator/current principal 缺失或不一致时不绑定；
- 只绑定同一 access session 下 `queued + eve_session_id IS NULL` 的最新 run；
- 同一 Eve session 不能绑定多个 product run；
- root session 已绑定时重放属于幂等成功；
- child session 不创建新 product run，通过 parent/root lineage 归入原 run。

完成 hook 验证后，从 `agent/agent.ts` 的 model resolver 中移除 attach side effect。Model resolver 只负责 authorization 和 model resolution，不再兼任 control-plane mapping。

### 3. 使用稳定 event key，而不是浏览器数组下标

Hook 收到的 event 有持久化时间 `event.meta.at`，但没有公开 stream index。新增稳定 `source_event_key`：

```text
sha256(
  source_session_id
  + event.meta.at
  + event.type
  + canonical_json(redacted_projected_event)
)
```

数据库以 `source_event_key` 做唯一约束。单条 SQL 使用 `INSERT OR IGNORE`，并在插入时从当前 run 的最大 sequence 原子生成下一个 inspector sequence。Turso/SQLite 写事务串行化并发 sequence 分配。

同一 event retry 会命中相同 key；两个内容相同但发生时间不同的合法事件仍得到不同 key。禁止把 token、continuation token 或未脱敏 raw event 放进 fingerprint 或数据库。

建议 schema v4 为 `run_events` 增加：

- `source_session_id TEXT NOT NULL`
- `parent_session_id TEXT`
- `source_event_key TEXT NOT NULL UNIQUE`
- `source_created_at TEXT NOT NULL`

现有 `sequence` 继续作为 UI 的 run-global 排序游标。历史行迁移时使用 `legacy:<run_id>:<sequence>` 生成 source key。

### 4. Run status 使用显式状态机

替换无条件 `setRunStatus()`，新增条件更新 `advanceRunStatus()`：

```text
queued -> running | failed | cancelled
running -> waiting | completed | failed | cancelled
waiting -> running | completed | failed | cancelled
completed / failed / cancelled -> 不再迁移
```

事件映射：

- `session.started`、`turn.started`、有效 action event：`running`
- `session.waiting`：`waiting`
- `session.completed`：`completed`
- `session.failed`、`turn.failed`、`step.failed`：`failed`
- `turn.cancelled`：`cancelled`

每次成功插入 event 都更新 `runs.updated_at`，使它代表最后观察到的 runtime activity，而不是只代表 session attach 时间。失败的 projector 或被过滤的 reasoning event不更新产品状态。

### 5. 浏览器只读 normalized timeline

保留现有 `GET /api/runs/:runId` 轮询。Busy 时每 1.2 秒读取 events 和 artifacts，足以满足 V0 的 live inspector；页面不可见时可降到 5 秒，减少无意义请求。

删除以下 client-authoritative 行为：

- React 根据 `agent.events` 上传 event batch；
- `attached` 作为 event persistence 的前置条件；
- 浏览器 PATCH 作为 run/session mapping 的必要步骤。

短期可以保留 PATCH 为兼容诊断入口，但它不能改变已经存在的冲突 mapping，且不得作为正常路径。`POST /events` 在 server hook稳定后删除或限制为 test-only，避免 browser 与 hook 双写。

`useEveAgent` 仍负责当前页面中的消息流、发送请求和 continuation UX。它不再负责产品审计记录。

### 6. Inspector 不展示真正的 raw payload

UI 可以继续叫 Run Inspector，但数据层应明确命名为 normalized timeline。允许展示：

- tool 名称及脱敏输入；
- search URL、标题、score 和 usage；
- extract URL 与 content length；
- file path、hash、size；
- child task description 和 lineage；
- assistant completed message；
- failure code 和有限 message。

永不展示或持久化：

- reasoning events；
- access/refresh/ID token；
- continuation token；
- cookie、Authorization、credential、secret、environment；
- 未知 provider raw response；
- web extract 全文。

继续复用 `src/events/projector.ts`，但补齐 `turn.failed` 映射，并把 event fingerprint 建立在 projector 输出之后。

## Child Session 方案

第一阶段先保证 root stream 完整持久化。Root stream 能展示 subagent 创建和完成，但不能展示 child 内部每一步。

第二阶段有两个可选落点，默认优先复用 hook：

1. 如果 built-in child 会加载同一个 authored hook，hook 根据 `context.session.parent.rootSessionId` 查找 root run，把 child event 写入同一 `run_events`，同时记录 `source_session_id` 和 `parent_session_id`。
2. 如果 Eve 的 parent hook 不会进入 built-in child scope，则在 root 的 `subagent.called` 事件取得 `childSessionId` 后，由 server-side collector 使用服务端 auth 订阅 child durable stream，并复用同一个 projector/repository。

实现前用一个 mock subagent integration test 验证实际 hook scope，不凭文档假设。无论采用哪条路径，child event sequence 都进入同一个 run-global cursor，UI 不需要理解多个 stream cursor。

## 实施顺序

### 阶段 A：建立 server-side root projection

1. schema v4 增加 event source metadata 和 unique source key。
2. Repository 新增 `appendProjectedEvent()`，在一个写事务内完成去重、sequence 分配、event insert 和 run heartbeat。
3. Repository 新增 terminal-absorbing `advanceRunStatus()`。
4. 新增 `agent/hooks/run_inspector.ts`，先处理 root event。
5. 补齐 projector 的 `turn.failed` 与稳定 canonical serialization。
6. 保留现有 browser upload，但通过 source key 去重，先做一轮 shadow acceptance。

### 阶段 B：切换唯一写入者

1. 验证 live run 在浏览器保持打开时 hook timeline 与现有 timeline 一致。
2. 验证刷新和关闭页面后 Turso events 仍增长。
3. 删除 React `agent.events -> POST /events` effect 和 `persistedEvents` cursor。
4. 将 browser PATCH 降级为非必要的幂等 fallback，随后删除。
5. 从 model resolver 移除 `attachQueuedSession()` side effect。

### 阶段 C：child observability

1. 建立一个包含 child agent 的离线 Eve smoke。
2. 验证 hook 是否进入 child scope。
3. 按验证结果接入 child hook 或 server collector。
4. UI 按 parent/child lineage 折叠展示，不改变 run-global sequence。

### 阶段 D：后续 UI 工作

这部分不与 event durability 混在同一个 commit：

- Artifact Preview 填满 viewer 可用高度；
- Run Inspector 增加 event type filter 和 child 折叠；
- 页面不可见时降低 polling frequency；
- 需要亚秒级体验时，再把 `GET /events` 升级为 SSE。Turso 仍是 durable source of truth，SSE 只负责 delivery。

## 测试计划

### Repository tests

- 同一 `source_event_key` 重放两次只产生一行；
- 并发插入不同 event 得到唯一、单调 sequence；
- terminal run 不会被迟到的 `running` event复活；
- waiting session 的新 turn 可以回到 running；
- legacy event migration 保留原 sequence。

### Projector tests

- reasoning 和 continuation token 不持久化；
- secret-shaped nested key 继续递归脱敏；
- `turn.failed`、`session.failed` 和 `turn.cancelled` 正确改变状态；
- fingerprint 只基于脱敏后 payload，输入 key 顺序不同仍得到同一 canonical result。

### Eve integration tests

- 创建 session 后不运行任何 React 代码，Turso 仍出现 `session.started` 到 `session.waiting`；
- session 建立阶段失败时 run 进入 failed；
- mock tool call 在 Run Inspector 形成 started/completed pair；
- browser 断开后 event 和 terminal status 继续写入；
- child scope 行为有明确测试结论。

### Live acceptance

1. 从 Workbench 创建一个低成本 live run。
2. 看到首个 timeline event 后刷新页面。
3. 临时关闭 tab，等待 Agent 继续执行。
4. 重新打开页面，确认 timeline 无缺口、无重复并继续增长。
5. 最终 `session.waiting/completed/failed` 与 run status 一致。
6. 对 event payload 和数据库做 token、cookie、credential、reasoning 扫描。

## 完成标准

- 任务运行时，Run Inspector 在 2 秒内显示最新 normalized event。
- 页面从任务开始到结束始终不是 event durability 的必要组件。
- 当前 access session 下不存在因 event collector 失联而长期停留 queued/running 的 run。
- 一次包含 tool 和 subagent 的 run 无 event duplicate、sequence collision 或 terminal status regression。
- `npm run verify`、Eve smoke、Web smoke 和 browser live acceptance 全部通过。
- RFC 中 server-side projector 的描述与真实实现一致。

## 不在本次实现范围

- 展示 hidden chain-of-thought 或 encrypted reasoning；
- 保存完整 provider raw payload；
- 用 WebSocket/SSE 替换 Turso durability；
- 修复 Artifact Preview 高度；
- 将 owner-only access model 扩展为多租户。
