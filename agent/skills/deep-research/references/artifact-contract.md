# Research Artifact Contract

Create only the files the task needs, but preserve these semantics:

- `request.md`: decision question, audience, constraints, starting assumptions.
- `plan.md`: evidence questions, responsibilities, budget, stopping rule.
- `source_index.md`: source URL, title, tier, date, relevance, extraction status.
- `claim_table.md`: claim, evidence, contradiction, inference, confidence.
- `fact_check.md`: high-risk facts, numbers, quotes, dates, and verification result.
- `brainstorm_brief.md`: evidence pack for independent thesis exploration.
- `brainstorm_synthesis.md`: candidate theses, counterarguments, evidence risks.
- `writing_brief.md`: selected thesis, reader change, causal claim graph, evidence roles.
- `article_structural.md`: complete but intentionally unpolished structural draft.
- `article_qa.md`: prose candidate after independent review.
- `report.md`: final external-facing deliverable.

`report.md` is mandatory for a successful run. Do not overwrite an older report revision without first allowing the product layer to snapshot it. Child agents may share the workspace but must not write the same file concurrently.
