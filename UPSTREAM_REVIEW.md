# Upstream review for Codex port 0.2.0

Reviewed source: `xiaolai/tdd-guardian-for-claude` version `0.10.2`, commit `188ee8c9df5682a0dad37d35444e40fcbe0bb8f8` (2026-10-01).

The prior review tracked `0.9.0` at `4e6e3c20069125e6d81cc7ca7227876e3911f1b4`; port `0.1.1` included its fail-loud Stop fixes but deferred the additive specification features. This upgrade includes those features, together with the later upstream workflow and permission-warning corrections.

| Boundary | Result |
|---|---|
| Critical paths | Port config validation, per-glob coverage, per-path mutation requirements, workspace-aware line unions, and per-metric approximation reporting. Unmatched globs, missing per-file data, and inexact dimensions cannot satisfy configured strict thresholds. |
| Red receipts | Port the optional CLI and verification library with Codex-local storage, path containment, atomic writes, bounded locking, red classification, and report-only findings. Preserve the documented limits of the evidence. |
| Test design | Port S1-S6 specification levels and the read-only specification adversary before implementation. `requireSpecLevel` remains a designer/reviewer requirement, not a hook verdict. |
| Progressive references | Adapt the upstream Codex procedures into this port's existing single-skill reference tree. Resolve all commands from the plugin root and verify shipped reference targets. |
| Permission warning | Retain this port's existing neutral `staleGateAction: warn`: no `permissionDecision: allow` is emitted. |
| State and hooks | Preserve `.codex/tdd-guardian/`, native Stop flags and legacy aliases, the opt-in Stop hook, one automatic continuation, and the crash-safe coverage wrapper. |
| Upstream Codex layout | Intentional difference: keep the existing single `$tdd-guardian` interface rather than installing upstream's separate skills, shared `.claude` state, or removal of the Stop hook. |
| Tracking | Keep the daily 08:00 Asia/Shanghai workflow review-only. Its lock-file PR still does not prove that feature code was ported. This review and the code/tests document the adaptation. |

Validation: the original 178-test suite passed before changes. New critical-path tests failed against the old engine (38 failures), then passed after adaptation. The complete upgraded package has 321 passing tests with zero skips, including existing Codex continuation and migration regressions, upstream critical-path/receipt cases, and reference/default checks. Skill validation, JSON parsing, script syntax, and hook fixture checks are separate package gates. Project installation preserves each project's config and state; it does not assert that the projects' application tests have been rerun.
