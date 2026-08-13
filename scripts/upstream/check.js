#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const EXPECTED_REPOSITORY = "xiaolai/tdd-guardian-for-claude";
const EXPECTED_REF = "main";
const EXPECTED_MANIFEST_PATH = ".claude-plugin/plugin.json";
const EXPECTED_NAME = "tdd-guardian";
const LOCK_PATH = path.resolve(__dirname, "..", "..", "upstream.lock.json");
const SHA_RE = /^[0-9a-f]{40}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function validateLock(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("upstream lock must be a JSON object");
  }
  if (raw.schemaVersion !== 1) throw new Error("upstream lock schemaVersion must be 1");

  const lock = {
    schemaVersion: 1,
    repository: assertString(raw.repository, "repository"),
    ref: assertString(raw.ref, "ref"),
    manifestPath: assertString(raw.manifestPath, "manifestPath"),
    name: assertString(raw.name, "name"),
    version: assertString(raw.version, "version"),
    commit: assertString(raw.commit, "commit").toLowerCase(),
    commitDate: assertString(raw.commitDate, "commitDate"),
  };

  if (lock.repository !== EXPECTED_REPOSITORY) throw new Error(`unexpected upstream repository: ${lock.repository}`);
  if (lock.ref !== EXPECTED_REF) throw new Error(`unexpected upstream ref: ${lock.ref}`);
  if (lock.manifestPath !== EXPECTED_MANIFEST_PATH) throw new Error(`unexpected manifest path: ${lock.manifestPath}`);
  if (lock.name !== EXPECTED_NAME) throw new Error(`unexpected upstream plugin name: ${lock.name}`);
  if (!SEMVER_RE.test(lock.version)) throw new Error(`upstream version is not valid SemVer: ${lock.version}`);
  if (!SHA_RE.test(lock.commit)) throw new Error(`upstream commit must be a full 40-character SHA: ${lock.commit}`);
  if (!Number.isFinite(Date.parse(lock.commitDate))) throw new Error(`upstream commitDate is invalid: ${lock.commitDate}`);

  return lock;
}

function buildLock(commit, commitDate, manifest) {
  const candidate = {
    schemaVersion: 1,
    repository: EXPECTED_REPOSITORY,
    ref: EXPECTED_REF,
    manifestPath: EXPECTED_MANIFEST_PATH,
    name: manifest?.name,
    version: manifest?.version,
    commit,
    commitDate,
  };
  return validateLock(candidate);
}

function compareLocks(current, candidate) {
  const versionChanged = current.version !== candidate.version;
  const commitChanged = current.commit !== candidate.commit;
  return {
    changed: versionChanged || commitChanged,
    versionChanged,
    commitChanged,
    sameVersionCommit: !versionChanged && commitChanged,
  };
}

function requestJson(url, token) {
  return new Promise((resolve, reject) => {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "tdd-guardian-for-codex-upstream-tracker",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    https
      .get(url, { headers }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
            reject(new Error(`GitHub API ${response.statusCode}: ${body.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`GitHub API returned invalid JSON: ${error.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function appendOutputs(outputPath, values) {
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value)}`);
  fs.appendFileSync(outputPath, lines.join("\n") + "\n", "utf8");
}

async function fetchCandidate(token) {
  const api = "https://api.github.com";
  const commitUrl = `${api}/repos/${EXPECTED_REPOSITORY}/commits/${encodeURIComponent(EXPECTED_REF)}`;
  const commitResponse = await requestJson(commitUrl, token);
  const commit = assertString(commitResponse.sha, "GitHub commit SHA").toLowerCase();
  const commitDate = assertString(commitResponse.commit?.committer?.date, "GitHub commit date");
  if (!SHA_RE.test(commit)) throw new Error(`GitHub returned a non-full commit SHA: ${commit}`);

  const manifestUrl =
    `${api}/repos/${EXPECTED_REPOSITORY}/contents/${EXPECTED_MANIFEST_PATH}` +
    `?ref=${encodeURIComponent(commit)}`;
  const manifestResponse = await requestJson(manifestUrl, token);
  if (manifestResponse.encoding !== "base64" || typeof manifestResponse.content !== "string") {
    throw new Error("GitHub manifest response is not base64 file content");
  }

  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(manifestResponse.content, "base64").toString("utf8"));
  } catch (error) {
    throw new Error(`upstream manifest is invalid JSON: ${error.message}`);
  }
  return buildLock(commit, commitDate, manifest);
}

async function main() {
  const current = validateLock(JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")));
  const candidate = await fetchCandidate(process.env.GITHUB_TOKEN || "");
  const comparison = compareLocks(current, candidate);

  appendOutputs(process.env.GITHUB_OUTPUT, {
    changed: comparison.changed,
    version_changed: comparison.versionChanged,
    commit_changed: comparison.commitChanged,
    same_version_commit: comparison.sameVersionCommit,
    old_version: current.version,
    new_version: candidate.version,
    old_commit: current.commit,
    new_commit: candidate.commit,
    new_commit_date: candidate.commitDate,
  });

  console.log(`Tracked upstream: ${current.version} @ ${current.commit}`);
  console.log(`Current upstream: ${candidate.version} @ ${candidate.commit}`);

  if (!comparison.changed) {
    console.log("No upstream version or commit change detected.");
    return;
  }

  fs.writeFileSync(LOCK_PATH, JSON.stringify(candidate, null, 2) + "\n", "utf8");
  console.log(
    comparison.sameVersionCommit
      ? "Detected a new upstream commit with the same manifest version."
      : "Detected a new upstream version or commit."
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[upstream-tracker] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildLock,
  compareLocks,
  validateLock,
};
