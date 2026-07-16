---
description: Search and extract current web evidence through the app-side Tavily typed tools without exposing credentials to the workspace.
---

# Tavily

Use `web_search` to discover sources and `web_extract` to read selected pages. Search answers are disabled; the model must compare sources and form its own conclusions.

Default to advanced search with at most 6 results. Increase to 10 only when the evidence surface is demonstrably broader. Use domain and time filters when they improve precision. Do not request raw page content through search; extract only the URLs that matter.

The tools run in the trusted app runtime. The API credential never enters the Sandbox, tool input, output, artifact, or event payload.

Read the search and extract contracts before the first live call.
