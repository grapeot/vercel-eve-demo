# Tavily CLI Sandbox Image

这个可选 image 证明同一个 `tavily-skill` repo 可以 pin 到固定 commit 并安装进 Linux Sandbox，而不依赖 OpenCode。实际 Eve runtime 在 `agent/sandbox/sandbox.ts` 的 template bootstrap 中安装同一 commit，因此本地 Docker 与 Vercel Sandbox 使用相同 CLI contract。

```bash
docker build -t vercel-eve-demo-tavily ./sandbox
docker run --rm vercel-eve-demo-tavily tavily-skill --help
```

镜像不包含 credential。不要用 `ENV` 或 build arg 写入真实 key。Vercel部署通过 firewall credential brokering 注入 Tavily Authorization header；本地 Docker env 仅用于单用户 smoke，且模型的 built-in `bash` 已禁用。
