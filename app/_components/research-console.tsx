"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useEveAgent } from "eve/react";

interface HealthConfig {
  mode: "mock" | "live";
  searchBackend: "mock" | "tavily";
  model: string;
  budgetUsd: number;
  maxSearches: number;
  credentialConfigured: boolean;
}

const statusCopy = {
  ready: "等待问题",
  submitted: "已提交",
  streaming: "调研中",
  error: "运行失败",
} as const;

const suggestions = [
  "Vercel eve 与普通 serverless function 的状态模型有什么差别？",
  "为什么 Markdown + CLI skill 可以跨 Agent harness 复用？",
  "一个 deep research Agent 最容易在哪些地方产生不可审计成本？",
];

function textFromParts(parts: readonly { type: string; text?: string }[]) {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

export function ResearchConsole() {
  const agent = useEveAgent();
  const [question, setQuestion] = useState(suggestions[0]);
  const [context, setContext] = useState("");
  const [depth, setDepth] = useState("standard");
  const [health, setHealth] = useState<HealthConfig | null>(null);
  const busy = agent.status === "submitted" || agent.status === "streaming";

  useEffect(() => {
    let active = true;
    void fetch("/api/health")
      .then((response) => response.json())
      .then((payload) => {
        if (active && payload.ok) setHealth(payload.config as HealthConfig);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    const message = [
      `研究问题：${question.trim()}`,
      `研究深度：${depth}`,
      context.trim() ? `补充背景：${context.trim()}` : "补充背景：无",
      "请先加载 deep-research skill，再决定是否搜索。最终用中文输出，并报告搜索 usage。",
    ].join("\n");
    void agent.send({ message });
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="kicker">VERCEL EVE · PORTABLE SKILLS · 01</p>
          <h1>深度调研，不从空白 prompt 开始。</h1>
          <p className="dek">
            同一份 Markdown 方法论，同一个搜索能力，换一个 Agent harness 继续运行。
          </p>
        </div>
        <div className="status-card" aria-label="运行状态">
          <span className={`status-dot status-${agent.status}`} />
          <div>
            <strong>{statusCopy[agent.status]}</strong>
            <small>{health ? `${health.mode} / ${health.searchBackend}` : "读取配置中"}</small>
          </div>
        </div>
      </header>

      <section className="workspace">
        <form className="brief-panel" onSubmit={submit}>
          <div className="section-label">01 / RESEARCH BRIEF</div>
          <label htmlFor="question">你真正需要判断什么？</label>
          <textarea
            id="question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={5}
            maxLength={1200}
            disabled={busy}
          />

          <label htmlFor="context">背景与边界（可选）</label>
          <textarea
            id="context"
            value={context}
            onChange={(event) => setContext(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="例如：重点比较 credential、状态恢复和成本。"
            disabled={busy}
          />

          <div className="field-row">
            <div>
              <label htmlFor="depth">研究深度</label>
              <select
                id="depth"
                value={depth}
                onChange={(event) => setDepth(event.target.value)}
                disabled={busy}
              >
                <option value="quick">快速扫描</option>
                <option value="standard">标准调研</option>
                <option value="deep">深入验证</option>
              </select>
            </div>
            <div className="budget-note">
              <span>预算上限</span>
              <strong>${health?.budgetUsd ?? 2}</strong>
            </div>
          </div>

          <button className="primary" type="submit" disabled={busy || !question.trim()}>
            {busy ? "正在建立证据链…" : "开始调研"}
          </button>

          <div className="suggestions">
            <span>试一个问题</span>
            {suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => setQuestion(suggestion)}
                disabled={busy}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </form>

        <section className="run-panel" aria-live="polite">
          <div className="run-heading">
            <div>
              <div className="section-label">02 / DURABLE RUN</div>
              <h2>研究记录</h2>
            </div>
            <div className="run-actions">
              {busy ? (
                <button type="button" onClick={() => agent.stop()}>
                  停止
                </button>
              ) : null}
              {agent.data.messages.length > 0 ? (
                <button type="button" onClick={() => agent.reset()}>
                  新任务
                </button>
              ) : null}
            </div>
          </div>

          {agent.data.messages.length === 0 ? (
            <div className="empty-run">
              <span>RUN_000</span>
              <p>提交后，这里会显示 durable session 中的用户问题、tool call 和最终报告。</p>
              <ul>
                <li>默认 mock 不访问任何付费 API</li>
                <li>live 必须显式开启并配置 credential</li>
                <li>Production auth 默认关闭公网访问</li>
              </ul>
            </div>
          ) : (
            <div className="messages">
              {agent.data.messages.map((message) => {
                const text = textFromParts(message.parts);
                if (!text) return null;
                return (
                  <article className={`message message-${message.role}`} key={message.id}>
                    <span>{message.role === "user" ? "BRIEF" : "REPORT"}</span>
                    <pre>{text}</pre>
                  </article>
                );
              })}
              {busy ? <div className="pulse-line">Agent 正在读取 skill 与证据…</div> : null}
              {agent.error ? <div className="error-box">{agent.error.message}</div> : null}
            </div>
          )}

          <footer className="run-meta">
            <span>SESSION</span>
            <code>{agent.session?.sessionId ?? "尚未创建"}</code>
            <span>MODEL</span>
            <code>{health?.model ?? "读取中"}</code>
          </footer>
        </section>
      </section>
    </main>
  );
}
