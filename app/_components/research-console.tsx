"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useEveAgent } from "eve/react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

interface HealthConfig {
  mode: "mock" | "live";
  searchBackend: "mock" | "tavily";
  model: string;
  budgetUsd: number;
  maxSearches: number;
  credentialConfigured: boolean;
}

interface CodexStatus {
  enabled: boolean;
  connected: boolean;
  expiresAt: string | null;
  flow: "browser" | "device";
}

interface RunRow {
  id: string;
  eve_session_id: string | null;
  status: string;
  question: string;
  created_at: string;
}

interface TimelineEvent {
  id: string;
  sequence: number;
  type: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface ArtifactSummary {
  id: string;
  path: string;
  mediaType: string;
  contentHash: string;
  sizeBytes: number;
  createdAt: string;
}

interface Artifact extends ArtifactSummary {
  content: string;
}

interface ResumeState {
  sessionId?: string;
  continuationToken?: string;
  streamIndex: number;
}

interface DeviceAttempt {
  attemptId: string;
  userCode: string;
  verificationUrl: string;
  intervalSeconds: number;
}

const decisionQuestions = [
  {
    question: "Agent filesystem 什么时候应该是 source of truth，什么时候只应是 projection？",
  },
  {
    question: "Codex subscription OAuth 接入 Web research harness 的真实边界是什么？",
  },
  {
    question: "深度调研 Agent 如何把搜索过程变成可检查、可续写的知识工作？",
  },
  {
    question: "今天美国股市为什么大跌？",
    context: "美国股市",
    audience: "基础从业者",
    length: "1000-2000 字",
  },
];

async function readWaitingCursor(sessionId: string): Promise<ResumeState> {
  const response = await fetch(
    `/eve/v1/session/${encodeURIComponent(sessionId)}/stream?startIndex=-1`,
  );
  if (!response.ok || !response.body) return { sessionId, streamIndex: 0 };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const line of buffer.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as {
          type?: string;
          data?: { continuationToken?: string };
        };
        if (event.type === "session.waiting" && event.data?.continuationToken) {
          await reader.cancel();
          return {
            sessionId,
            continuationToken: event.data.continuationToken,
            streamIndex: 0,
          };
        }
      } catch {
        // A partial NDJSON line is retried with the next chunk.
      }
    }
    const finalBreak = buffer.lastIndexOf("\n");
    if (finalBreak >= 0) buffer = buffer.slice(finalBreak + 1);
  }
  return { sessionId, streamIndex: 0 };
}

export function ResearchConsole() {
  const [bootstrap, setBootstrap] = useState<{
    runs: RunRow[];
    runId: string | null;
    session: ResumeState;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/runs")
      .then((response) => response.json())
      .then(async (payload) => {
        const runs = (payload.runs ?? []) as RunRow[];
        const latest = runs[0];
        const session =
          latest?.status === "waiting" && latest.eve_session_id
            ? await readWaitingCursor(latest.eve_session_id)
            : { streamIndex: 0 };
        if (active) setBootstrap({ runs, runId: latest?.id ?? null, session });
      })
      .catch(() => {
        if (active) setBootstrap({ runs: [], runId: null, session: { streamIndex: 0 } });
      });
    return () => {
      active = false;
    };
  }, []);

  if (!bootstrap) {
    return <main className="boot-screen">Restoring the research workspace...</main>;
  }
  return (
    <Workbench
      initialRunId={bootstrap.runId}
      initialRuns={bootstrap.runs}
      initialSession={bootstrap.session}
    />
  );
}

function Workbench({
  initialRunId,
  initialRuns,
  initialSession,
}: {
  initialRunId: string | null;
  initialRuns: RunRow[];
  initialSession: ResumeState;
}) {
  const agent = useEveAgent({ initialSession });
  const [question, setQuestion] = useState(decisionQuestions[0].question);
  const [context, setContext] = useState("");
  const [audience, setAudience] = useState("技术从业者");
  const [length, setLength] = useState("2000-3000 字");
  const [health, setHealth] = useState<HealthConfig | null>(null);
  const [codex, setCodex] = useState<CodexStatus | null>(null);
  const [device, setDevice] = useState<DeviceAttempt | null>(null);
  const [runs, setRuns] = useState(initialRuns);
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [runStatus, setRunStatus] = useState<string>(initialRuns[0]?.status ?? "idle");
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [view, setView] = useState<"preview" | "source">("preview");
  const [feedback, setFeedback] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const deferredTimeline = useDeferredValue(timeline);
  const deferredContent = useDeferredValue(selectedArtifact?.content ?? "");
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const liveNeedsCodex = health?.mode === "live" && !codex?.connected;
  const currentSessionId = agent.session?.sessionId;

  async function refreshRuns() {
    const response = await fetch("/api/runs");
    if (response.ok) setRuns((await response.json()).runs as RunRow[]);
  }

  async function refreshRun(targetRunId = runId) {
    if (!targetRunId) return;
    const response = await fetch(`/api/runs/${targetRunId}`);
    if (!response.ok) return;
    const payload = await response.json();
    setTimeline(payload.events as TimelineEvent[]);
    setArtifacts(payload.artifacts as ArtifactSummary[]);
    setRunStatus(String(payload.run.status));
    const report = (payload.artifacts as ArtifactSummary[]).find(
      (artifact) => artifact.path === "report.md",
    );
    if (report && (!selectedArtifactId || selectedArtifact?.path === "report.md")) {
      setSelectedArtifactId(report.id);
    }
  }

  async function refreshCodex() {
    const response = await fetch("/api/codex/status");
    if (response.ok) setCodex((await response.json()) as CodexStatus);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([fetch("/api/health"), fetch("/api/codex/status")]).then(
      async ([healthResponse, codexResponse]) => {
        if (!active) return;
        const healthPayload = await healthResponse.json();
        if (healthPayload.ok) setHealth(healthPayload.config as HealthConfig);
        if (codexResponse.ok) setCodex((await codexResponse.json()) as CodexStatus);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!runId) return;
    const initial = window.setTimeout(() => void refreshRun(runId), 0);
    const interval = window.setInterval(() => void refreshRun(runId), busy ? 1200 : 3500);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
    // runId and busy intentionally define the polling lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, busy]);

  useEffect(() => {
    if (!selectedArtifactId || !runId) return;
    let active = true;
    void fetch(`/api/runs/${runId}/artifacts/${selectedArtifactId}`)
      .then((response) => response.json())
      .then((payload) => {
        if (active) startTransition(() => setSelectedArtifact(payload.artifact as Artifact));
      });
    return () => {
      active = false;
    };
  }, [selectedArtifactId, runId]);

  useEffect(() => {
    if (!device || codex?.connected) return;
    const interval = window.setInterval(() => {
      void fetch("/api/codex/device/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: device.attemptId }),
      }).then(async (response) => {
        if (response.ok && response.status !== 202) {
          setDevice(null);
          await refreshCodex();
        }
      });
    }, device.intervalSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [device, codex?.connected]);

  useEffect(() => {
    if (health?.mode !== "live" || codex?.flow !== "browser" || codex.connected) return;
    const interval = window.setInterval(() => void refreshCodex(), 2000);
    return () => window.clearInterval(interval);
  }, [health?.mode, codex?.flow, codex?.connected]);

  async function connectCodex() {
    setError(null);
    if (codex?.flow === "device") {
      const response = await fetch("/api/codex/device/start", { method: "POST" });
      if (!response.ok) return setError("无法启动 Codex device flow。");
      setDevice((await response.json()) as DeviceAttempt);
      return;
    }
    const response = await fetch("/api/codex/browser/start", { method: "POST" });
    if (!response.ok) return setError("无法启动 Codex browser flow；请检查 1455 端口。");
    const payload = await response.json();
    window.open(payload.authorizeUrl, "_blank", "noopener,noreferrer");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || busy || liveNeedsCodex) return;
    setError(null);
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        context,
        constraints: { audience, length },
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "无法创建 research run。");
      if (payload.runId) setRunId(payload.runId);
      return;
    }
    agent.reset();
    setRunId(payload.runId);
    setRunStatus("queued");
    setTimeline([]);
    setArtifacts([]);
    setSelectedArtifactId(null);
    await refreshRuns();
    try {
      await agent.send({
        message: [
          `研究问题：${question.trim()}`,
          `背景与使用场景：${context.trim() || "无额外背景"}`,
          `目标读者：${audience}`,
          `期望篇幅：${length}`,
          "请按 deep-research 与 external-writing skills 完成可审计调研。",
          "必须产出 report.md，并用 publish_artifacts checkpoint 最终报告与核心中间工件。",
        ].join("\n"),
      });
    } catch (sendError) {
      await fetch(`/api/runs/${payload.runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "failed" }),
      });
      setRunStatus("failed");
      await refreshRuns();
      setError(sendError instanceof Error ? sendError.message : "无法启动 research run。");
    }
  }

  async function archiveCurrentRun() {
    if (!runId) return;
    if (busy) agent.stop();
    await fetch(`/api/runs/${runId}`, { method: "DELETE" });
    agent.reset();
    setRunId(null);
    setRunStatus("idle");
    setTimeline([]);
    setArtifacts([]);
    setSelectedArtifactId(null);
    await refreshRuns();
  }

  async function sendFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const report = artifacts.find((artifact) => artifact.path === "report.md");
    if (!runId || !report || !feedback.trim() || busy) return;
    const response = await fetch(`/api/runs/${runId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifactId: report.id,
        reportContentHash: report.contentHash,
        selectedText: selectedText || undefined,
        feedbackText: feedback,
      }),
    });
    if (!response.ok) return setError("反馈对应的 report revision 已过期，请刷新后重试。");
    await agent.send({
      message: [
        "请在同一 workspace 修订 report.md。",
        selectedText ? `针对段落：${selectedText}` : "这是对整份报告的反馈。",
        `反馈：${feedback}`,
        "保留旧证据边界，完成修订后再次调用 publish_artifacts checkpoint report.md。",
      ].join("\n"),
    });
    setFeedback("");
    setSelectedText("");
  }

  const report = artifacts.find((artifact) => artifact.path === "report.md");
  const canContinue = Boolean(
    runId && report && currentSessionId && runs.find((run) => run.id === runId)?.eve_session_id === currentSessionId,
  );

  return (
    <main className="workbench-shell">
      <header className="workbench-header">
        <div>
          <p className="kicker">OWNER RESEARCH SYSTEM / EVE + CODEX</p>
          <h1>Research is a workspace, not a chat transcript.</h1>
        </div>
        <div className="system-strip">
          <span className={`signal ${busy ? "signal-live" : ""}`} />
          <div><b>{busy ? "RUNNING" : runStatus.toUpperCase()}</b><small>{health?.mode ?? "..."} · {health?.searchBackend ?? "..."}</small></div>
          <div><b>CODEX</b><small>{codex?.connected ? "connected" : "not connected"}</small></div>
        </div>
      </header>

      {health?.mode === "live" && !codex?.connected ? (
        <section className="connection-banner">
          <div><span>MODEL GATE</span><h2>Connect ChatGPT/Codex before starting research.</h2><p>This owner-only experiment stores encrypted tokens in Turso and never falls back to an API key.</p></div>
          <button onClick={() => void connectCodex()} disabled={!codex?.enabled}>Connect Codex</button>
          {device ? <div className="device-code"><a href={device.verificationUrl} target="_blank" rel="noreferrer">Open verification page</a><code>{device.userCode}</code></div> : null}
        </section>
      ) : null}

      <section className="workbench-grid">
        <aside className="brief-column">
          <div className="column-title"><span>01</span><h2>Research Brief</h2></div>
          <form onSubmit={submit}>
            <label htmlFor="question">Decision question</label>
            <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={6} maxLength={4000} disabled={busy} />
            <label htmlFor="context">Context and constraints</label>
            <textarea id="context" value={context} onChange={(event) => setContext(event.target.value)} rows={4} maxLength={8000} placeholder="What decision will this report inform?" disabled={busy} />
            <div className="two-fields">
              <div><label htmlFor="audience">Audience</label><input id="audience" value={audience} onChange={(event) => setAudience(event.target.value)} /></div>
              <div><label htmlFor="length">Length</label><input id="length" value={length} onChange={(event) => setLength(event.target.value)} /></div>
            </div>
            <button className="primary" type="submit" disabled={busy || !question.trim() || liveNeedsCodex}>{busy ? "Building evidence..." : "Start research"}</button>
          </form>
          <div className="suggestion-list"><span>QUESTION STARTERS</span>{decisionQuestions.map((item) => <button key={item.question} onClick={() => { setQuestion(item.question); setContext(item.context ?? ""); setAudience(item.audience ?? "技术从业者"); setLength(item.length ?? "2000-3000 字"); }} disabled={busy}>{item.question}</button>)}</div>
          <div className="run-history"><div className="history-heading"><span>RECENT RUNS</span>{runId ? <button onClick={() => void archiveCurrentRun()}>Archive current</button> : null}</div>{runs.map((run) => <button className={run.id === runId ? "active" : ""} key={run.id} onClick={() => { setRunId(run.id); setSelectedArtifactId(null); }}><b>{run.question}</b><small>{run.status} · {new Date(run.created_at).toLocaleDateString()}</small></button>)}</div>
        </aside>

        <section className="timeline-column">
          <div className="column-title"><span>02</span><h2>Run Inspector</h2><code>{runId ? runId.slice(0, 12) : "NO RUN"}</code></div>
          {deferredTimeline.length === 0 ? <div className="empty-state"><b>NO EVENTS</b><p>The normalized Eve timeline will show skills, tools, subagents, usage, failures, and report publication without hidden reasoning.</p></div> : <div className="timeline">{deferredTimeline.map((event) => <article key={event.id} className={`timeline-event event-${event.type.replaceAll(".", "-")}`}><time>{String(event.sequence).padStart(3, "0")}</time><div><span>{event.type}</span><p>{event.summary}</p><details><summary>Inspect payload</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></div></article>)}</div>}
          <div className="chat-log">{agent.data.messages.map((message) => { const text = message.parts.filter((part) => part.type === "text").map((part) => "text" in part ? part.text : "").join("\n"); return text ? <article key={message.id}><span>{message.role}</span><p>{text}</p></article> : null; })}{busy ? <div className="activity-line">Eve is working in the research workspace...</div> : null}</div>
          {error || agent.error ? <div className="error-box">{error ?? agent.error?.message}</div> : null}
        </section>

        <aside className="artifact-column">
          <div className="column-title"><span>03</span><h2>Artifacts</h2>{report ? <a href={`/api/runs/${runId}/artifacts/${report.id}?download=1`}>Download report</a> : null}</div>
          <nav className="file-tree">{artifacts.length === 0 ? <p>No checkpointed files yet.</p> : artifacts.map((artifact) => <button key={artifact.id} className={artifact.id === selectedArtifactId ? "active" : ""} onClick={() => setSelectedArtifactId(artifact.id)}><span>{artifact.path === "report.md" ? "◆" : "◇"}</span><b>{artifact.path}</b><small>{Math.ceil(artifact.sizeBytes / 1024)} KB</small></button>)}</nav>
          <div className="artifact-viewer">
            <div className="viewer-toolbar"><div><button className={view === "preview" ? "active" : ""} onClick={() => setView("preview")}>Preview</button><button className={view === "source" ? "active" : ""} onClick={() => setView("source")}>Source</button></div>{selectedArtifact ? <a href={`/api/runs/${runId}/artifacts/${selectedArtifact.id}?download=1`}>Download</a> : null}</div>
            {!selectedArtifact ? <div className="viewer-empty">Select an artifact to inspect it.</div> : view === "source" ? <pre className="markdown-source">{deferredContent}</pre> : <article className="markdown-preview" onMouseUp={() => { const text = window.getSelection()?.toString().trim(); if (text) setSelectedText(text.slice(0, 4000)); }}><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt, src }) => <a href={typeof src === "string" ? src : "#"} target="_blank" rel="noreferrer">[Image: {alt || "source"}]</a> }}>{deferredContent}</ReactMarkdown></article>}
          </div>
          {report ? <form className="feedback-form" onSubmit={sendFeedback}><span>CONTINUE THIS SESSION</span>{selectedText ? <blockquote>{selectedText}</blockquote> : null}<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3} placeholder="What should the next revision change?" /><button type="submit" disabled={!canContinue || busy || !feedback.trim()}>Revise report</button>{!canContinue ? <small>Select the currently resumed run to continue; historical reports remain inspectable.</small> : null}</form> : null}
        </aside>
      </section>
    </main>
  );
}
