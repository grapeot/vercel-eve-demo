import { defineTool } from "eve/tools";

import {
  currentTimeInputSchema,
  currentTimeOutputSchema,
  resolveCurrentTime,
} from "../../src/runtime/time";

export default defineTool({
  description:
    "Read the trusted app runtime clock in an IANA time zone. Use this before resolving relative dates such as today, yesterday, or the latest market session.",
  inputSchema: currentTimeInputSchema,
  outputSchema: currentTimeOutputSchema,
  execute(input) {
    return resolveCurrentTime(input);
  },
});
