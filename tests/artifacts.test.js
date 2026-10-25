"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const skillRoot = path.join(root, "skills", "tdd-guardian");

function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : file.endsWith(".md") ? [file] : [];
  });
}

test("every resolved plugin reference in the shipped workflows exists", () => {
  let references = 0;
  for (const file of markdownFiles(skillRoot)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/<plugin_root>\/([^`\s'"<>]+\.(?:md|js))/g)) {
      const target = path.resolve(root, match[1]);
      assert.ok(target.startsWith(root + path.sep), `reference escapes plugin: ${match[0]}`);
      assert.ok(fs.statSync(target).isFile(), `${path.relative(root, file)} points to missing ${match[1]}`);
      references++;
    }
    assert.doesNotMatch(text, /\$tdd-guardian-[a-z]/, `${file} must use this port's single skill`);
    assert.doesNotMatch(text, /<plugin_root>\/codex\//, `${file} points to the upstream layout`);
    assert.doesNotMatch(text, /Codex has no `Stop`/, `${file} contradicts this port's native Stop hook`);
    assert.doesNotMatch(text, /\.\.\/tdd-guardian-<name>/, `${file} points to unavailable sibling skills`);
  }
  assert.ok(references > 30, "workflows must resolve the scripts, roles, and policies they use");
});

test("the router's progressive references resolve relative to its own skill directory", () => {
  const text = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  for (const match of text.matchAll(/`(references\/[^`]+\.md)`/g)) {
    assert.ok(fs.statSync(path.join(skillRoot, match[1])).isFile(), `missing router reference: ${match[1]}`);
  }
});

test("the package keeps Codex hooks and opt-in enforcement defaults", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config", "config.json"), "utf8"));
  const hooks = JSON.parse(fs.readFileSync(path.join(root, "hooks", "hooks.json"), "utf8"));
  assert.equal(config.enforceOnStop, false);
  assert.equal(config.blockCommitWithoutFreshGate, false);
  assert.deepEqual(config.criticalPaths, []);
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ["PreToolUse", "Stop"]);
  for (const event of ["PreToolUse", "Stop"]) {
    const command = hooks.hooks[event][0].hooks[0].command;
    assert.match(command, /node "\$\{PLUGIN_ROOT\}\/scripts\/tdd-guardian\/[^"\n]+\.js"/);
  }
});
