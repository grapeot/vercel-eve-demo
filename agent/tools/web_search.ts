import { defineTool } from "eve/tools";

import { resolveRuntimeConfig } from "../../src/config";
import {
  executeSearch,
  searchInputSchema,
  searchOutputSchema,
} from "../../src/research/search";
import { reserveResearchOperation } from "../../src/research/runtime_budget";

export default defineTool({
  description:
    "Search current web sources through Tavily. Use focused queries, inspect source quality, and extract selected URLs before relying on detailed claims.",
  inputSchema: searchInputSchema,
  outputSchema: searchOutputSchema,
  async execute(input, context) {
    const config = resolveRuntimeConfig();
    const parsedInput = searchInputSchema.parse(input);
    const reservation = await reserveResearchOperation(context, config, parsedInput.depth);
    const output = await executeSearch(parsedInput, config);
    if (reservation) {
      await reservation.usage.recordEstimatedCost(
        reservation.runId,
        output.usage.estimatedCostUsd,
      );
    }
    return output;
  },
});
