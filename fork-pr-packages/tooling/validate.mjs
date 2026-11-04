// Runs upstream's PR checks against every generated PR body (report.json).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { checkTemplate } from "/Users/pavelguseynov/paperclip-fork/.github/scripts/check-pr-template.mjs";
import { checkLinkedIssue } from "/Users/pavelguseynov/paperclip-fork/.github/scripts/check-pr-linked-issue.mjs";
import { checkDedupSearch } from "/Users/pavelguseynov/paperclip-fork/.github/scripts/check-pr-dedup-search.mjs";
import { checkTestCoverage } from "/Users/pavelguseynov/paperclip-fork/.github/scripts/check-pr-test-coverage.mjs";
import { checkLockfile } from "/Users/pavelguseynov/paperclip-fork/.github/scripts/check-pr-lockfile.mjs";
import { checkMigrationOrder } from "/Users/pavelguseynov/paperclip-fork/.github/scripts/check-pr-migration-order.mjs";

const BASE = "925965a09b8931c1791f2402f3e7595e2845e68e";
const REPO = process.argv[2] || "/Users/pavelguseynov/.gemini/antigravity/brain/7a72dee6-5249-42c5-99d5-0cc53f0244d5/scratch/pf-work";
const REPORT = process.argv[3] || "/Users/pavelguseynov/.gemini/antigravity/brain/7a72dee6-5249-42c5-99d5-0cc53f0244d5/scratch/report.json";
const git = (...args) => execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();
const report = JSON.parse(readFileSync(REPORT, "utf8"));
const baseMigrations = git("ls-tree", "--name-only", BASE, "packages/db/src/migrations/").split("\n").filter((f) => /\.sql$/.test(f));
let bad = 0;
for (const r of report) {
  const statusName = { A: "added", M: "modified", D: "removed", R: "renamed" };
  const compareBase = r.id === "13" ? "1b4c803816e82b0265c8422e1a804327a7ed8c54" : BASE;
  const files = git("diff", "--name-status", "--no-renames", compareBase, r.sha).split("\n").filter(Boolean)
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
