---
name: workflow
description: Orchestrate strict TDD implementation across planner, implementer, test designer, coverage auditor, mutation auditor, and reviewer roles.
---

# TDD Workflow

Use this workflow when user asks for implementation with strict TDD enforcement.

## Orchestration order

1. `tdd-planner`
   - Produce work items and acceptance criteria.
2. `tdd-test-designer`
   - Produce full edge-case/boundary/guard test matrix, with a **lane** and an assertion level per case.
3. `tdd-implementer`
   - Implement work items in small batches, verifying against the `stop` lanes only — the fast inner loop.
4. `tdd-coverage-auditor`
   - Run every lane with `coverage: "include"`, merge the reports, enforce thresholds against the merge.
5. `tdd-mutation-auditor` (if mutation gate enabled)
   - Validate test strength and report surviving mutants with the boundary test that would kill each. The implementer writes them.
6. `tdd-reviewer`
   - Findings-first final review, including the lane audit: every mocked boundary paired with an integration-lane test.

## Lanes in the workflow

The inner loop (step 3) runs only `stop` lanes. Slower lanes run once, at the end:

- Before handing back, run `$tdd-guardian gate commit` so the commit lanes are fresh.
- If the change touches anything a `push` lane covers, say so and point at `$tdd-guardian gate push`. Do not run it unprompted — it can take tens of minutes and may need services the user has not started.

## Mandatory stop conditions

1. Stop if any gate fails.
2. A lane that discovered zero tests is a failure, not a pass.
3. An environment failure (missing runner, OOM, timeout) stops the workflow and never triggers a code fix.
4. Do not commit/push until gates are green.
5. Provide a final checklist with pass/fail for each lane and each gate.

## Scope

Covers orchestration only: the order the six roles run in, which lanes run at which stage, and the stop conditions.

Each stage's own rules live elsewhere — `references/policies/policy-core/policy.md` for test quality, `references/policies/lane-policy/policy.md` for tiers, `references/policies/test-matrix/policy.md` for the matrix format, `references/policies/coverage-gate/policy.md` and `references/policies/mutation-gate/policy.md` for the gates, and `references/policies/review-gate/policy.md` for the final review.
