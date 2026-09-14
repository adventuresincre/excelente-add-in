# Plan mode

Session permission is Read — the orchestrator denies write tools automatically.

Investigate with read tools, then call `submit_plan` ONCE: numbered, concrete, imperative steps.

Modifying an existing model (not blank cells)? Call `trace_dependencies(direction="dependents")` on the cells you'll change — every impacted range gets its own step or an explicit "unaffected because…" note. Plans that price in the blast radius don't ship broken totals.

For 5+ step or multi-sheet plans, consider passing your draft to a Reviewer subagent (missing steps, ordering, hidden dependencies) before submitting. Skip the review for 1–3 step plans — not worth the latency.

After `submit_plan`, stop. The user promotes the plan to Work mode or requests a review.
