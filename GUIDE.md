# TDD Guardian workflow guide

## Setup

1. Install the plugin and start a new Codex conversation.
2. Use `/hooks` to review and trust `PreToolUse` and `Stop`.
3. Open the target repository and ask:

   ```text
   $tdd-guardian Initialize TDD Guardian for this repository.
   ```

4. Review the detected lanes and the proposed `.codex/tdd-guardian/config.json` diff.
5. Enable `enforceOnStop` or `blockCommitWithoutFreshGate` only when you want those blocks.

## Daily workflow

1. Plan the behavior:

   ```text
   $tdd-guardian Plan this change: <task>.
   ```

2. Design the test matrix:

   ```text
   $tdd-guardian Design tests for the latest TDD plan.
   ```

3. Implement one work item with red-green-refactor:

   ```text
   $tdd-guardian Implement WI-1 from the latest plan.
   ```

4. Audit coverage and test quality:

   ```text
   $tdd-guardian Audit coverage and review the current change.
   ```

5. Refresh commit-gate state before committing:

   ```text
   $tdd-guardian Run the commit gate.
   ```

6. Run push lanes only when needed:

   ```text
   $tdd-guardian Run the push gate.
   ```

## What a failed Stop gate does

On the first failure, the hook returns the lane, phase, command, test counts, and output tail to Codex as a continuation prompt. Codex gets one opportunity to fix or explain the failure. If the gate still fails when that continuation stops, the hook shows a warning and ends the turn so it cannot loop forever.

## Troubleshooting

### Hooks do not run

Open `/hooks` in a new conversation. Installed hooks remain inactive until their current definitions are trusted. A plugin update changes the hook hash and may require review again.

### Commit is blocked

Ask `$tdd-guardian` to show status, then run the commit gate. Freshness includes staged, unstaged, and untracked source changes.

### Zero tests is reported

`BOOTSTRAP` means the lane has never discovered a test. After a lane discovers tests once, zero tests means discovery regressed or tests were deleted and becomes a hard failure.

### Runner is missing

Treat this as an environment failure. Restore dependencies or the runner before editing source or tests.

### Coverage is 100% with zero lines

The guardian rejects a report with zero measurable lines outside bootstrap. Check instrumentation and `coverageSummaryPath`.

### Emergency bypass

Use the configured `TDD_GUARD_BYPASS=1` only with explicit user consent for the current operation. The bypass skips all gates and is recorded in state.
