import { defineSandbox } from "eve/sandbox";
import { docker } from "eve/sandbox/docker";
import { vercel } from "eve/sandbox/vercel";

import { resolveRuntimeConfig } from "../../src/config";

const TAVILY_SKILL_REF = "67db8f92b799ddd1af457dd3694f9064a0653538";
const config = resolveRuntimeConfig();
const liveCli = config.searchBackend === "tavily";

const installCommand = `set -euo pipefail
mkdir -p /workspace/.tools/bin
git clone https://github.com/grapeot/tavily-skill.git /workspace/.tools/tavily-skill
git -C /workspace/.tools/tavily-skill checkout ${TAVILY_SKILL_REF}
curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/workspace/.tools/bin sh
/workspace/.tools/bin/uv venv /workspace/.tools/tavily-venv
/workspace/.tools/bin/uv pip install --python /workspace/.tools/tavily-venv/bin/python /workspace/.tools/tavily-skill`;

function networkPolicy() {
  if (!config.tavilyApiKey) throw new Error("Tavily CLI sandbox 缺少 credential");
  return {
    allow: {
      "api.tavily.com": [
        {
          transform: [
            {
              headers: {
                Authorization: `Bearer ${config.tavilyApiKey}`,
              },
            },
          ],
        },
      ],
    },
  };
}

const definition = !liveCli
  ? defineSandbox({ backend: docker() })
  : process.env.VERCEL
    ? defineSandbox({
        backend: vercel({ env: { TAVILY_API_KEY: "credential-brokered" } }),
        revalidationKey: () => `tavily-cli-${TAVILY_SKILL_REF}`,
        async bootstrap({ use: getSandbox }) {
          const sandbox = await getSandbox();
          await sandbox.run({ command: installCommand });
        },
        async onSession({ use: getSandbox }) {
          await getSandbox({ networkPolicy: networkPolicy() });
        },
      })
    : defineSandbox({
        backend: docker({
          env: { TAVILY_API_KEY: config.tavilyApiKey ?? "" },
          networkPolicy: "allow-all",
        }),
        revalidationKey: () => `tavily-cli-${TAVILY_SKILL_REF}`,
        async bootstrap({ use: getSandbox }) {
          const sandbox = await getSandbox();
          await sandbox.run({ command: installCommand });
        },
      });

export default definition;
