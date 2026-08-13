# TDD Guardian for Codex

[![tests 172 passing](https://img.shields.io/badge/tests-172%20passing-success)](https://github.com/linhui0813-byte/tdd-guardian-for-codex/actions)
[![Codex plugin](https://img.shields.io/badge/Codex-plugin-111827)](https://learn.chatgpt.com/docs/build-plugins)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue)](LICENSE)

A Codex-native port of [xiaolai/tdd-guardian-for-claude](https://github.com/xiaolai/tdd-guardian-for-claude). It enforces strict test-driven development across unit, integration, end-to-end, and contract-test lanes.

## What changed for Codex

- `.codex-plugin/plugin.json` and a self-contained Codex marketplace replace the Claude manifest and marketplace.
- A routed `$tdd-guardian` skill replaces Claude-only slash commands and packaged agents.
- Codex `PreToolUse` guards commit, push, pull-request, and package-publish commands.
- Codex `Stop` replaces Claude's `TaskCompleted` gate.
- `Stop` continuation is capped: one automatic continuation, then a visible warning instead of an infinite loop.
- Project configuration and state live under `.codex/tdd-guardian/`.

The coverage engine, lane freshness model, zero-test ratchet, environment-failure classification, and nine coverage formats come from the upstream implementation and remain regression-tested.

## Install

```bash
codex plugin marketplace add linhui0813-byte/tdd-guardian-for-codex --ref main
codex plugin add tdd-guardian-for-codex@linhui-tdd-guardian
```

Start a new Codex conversation after installation. Open `/hooks`, review the two plugin hooks, and trust them before expecting enforcement.

## Initialize a project

Invoke the installed skill in the repository:

```text
$tdd-guardian Initialize TDD Guardian for this repository.
```

Initialization inspects CI first, probes proposed commands without running full suites, shows the config diff, and writes `.codex/tdd-guardian/config.json` only after confirmation. The per-machine state file `.codex/tdd-guardian/state.json` is added to `.gitignore`.

Both blocking switches default to off:

```json
{
  "schemaVersion": 2,
  "enabled": true,
  "enforceOnStop": false,
  "blockCommitWithoutFreshGate": false,
  "staleGateAction": "deny",
  "gateFreshnessMinutes": 120,
  "smartStaleness": true,
  "bypassEnv": "TDD_GUARD_BYPASS",
  "preflightCommand": "",
  "lanes": [
    {
      "name": "unit",
      "description": "In-process tests with no external services.",
      "command": "pnpm exec vitest run --coverage",
      "gateOn": ["stop", "commit"],
      "coverage": "include",
      "coverageSummaryPath": "coverage/coverage-summary.json",
      "probeCommand": "pnpm exec vitest list",
      "timeoutMs": 600000
    }
  ],
  "coverageThresholds": {
    "lines": 100,
    "functions": 100,
    "branches": 100,
    "statements": 100
  },
  "coverageMode": "absolute",
  "requireMutation": false,
  "mutationCommand": "",
  "mutationGateOn": ["stop"]
}
```

## Common prompts

```text
$tdd-guardian Probe the configured test lanes without running the suites.
$tdd-guardian Run the commit gate and explain any failure.
$tdd-guardian Show gate status and freshness.
$tdd-guardian Plan and implement this change with red-green-refactor: <task>.
$tdd-guardian Audit coverage, then review test quality.
```

## Gate model

| Trigger | Behavior |
|---|---|
| `stop` | Runs fast lanes at the end of a Codex turn when `enforceOnStop` is true |
| `commit` | Requires fresh commit lanes before `git commit` when commit blocking is true |
| `push` | Requires both commit and push lanes before push, PR creation/merge, or publishing |
| `manual` | Runs only when requested through `$tdd-guardian` |

An uninitialized project is silent. A lane with no historical tests is visibly `BOOTSTRAP`; after it discovers a test once, a future zero-test run is a hard failure.

## Coverage and languages

Parsers support Istanbul summary, Istanbul final, coverage.py, LCOV, Cobertura, JaCoCo, Go cover profiles, Clover, and SimpleCov. The bundled tooling catalog covers JavaScript/TypeScript, Python, JVM languages, .NET, Go, Rust, native toolchains, Ruby/PHP/Perl/Lua, Elixir/Erlang, Haskell/OCaml, Dart/Flutter, R, Julia, shell, and common end-to-end tools.

## Development

Requirements: Node.js 18+ and a Codex release with plugin hooks. This port is tested locally against `codex-cli 0.147.0`.

```bash
node --test
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
python3 /path/to/skill-creator/scripts/quick_validate.py skills/tdd-guardian
```

CI runs the test suite on Node.js 18, 20, 22, and 24, rejects zero-test or skipped runs, validates JSON, and smoke-tests both hook scripts.

## Upstream tracking

The `upstream update` GitHub Actions workflow checks [the original Claude repository](https://github.com/xiaolai/tdd-guardian-for-claude) every day at 08:00 in the `Asia/Shanghai` timezone. It compares both the manifest version and the full `main` commit SHA against `upstream.lock.json`.

When either value changes, the workflow opens or updates a review pull request containing the exact old and new versions, commits, and upstream comparison link. It updates provenance only: upstream Claude files are never copied mechanically, and the workflow never auto-merges, installs, or publishes.

## Provenance and license

Based on TDD Guardian for Claude `0.8.1`, upstream commit `0b0bb40f0e560438a17f0742be72d846df140540`. Original work copyright © 2026 Xiaolai Li. Codex port maintained by `linhui0813-byte` under the same [ISC License](LICENSE).
