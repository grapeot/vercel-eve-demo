FROM python:3.13-slim

ARG TAVILY_SKILL_REF=67db8f92b799ddd1af457dd3694f9064a0653538

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | sh

ENV PATH="/root/.local/bin:/opt/tavily-venv/bin:${PATH}"

RUN git clone https://github.com/grapeot/tavily-skill.git /opt/tavily-skill \
    && cd /opt/tavily-skill \
    && git checkout "${TAVILY_SKILL_REF}" \
    && uv venv /opt/tavily-venv \
    && uv pip install --python /opt/tavily-venv/bin/python . \
    && tavily-skill --help >/dev/null

WORKDIR /workspace

CMD ["sleep", "infinity"]
