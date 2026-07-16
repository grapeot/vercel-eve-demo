---
description: Turn a verified evidence pack into one thesis-led external-facing Chinese report through three fresh, sequential writing passes.
---

# External Writing

Load this skill only after research and fact checking are stable. The target is a natural Chinese analysis for an intelligent reader without shared context, not a research log or textbook.

## Thesis Gate

Read the Thesis Catalog for inspiration, never as a template. Write at least two falsifiable thesis candidates with counterarguments and evidence risks. Select one thesis. In `writing_brief.md`, specify the reader's starting belief, target belief change, 3-7 causal claims, evidence role for each claim, concept introduction order, and the concrete observation that should open the report.

## Three Sequential Passes

1. Create a fresh child agent for `article_structural.md`. It solves claim dependency, evidence placement, concept introduction, and reader path. It does not optimize prose.
2. After pass 1 finishes, create a second fresh child. It reads the brief, evidence artifacts, structural draft, prose rules, and voice samples, then rewrites from a blank page into natural Chinese. It must not polish the structural draft sentence by sentence.
3. After pass 2 finishes, create a third fresh child for independent QA. It checks comprehension, cognitive comfort, unsupported new claims, links, numbers, title/lead contract, textbook tone, and performative colloquialism. It writes `article_qa.md` plus a short QA record.

The root agent then verifies invariants against the evidence pack and writes `report.md`. All three children use fresh history and exchange information only through workspace files. They run sequentially and never write the same file.

No pass may publish externally, generate images, invoke another provider, or change the selected thesis without returning to the brief.
