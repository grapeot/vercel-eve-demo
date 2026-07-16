# web_search Contract

Input supports `query`, `depth`, `maxResults`, `topic`, optional `timeRange`, and include/exclude domain lists. Defaults are advanced depth, 6 results, and general topic. The hard result limit is 10.

The runtime always sends `include_answer=false` and `include_raw_content=false`. Output contains title, URL, excerpt, relevance score, optional publication date, and usage. An excerpt is a discovery aid, not sufficient evidence for a detailed claim.

Prefer several distinct evidence questions over many paraphrases of one query. Record why another search is necessary before spending another call.
