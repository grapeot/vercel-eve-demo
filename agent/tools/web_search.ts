import { defineTool } from "eve/tools";

import { resolveRuntimeConfig } from "../../src/config";
import {
  executeSearch,
  searchInputSchema,
  searchOutputSchema,
} from "../../src/research/search";

export default defineTool({
  description:
    "Search current web sources through Tavily. Use focused queries, inspect source quality, and extract selected URLs before relying on detailed claims.",
  inputSchema: searchInputSchema,
  outputSchema: searchOutputSchema,
  execute(input) {
    return executeSearch(input, resolveRuntimeConfig());
  },
});
