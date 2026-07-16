# Parallel Subagent Guidance

Use child agents when at least two conditions hold: the information surface is broad, evidence questions are independently searchable, an independent judgment is valuable, or the parent needs to preserve context for synthesis.

Split by evidence responsibility rather than by arbitrary source count. Good assignments include primary-source reconstruction, independent validation, and adversarial counterevidence. Allow 30-50% overlap on the claims most likely to be wrong.

Each child receives a goal, scope, expected overlap, output path, and verification standard. Children write namespaced artifacts and return a short manifest. The parent reads and verifies those files, resolves conflicts, and owns the final judgment. Never let two children write the same file in parallel.
