#!/usr/bin/env node
"use strict";
// Stop hook — runs every lane bound to the stop trigger, then
// the coverage and mutation gates.
//
// A first failure continues the turn with a model-visible prompt. If that
// continuation also fails, report the failure without creating an infinite loop.

const fs = require("fs");

const configLib = require("./lib/config");
const lanesLib = require("./lib/lanes");
const coverageLib = require("./lib/coverage");
const exec = require("./lib/exec");
const verification = require("./lib/verification");

const MAX_CONTEXT_CHARS = 8000;

function reportFailure(reason, context, stopHookActive) {
  const details = String(context || "").slice(-MAX_CONTEXT_CHARS);
  const message = [reason, details].filter(Boolean).join("\n\n");

  if (stopHookActive) {
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage:
          "TDD Guardian gates are still failing after one automatic continuation. " +
          "The turn is stopping to avoid a continuation loop.\n\n" +
          message,
      })
    );
    return;
  }

  console.log(JSON.stringify({ decision: "block", reason: message }));
}

function readPayload() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function laneFailureReport(lane, result) {
  const lines = [`Lane '${lane.name}' failed at the ${result.phase} phase (status: ${result.status}).`, ""];

  if (result.phase === "setup") {
    lines.push(`Setup command: ${lane.setupCommand}`);
  } else if (result.phase === "coverage-report") {
    lines.push(result.coverageError || `Coverage report command: ${lane.coverageReportCommand}`);
  } else {
    lines.push(`Command: ${lane.command}`);
  }

  if (result.exitCode !== null) lines.push(`Exit code: ${result.exitCode}`);
  if (result.testCounts) {
    const c = result.testCounts;
    lines.push(`Tests: ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped, ${c.total} total`);
  }

  if (exec.isEnvironmentFailure(result.status)) {
    lines.push("", "This is an environment failure, not a test failure. Fix the runner before changing code or tests.");
  }
  if (result.status === "no-tests") {
    lines.push(
      "",
      "The runner discovered zero tests, and this lane HAS had tests before — so this is a regression, not a greenfield state.",
      "Either the tests were deleted, or test discovery broke (a moved directory, a changed glob, a renamed config).",
      "Ask Codex to use $tdd-guardian to probe what the lane currently discovers."
    );
  }
  if (result.status === "timeout") {
    lines.push("", `The lane exceeded its ${Math.round(lane.timeoutMs / 1000)}s timeout. Raise lane.timeoutMs, or move this suite to the push trigger.`);
  }

  if (result.stdoutTail) lines.push("", "--- stdout (tail) ---", result.stdoutTail);
  if (result.stderrTail) lines.push("", "--- stderr (tail) ---", result.stderrTail);
  if (result.teardownWarning) lines.push("", result.teardownWarning);

  return lines.join("\n");
}

function runCoverageGate(config, laneResults, state, cwd, bootstrapLanes, coverageLanes) {
  const reports = laneResults.filter((r) => r.coverageReport).map((r) => r.coverageReport);

  // The bootstrap exemption belongs to the lanes that were supposed to MEASURE
  // something, not to any lane at all. A brand-new e2e lane in bootstrap used to
  // exempt the whole coverage gate, so a mature unit lane's critical paths were
  // never evaluated.
  //
  // With no coverage-contributing lane at all, the exemption falls back to "every
  // lane that ran is in bootstrap" — the genuine greenfield state, where nothing
  // has been verified yet and there is nothing to measure.
  const expected = coverageLanes || [];
  const inBootstrap = expected.length
    ? expected.every((name) => bootstrapLanes.includes(name))
    : bootstrapLanes.length > 0 && bootstrapLanes.length === laneResults.length;

  // A coverage lane that ran and produced no report leaves the merge incomplete.
  // Passing on a subset silently understates — or overstates — every threshold.
  const missing = expected.filter((name) => !bootstrapLanes.includes(name) && !laneResults.some((r) => r.name === name && r.coverageReport));

  if (reports.length === 0) {
    // A critical path can demand coverage the repo-wide thresholds do not: global
    // bars at 0 with `src/payments/**` at 100 is a legitimate legacy-repo setup.
    // Deciding this from the global thresholds alone let that configuration skip
    // the gate entirely and report success, with the strict bar never evaluated.
    const wantsCoverage =
      Object.values(config.coverageThresholds).some((v) => Number(v) > 0) ||
      (config.criticalPaths || []).some((p) => Object.values(p.thresholds || {}).some((v) => Number(v) > 0));
    if (!wantsCoverage) return { ok: true, message: "Coverage gate skipped (all thresholds are 0).", record: null };
    // A lane with no tests yet produces no coverage. That is the greenfield state,
    // not a misconfiguration.
    if (inBootstrap) {
      return {
        ok: true,
        message: `Coverage gate skipped — ${bootstrapLanes.join(", ")} has no tests yet, so there is nothing to measure.`,
        record: null,
      };
    }
    return {
      ok: false,
      message:
        "Coverage thresholds are set but no lane produced a coverage report.\n" +
        'Set coverage:"include" and coverageSummaryPath on the lane that emits coverage, or set all thresholds to 0.',
      record: null,
    };
  }

  const wantsEnforcement =
    Object.values(config.coverageThresholds).some((v) => Number(v) > 0) ||
    (config.criticalPaths || []).some((p) => Object.values(p.thresholds || {}).some((v) => Number(v) > 0)) ||
    (config.criticalPaths || []).length > 0;

  if (missing.length && wantsEnforcement) {
    return {
      ok: false,
      message:
        `Coverage is enforced, but ${missing.length} lane(s) with coverage:"include" produced no report: ${missing.join(", ")}.\n` +
        `The merge would cover only part of the project, so every threshold below it would be measured against a subset. ` +
        `Fix the lane, or set coverage:"none" on it if it is not meant to contribute.`,
      record: null,
    };
  }

  const merged = coverageLib.mergeReports(reports, cwd);

  // A report that measured nothing scores 100% under the 0/0 convention. Passing
  // on that would turn a silent no-op coverage run into a green gate — unless the
  // lane genuinely has no tests yet, which the bootstrap ratchet distinguishes.
  if (coverageLib.isEmpty(merged.totals)) {
    if (inBootstrap) {
      return {
        ok: true,
        message: `Coverage gate skipped — ${bootstrapLanes.join(", ")} has no tests yet, so the report is empty.`,
        record: null,
      };
    }
    return {
      ok: false,
      message:
        "Coverage report contains zero measurable lines. The coverage run almost certainly produced nothing.\n" +
        `Formats read: ${merged.formats.join(", ")}. Check that the coverage command instruments your source and writes to coverageSummaryPath.`,
      record: null,
    };
  }

  const percentages = coverageLib.totalsToPercentages(merged.totals);
  const record = {
    timestamp: new Date().toISOString(),
    method: merged.method,
    formats: merged.formats,
    approximate: merged.approximate,
    totals: percentages,
  };

  const notes = [];
  if (merged.approximate) {
    notes.push(
      `NOTE: coverage from ${merged.formats.length} lanes was combined as a weighted average, not a true union, ` +
        `because at least one report lacks per-line detail (${merged.formats.join(", ")}). ` +
        `Lines covered by more than one lane are counted more than once. Emit LCOV or Cobertura from every lane for an exact merge.`
    );
  }

  // Critical paths are absolute bars in both coverage modes: they express how
  // expensive the code is to get wrong, which a moving baseline cannot express.
  const critical = coverageLib.evaluateCriticalPaths(merged, config.criticalPaths, config.coverageThresholds);
  if (critical.results.length) record.criticalPaths = critical.results;
  const criticalNotes = critical.warnings.map((w) => "WARNING: " + w);
  // The gate log is only surfaced when the hook blocks. A glob enforcing nothing
  // is exactly the kind of finding that must not wait for an unrelated failure to
  // become visible, so it goes to stderr on every run.
  for (const warning of critical.warnings) console.error(`[tdd-guardian] ${warning}`);
  const criticalFailure = critical.ok ? null : "Critical-path coverage failed: " + critical.failures.join("; ");

  if (String(config.coverageMode) === "no-decrease") {
    const branch = lanesLib.currentBranch(cwd) || "unknown";
    const baseline = state.baseline;

    if (!baseline || !baseline.coverage || baseline.branch !== branch) {
      record.status = criticalFailure ? "FAIL" : "BASELINE";
      return {
        ok: !criticalFailure,
        message: [
          criticalFailure || `Coverage baseline recorded for branch '${branch}': ${describeTotals(percentages)}`,
          ...notes,
          ...criticalNotes,
        ].join("\n"),
        record,
        // A failing critical path must not bank a baseline — that would freeze the
        // failure in as the new normal.
        newBaseline: criticalFailure ? null : { branch, recorded_at: new Date().toISOString(), coverage: percentages },
      };
    }

    const cmp = coverageLib.compareToBaseline(merged.totals, baseline.coverage);
    const ok = cmp.ok && !criticalFailure;
    record.status = ok ? "PASS" : "FAIL";
    return {
      ok,
      message: [
        ok
          ? `Coverage gate passed (no decrease from baseline): ${cmp.summary}`
          : [cmp.ok ? null : "Coverage decreased from baseline: " + cmp.failures.join("; "), criticalFailure].filter(Boolean).join("\n"),
        ...notes,
        ...criticalNotes,
      ].join("\n"),
      record,
    };
  }

  const cmp = coverageLib.compareToThresholds(merged.totals, config.coverageThresholds);
  const ok = cmp.ok && !criticalFailure;
  record.status = ok ? "PASS" : "FAIL";
  const warnings = cmp.warnings.length || criticalNotes.length ? ["", ...cmp.warnings.map((w) => "WARNING: " + w), ...criticalNotes] : [];

  return {
    ok,
    message: [
      ok
        ? `Coverage gate passed: ${cmp.summary}${describeCriticalResults(critical.results)}`
        : [cmp.ok ? null : "Coverage gate failed: " + cmp.failures.join("; "), criticalFailure].filter(Boolean).join("\n"),
      ...notes,
      ...warnings,
    ].join("\n"),
    record,
  };
}

/**
 * Verify any recorded red receipts and append findings to the gate log.
 *
 * A receipt store that cannot be written is reported and otherwise ignored — a
 * bookkeeping failure must not take down a gate that is otherwise green.
 */
function reportSeparation(cwd, log, greenLanes) {
  const loaded = verification.loadReceipts(cwd);

  // A corrupt or unreadable store is reported, never silently treated as "no
  // receipts". Erasing the evidence and carrying on green is the failure mode this
  // whole module exists to catch, applied to its own bookkeeping.
  if (loaded.error) {
    console.error(`[tdd-guardian] ${loaded.error}`);
    log.push(`Red receipts could not be read: ${loaded.error}`);
    return;
  }
  for (const problem of loaded.problems) console.error(`[tdd-guardian] ${problem}`);

  const store = loaded.store;
  if (store.receipts.length === 0) return;

  // Only lanes that just passed can settle a receipt. A receipt for a lane that
  // did not run — or ran red — stays open rather than banking a verdict about a
  // transition that has not happened.
  let verified;
  let reports;
  try {
    ({ store: verified, reports } = verification.verifyAll(store, cwd, { greenLanes }));
  } catch (err) {
    // Report-only means report-only: a bug in receipt verification must not fail
    // a gate whose lanes and coverage both passed.
    console.error(`[tdd-guardian] Red-receipt verification failed: ${err && err.message ? err.message : String(err)}`);
    log.push(`Red-receipt verification could not run: ${err && err.message ? err.message : String(err)}`);
    return;
  }

  try {
    // Under the same lock the CLI uses — otherwise a concurrent `receipt record`
    // and this hook can each save a store missing the other's receipt.
    verification.updateReceipts(cwd, (fresh) =>
      verified.receipts.reduce((acc, receipt) => verification.upsertReceipt(acc, receipt), fresh.store)
    );
  } catch (err) {
    console.error(`[tdd-guardian] Could not update red receipts: ${err.message}`);
  }

  const lines = verification.describeReports(reports);
  if (lines.length === 0) {
    // Only the receipts settled on THIS run are worth announcing. Naming settled
    // ones every time would print the same line after every task forever.
    const held = reports.filter((r) => !r.settled && !r.pending).map((r) => r.id);
    if (held.length === 0) return;
    console.error(`[tdd-guardian] Specification held for ${held.join(", ")} — no recorded test file changed between red and green.`);
    return;
  }

  log.push(["Specification-implementation separation:", ...lines].join("\n"));
  for (const line of lines) console.error(`[tdd-guardian] ${line}`);
}

/**
 * Is the mutation gate required, and by what?
 *
 * `requireMutation` exists at two levels: the repo-wide switch and each
 * criticalPaths entry. Either one is sufficient — a config that sets it only on
 * `src/payments/**` is asking for mutation testing, and reading only the global
 * flag would accept that config and then never run the command.
 */
function mutationRequirement(config) {
  if (config.requireMutation) return { required: true, reason: "requireMutation is true" };
  const paths = (config.criticalPaths || []).filter((p) => p.requireMutation).map((p) => p.glob);
  if (paths.length) return { required: true, reason: `required by criticalPaths: ${paths.join(", ")}` };
  return { required: false, reason: "" };
}

/**
 * Summarise critical-path results for a passing gate.
 *
 * A glob matching zero files is reported separately and never counted as checked:
 * the feature's own rule is that a rule enforcing nothing must not read as
 * enforced, and "3 critical path(s) checked" when one matched nothing says the
 * opposite.
 */
function describeCriticalResults(results) {
  if (!results || results.length === 0) return "";
  const checked = results.filter((r) => r.matchedFiles > 0).length;
  const unmatched = results.filter((r) => r.matchedFiles === 0).map((r) => r.glob);
  const parts = [`${checked} critical path(s) checked`];
  if (unmatched.length) parts.push(`${unmatched.length} matched nothing: ${unmatched.join(", ")}`);
  return ` (${parts.join("; ")})`;
}

/** Convert a coverage exception into a failed gate instead of silent approval. */
function runCoverageGateSafely(config, laneResults, state, cwd, bootstrapLanes, coverageLanes) {
  try {
    return runCoverageGate(config, laneResults, state, cwd, bootstrapLanes, coverageLanes);
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    return {
      ok: false,
      crashed: true,
      message: [
        `The coverage gate threw before reaching a verdict: ${detail}`,
        "",
        "This is a defect in TDD Guardian, not in your tests. Nothing was verified, so nothing is being reported as passing.",
        err && err.stack ? "" : null,
        err && err.stack ? err.stack : null,
      ]
        .filter((line) => line !== null)
        .join("\n"),
      record: null,
    };
  }
}

function enforcementDemands(config) {
  const demands = [];
  if (Object.values(config.coverageThresholds).some((v) => Number(v) > 0)) demands.push("coverage thresholds");
  if ((config.criticalPaths || []).length) demands.push(`${config.criticalPaths.length} critical path(s)`);
  if (mutationRequirement(config).required && config.mutationGateOn.includes("stop")) demands.push("mutation testing");
  return demands;
}

function describeTotals(percentages) {
  return Object.entries(percentages)
    .map(([k, v]) => `${k}=${v === null ? "n/a" : v.toFixed(2) + "%"}`)
    .join(", ");
}

function main() {
  const payload = readPayload();
  const cwd = payload.cwd || process.cwd();
  const stopHookActive = payload.stop_hook_active === true;
  const fail = (reason, context) => reportFailure(reason, context, stopHookActive);

  const loaded = configLib.load(cwd);

  // No config at all: this project has not opted in. Stay silent.
  if (!loaded.exists) return;

  if (loaded.errors.length) {
    // Consult the user's own flags before blocking on a broken config — a project
    // that never enabled enforcement should not be stopped by a config it ignores.
    const raw = loaded.raw || {};
    const requested = raw.enforceOnStop === true || raw.enforceOnTaskCompleted === true;
    if (raw.enabled === false || !requested) return;
    fail("TDD Guardian config is invalid", loaded.errors.join("\n\n"));
    return;
  }

  const config = loaded.config;
  if (!config.enabled) return;
  if (!config.enforceOnStop) return;

  const state = lanesLib.loadState(cwd);
  state.config_warnings = loaded.warnings;
  for (const warning of loaded.warnings) console.error(`[tdd-guardian] ${warning}`);

  if (configLib.isBypassed(config)) {
    state.bypassed_at = new Date().toISOString();
    lanesLib.saveState(cwd, state);
    console.error(`[tdd-guardian] Gates bypassed via ${config.bypassEnv}.`);
    return;
  }

  const log = [];
  if (loaded.notes.length) log.push(...loaded.notes);

  if (config.preflightCommand) {
    const result = exec.run(config.preflightCommand, cwd, { timeoutMs: 300000 });
    log.push(`$ ${config.preflightCommand}\n${result.stdoutTail}\n${result.stderrTail}`.trim());
    if (result.status !== "pass") {
      fail(
        "Preflight command failed",
        [
          `Preflight failed: \`${config.preflightCommand}\``,
          `Exit code: ${result.exitCode}`,
          "",
          result.stderrTail || result.stdoutTail,
          "",
          "Fix the preflight (missing dependencies? stale lockfile?) before the gates can run.",
        ].join("\n")
      );
      return;
    }
  }

  const lanes = lanesLib.lanesForTrigger(config, "stop");
  if (lanes.length === 0) {
    const demands = enforcementDemands(config);
    if (demands.length === 0) {
      console.error("[tdd-guardian] No lanes are bound to the stop trigger — nothing to run.");
      return;
    }
    lanesLib.saveState(cwd, state);
    fail(
      "No lane is bound to Stop, so nothing can be enforced",
      [
        `enforceOnStop is true and this project configures: ${demands.join(", ")}.`,
        'But no lane has "stop" in its gateOn, so no suite runs and none of that enforcement can be evaluated.',
        "",
        'Add "stop" to the gateOn of a fast lane, or set enforceOnStop to false.',
      ].join("\n")
    );
    return;
  }

  const sha = lanesLib.headSha(cwd) || "";
  const laneResults = [];
  const bootstrapLanes = [];
  const greenLanes = new Set();

  for (const lane of lanes) {
    const result = lanesLib.runLane(lane, cwd);
    laneResults.push(result);
    if (result.ok) greenLanes.add(lane.name);
    const entry = lanesLib.recordLaneResult(state, lane.name, result, sha);

    // A lane that has never had a test is greenfield, not broken. Report it loudly
    // on every run — the invariant this protects is "a silent zero-test run must
    // not look green", and nothing here is silent.
    if (entry.last_result === "bootstrap") {
      bootstrapLanes.push(lane.name);
      const note =
        `Lane '${lane.name}': BOOTSTRAP — 0 tests, and this lane has never had any.\n` +
        `  Write the first test. Once this lane has run even one, a zero-test run becomes a hard failure.`;
      log.push(note);
      console.error(`[tdd-guardian] ${note.replace(/\n\s*/g, " ")}`);
      continue;
    }

    log.push(lanesLib.describeResult(result));

    if (!result.ok) {
      if (lane.optional) {
        log.push(`Lane '${lane.name}' is marked optional — recording the failure without blocking.`);
        continue;
      }
      lanesLib.saveState(cwd, state);
      fail(`Lane '${lane.name}' failed`, [laneFailureReport(lane, result), "", "--- gate log ---", ...log].join("\n"));
      return;
    }
  }

  reportSeparation(cwd, log, greenLanes);

  const coverageLaneNames = lanes.filter((lane) => lane.coverage === "include").map((lane) => lane.name);
  const coverageGate = runCoverageGateSafely(config, laneResults, state, cwd, bootstrapLanes, coverageLaneNames);
  log.push(coverageGate.message);
  if (coverageGate.record) state.coverage = coverageGate.record;
  if (coverageGate.newBaseline) state.baseline = coverageGate.newBaseline;

  if (!coverageGate.ok) {
    lanesLib.saveState(cwd, state);
    fail(coverageGate.crashed ? "Coverage gate crashed" : "Coverage gate failed", log.join("\n\n"));
    return;
  }

  const mutationRequiredBy = mutationRequirement(config);
  if (mutationRequiredBy.required && config.mutationGateOn.includes("stop")) {
    const result = exec.run(config.mutationCommand, cwd, { timeoutMs: 1800000 });
    log.push(`$ ${config.mutationCommand}\n${result.stdoutTail}`);
    state.mutation = {
      timestamp: new Date().toISOString(),
      status: result.status === "pass" ? "PASS" : "FAIL",
      command: config.mutationCommand,
    };
    if (result.status !== "pass") {
      lanesLib.saveState(cwd, state);
      fail(`Mutation gate failed (${mutationRequiredBy.reason})`, log.join("\n\n"));
      return;
    }
  }

  state.last_gate_passed_at = new Date().toISOString();
  state.last_head_sha = sha;
  state.last_result = "passed";
  lanesLib.saveState(cwd, state);
}

if (require.main === module) main();

module.exports = {
  runCoverageGateSafely,
};
