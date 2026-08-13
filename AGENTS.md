# TDD Guardian for Codex

## Build and test

- Run the full test suite with `node --test` from the repository root.
- Validate the plugin with the plugin-creator validator.
- Validate `skills/tdd-guardian/` with the skill-creator validator.
- Parse every committed JSON file before committing.

## Architecture

- `.codex-plugin/plugin.json` is the Codex plugin manifest.
- `.agents/plugins/marketplace.json` is the self-contained public marketplace.
- `hooks/hooks.json` registers Codex `PreToolUse` and `Stop` hooks.
- `scripts/tdd-guardian/` contains deterministic gate code. Put reusable gate logic in `lib/`.
- `scripts/upstream/check.js` validates and tracks the original repository's manifest version and full `main` commit.
- `upstream.lock.json` is reviewed provenance. Change it only through a verified upstream snapshot or an explicitly reviewed manual update.
- `skills/tdd-guardian/SKILL.md` routes natural-language operations to progressive references.
- `config/config.json` is the project configuration template.
- `tests/` drives hook scripts with the same JSON-on-stdin contract Codex uses.

## Repository expectations

- Preserve the fail-loud invariants documented in `skills/tdd-guardian/SKILL.md`.
- Add or update a regression test for every hook or `lib/` behavior change.
- Keep hooks silent for repositories without `.codex/tdd-guardian/config.json`.
- Use Codex-native event names and payloads. `Stop` replaces Claude's `TaskCompleted` event.
- Prevent repeated `Stop` failures from creating an infinite continuation loop.
- Keep version values synchronized between the plugin manifest, README, and release notes.
- Keep the upstream updater review-only: it may open a pull request, but it must never auto-merge, install, publish, or mechanically overwrite the Codex port.
- Preserve the upstream ISC license and attribution to Xiaolai Li.
