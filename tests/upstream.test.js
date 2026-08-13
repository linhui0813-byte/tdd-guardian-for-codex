"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildLock, compareLocks, validateLock } = require("../scripts/upstream/check");

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DATE_A = "2026-08-01T00:00:00Z";
const DATE_B = "2026-08-02T00:00:00Z";

function lock(overrides = {}) {
  return {
    schemaVersion: 1,
    repository: "xiaolai/tdd-guardian-for-claude",
    ref: "main",
    manifestPath: ".claude-plugin/plugin.json",
    name: "tdd-guardian",
    version: "0.8.1",
    commit: SHA_A,
    commitDate: DATE_A,
    ...overrides,
  };
}

test("upstream: buildLock accepts the expected plugin and full provenance", () => {
  assert.deepEqual(buildLock(SHA_A.toUpperCase(), DATE_A, { name: "tdd-guardian", version: "0.8.1" }), lock());
});

test("upstream: validateLock rejects an abbreviated commit", () => {
  assert.throws(() => validateLock(lock({ commit: "abc123" })), /full 40-character SHA/);
});

test("upstream: buildLock fails closed on an unexpected plugin name", () => {
  assert.throws(() => buildLock(SHA_A, DATE_A, { name: "other-plugin", version: "0.8.1" }), /unexpected upstream plugin name/);
});

test("upstream: buildLock fails closed on an invalid SemVer version", () => {
  assert.throws(() => buildLock(SHA_A, DATE_A, { name: "tdd-guardian", version: "latest" }), /valid SemVer/);
});

test("upstream: identical provenance is unchanged", () => {
  assert.deepEqual(compareLocks(lock(), lock()), {
    changed: false,
    versionChanged: false,
    commitChanged: false,
    sameVersionCommit: false,
  });
});

test("upstream: a new manifest version is detected", () => {
  const result = compareLocks(lock(), lock({ version: "0.9.0", commit: SHA_B, commitDate: DATE_B }));
  assert.equal(result.changed, true);
  assert.equal(result.versionChanged, true);
  assert.equal(result.commitChanged, true);
  assert.equal(result.sameVersionCommit, false);
});

test("upstream: a same-version commit is detected instead of being missed", () => {
  const result = compareLocks(lock(), lock({ commit: SHA_B, commitDate: DATE_B }));
  assert.equal(result.changed, true);
  assert.equal(result.versionChanged, false);
  assert.equal(result.commitChanged, true);
  assert.equal(result.sameVersionCommit, true);
});

test("upstream: workflow runs at 08:00 Asia/Shanghai and remains review-only", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "upstream-update.yml"), "utf8");
  assert.match(workflow, /cron: '0 8 \* \* \*'/);
  assert.match(workflow, /timezone: 'Asia\/Shanghai'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /gh pr create/);
  assert.doesNotMatch(workflow, /gh pr merge|--auto|codex plugin add|npm publish/);
});
