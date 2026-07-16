from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("expected one request path", file=sys.stderr)
        return 2

    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    command = [
        "/workspace/.tools/tavily-venv/bin/tavily-skill",
        "search",
        request["query"],
        "--search-depth",
        request.get("depth", "advanced"),
        "--max-results",
        str(request.get("maxResults", 6)),
        "--answer",
        "off",
        "--raw-content",
        "off",
        "--no-images",
        "--stdout",
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=70)
    if result.returncode != 0:
        print(f"tavily-skill failed with exit {result.returncode}", file=sys.stderr)
        print(result.stderr.strip(), file=sys.stderr)
        return result.returncode
    sys.stdout.write(result.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
