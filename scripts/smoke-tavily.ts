import { resolveRuntimeConfig } from "../src/config";
import { executeExtract } from "../src/research/extract";
import { executeSearch } from "../src/research/search";

if (process.env.RUN_LIVE_TESTS !== "1") {
  throw new Error("Tavily smoke requires RUN_LIVE_TESTS=1");
}

const config = resolveRuntimeConfig();
const search = await executeSearch(
  {
    query: "Tavily API official documentation search extract",
    includeDomains: ["docs.tavily.com"],
    maxResults: 2,
  },
  config,
);
if (search.backend !== "tavily" || search.sources.length === 0) {
  throw new Error("Tavily search returned no usable sources");
}

const extract = await executeExtract(
  { urls: [search.sources[0].url], depth: "basic" },
  config,
);
if (extract.backend !== "tavily" || extract.results.length === 0) {
  throw new Error("Tavily extract returned no usable content");
}

process.stdout.write(
  `Tavily runtime smoke passed: ${search.sources.length} sources, ${extract.results.length} extracts.\n`,
);
