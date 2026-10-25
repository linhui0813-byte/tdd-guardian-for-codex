# Red receipts

Use this reference to record a failing lane before implementation, verify its test files after the lane turns green, or inspect existing receipts. Receipts are optional, local evidence. They do not prove that the named tests caused the failure, that no implementation already existed, or that preserved lines kept their meaning.

## 1. Resolve the CLI

Use the `plugin_root` from the main skill. Replace `<plugin_root>` with its absolute path and check `<plugin_root>/scripts/tdd-guardian/receipt.js` exists. Run from the project root, or pass its absolute path with `--cwd`.

## 2. Record red before implementation

Write the tests and confirm a genuine test failure first. Then run:

```bash
node '<plugin_root>/scripts/tdd-guardian/receipt.js' record --id WI-1 --lane unit
```

`record` runs the lane and fingerprints changed test files. Use `--files tests/a.test.js,tests/b.test.js` only when automatic Git discovery cannot identify the files. A missing runner, zero tests, or a green suite is not a valid red. Multiple `stop` lanes require an explicit `--lane`. A disabled project refuses receipt execution.

## 3. Verify after green

```bash
node '<plugin_root>/scripts/tdd-guardian/receipt.js' verify --id WI-1
```

Verification re-runs the recorded lane. A lane that is still red leaves its receipt `PENDING`. An unreadable specification also stays pending. Added test lines preserve separation; changing or deleting a recorded line reports `SEPARATION-BROKEN`. Report that finding and its reason rather than recording a new receipt to hide it.

| Verdict | Meaning |
|---|---|
| `SEPARATION-HELD` | Recorded lines remain present and ordered after a green run |
| `SEPARATION-BROKEN` | A recorded assertion changed, disappeared, or the recorded red was invalid |
| `PENDING` | The lane is not green or the files cannot yet be verified |
| `NOT-RECORDED` | No evidence; separation is unverified |

## 4. Inspect without running tests

```bash
node '<plugin_root>/scripts/tdd-guardian/receipt.js' show --json
```

`show` reads `.codex/tdd-guardian/receipts.json` and runs no lanes. Corrupt or unreadable receipts are reported. Receipt findings are report-only in the Stop hook; its coverage and lane gates keep their own blocking behavior.
