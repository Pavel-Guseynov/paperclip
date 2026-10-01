// Runs upstream's PR checks against every generated PR body (report.json).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkTemplate } from "/tmp/qz/gh/check-pr-template.mjs";
import { checkLinkedIssue } from "/tmp/qz/gh/check-pr-linked-issue.mjs";
import { checkDedupSearch } from "/tmp/qz/gh/check-pr-dedup-search.mjs";
import { checkTestCoverage } from "/tmp/qz/gh/check-pr-test-coverage.mjs";
import { checkLockfile } from "/tmp/qz/gh/check-pr-lockfile.mjs";
import { checkMigrationOrder } from "/tmp/qz/gh/check-pr-migration-order.mjs";

const BASE = "467125fafb47a8520856504fecc48d6e32055db1";
const git = (...args) => execFileSync("git", ["-C", "/home/pc/wt/w1", ...args], { encoding: "utf8" }).trim();
const report = JSON.parse(readFileSync("/opt/pch/desc/report.json", "utf8"));
const baseMigrations = git("ls-tree", "--name-only", BASE, "packages/db/src/migrations/").split("\n").filter((f) => /\.sql$/.test(f));
let bad = 0;
for (const r of report) {
  const statusName = { A: "added", M: "modified", D: "removed", R: "renamed" };
  const files = git("diff", "--name-status", "--no-renames", BASE, r.sha).split("\n").filter(Boolean)
    .map((line) => { const [st, filename] = line.split("\t"); return { filename, status: statusName[st[0]] ?? "modified" }; });
  const prMigrations = files.filter((f) => f.status === "added" && /^packages\/db\/src\/migrations\/\d{4}_[^/]+\.sql$/.test(f.filename)).map((f) => f.filename);
  const results = {
    template: checkTemplate(r.body),
    linked: checkLinkedIssue(r.body, r.title),
    dedup: checkDedupSearch(r.body, r.title),
    tests: checkTestCoverage(files, r.title),
    lockfile: checkLockfile(files, "Pavel-Guseynov", r.branch.replace(/^pr\//, "")),
    migrations: checkMigrationOrder(baseMigrations, prMigrations),
  };
  const failed = Object.entries(results).filter(([, v]) => v && (v.passed === false || v.pass === false || v.ok === false));
  if (failed.length) bad += 1;
  console.log(`${r.id}: ${failed.length ? "FAIL " + failed.map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 300)}`).join(" | ") : "all checks pass"}`);
}
process.exit(bad ? 1 : 0);
