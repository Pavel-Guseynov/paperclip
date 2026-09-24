#!/usr/bin/env node
// Prints the gate results of one branch run as Markdown.
// Usage: gate-report.mjs <label> <branch-ref> [--pr]
//   Reads logs/<label>/SUMMARY, the gate logs, logs/<label>/TRIAGE and the U
//   baseline (logs/U, logs/U-full). Each failing test file is classified:
//   "U baseline" (fails on U too; for a file the branch changes, every failing
//   test name must also fail on U), "load" (passes when rerun in isolation),
//   or "REAL" (fails in isolation, or no triage result).
//   --pr prints the condensed form for a pull-request body.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const scratch = "/private/tmp/claude-501/-Users-pavelguseynov-paperclip-fork/28b5943e-7b11-4fdc-a43e-73c2578b2a8e/scratchpad";
const repo = "/Users/pavelguseynov/paperclip-fork";
const U = "7b7c4d4172d6aac14919e2682b702ae87bc17653";
const [label, branch, mode] = process.argv.slice(2);
const pr = mode === "--pr";
const logs = `${scratch}/logs/${label}`;

const commands = {
  "policy-lockfile": "git diff --name-only U...HEAD | grep -qx pnpm-lock.yaml (must not match)",
  "policy-migration-order": "node .github/scripts/check-pr-migration-order.mjs U HEAD",
  "policy-docker-deps-stage": "node ./scripts/check-docker-deps-stage.mjs",
  "policy-node-version": "pnpm check:node-version",
  "policy-no-git-push": "node ./scripts/check-no-git-push.mjs",
  "policy-no-git-push-test": "node --test ./scripts/check-no-git-push.test.mjs",
  "policy-module-boundaries": "pnpm check:module-boundaries",
  "policy-module-boundaries-test": "node --test ./scripts/check-module-boundaries.test.mjs",
  "policy-pr-scripts-test": "node --test '.github/scripts/tests/*.test.mjs'",
  "policy-server-shard-test": "node --test ./scripts/__tests__/run-vitest-stable-shard.test.mjs",
  "policy-e2e-shard-test": "node --test ./scripts/__tests__/e2e-shard.test.mjs",
  "policy-release-verify-wiring": "node --test ./scripts/__tests__/release-verify-workflow.test.mjs ./scripts/cloud-source-verification.test.mjs ./scripts/standard-image-contract.test.mjs",
  "policy-standalone-concurrency": "node --test ./scripts/__tests__/build-standalone-concurrency.test.mjs",
  "policy-release-package-map": "node ./scripts/release-package-map.mjs check",
  "policy-release-bootstrap": "PAPERCLIP_RELEASE_BOOTSTRAP_BASE_SHA=U node ./scripts/check-release-package-bootstrap.mjs <changed files>",
  "policy-dependency-resolution": "pnpm install --resolution-only --ignore-scripts --no-frozen-lockfile",
  "policy-token-gates": "pnpm check:token-gates",
  "policy-diff-check": "git diff --check U...HEAD",
  "policy-pnpm-version": "pnpm check:pnpm-version",
  "policy-pnpm-version-test": "node --test ./scripts/check-pnpm-version-policy.test.mjs",
  "typecheck-all": "pnpm -r typecheck",
  "typecheck-build-gaps": "pnpm run typecheck:build-gaps",
  "release-registry": "pnpm run test:release-registry",
  "build-issue-thread": "pnpm --filter @paperclipai/paperclip-runner build:issue-thread",
  "build": "pnpm build",
  "runner-static": "pnpm --filter @paperclipai/paperclip-runner check:static",
  "runner-rust": "pnpm --filter @paperclipai/paperclip-runner check:runner",
  "runner-vitest": "pnpm --filter @paperclipai/paperclip-runner test:typescript:vitest",
  "test-general-server": "pnpm exec vitest run --exclude '**/dist/**' --project @paperclipai/server --no-file-parallelism --maxWorkers=1 --exclude <each serialized suite> (the general-server group, with the runner's per-invocation env)",
  "sentry-contract": "the sentry-contract.yml steps: pnpm install --frozen-lockfile; npm install --prefix <tmp> @sentry/node@<server peer version>; NODE_PATH=<tmp>/node_modules PAPERCLIP_REQUIRE_SENTRY_TEST_SDK=1 pnpm --filter @paperclipai/server exec vitest run src/__tests__/run-failure-sentry-real-sdk.test.ts",
  "serialized-files": "pnpm exec vitest run --exclude '**/dist/**' --project @paperclipai/server <suite> --pool=forks --isolate, once per suite of node scripts/run-vitest-stable.mjs --mode serialized --dry-run",
};
const commandFor = (gate) =>
  commands[gate] ??
  (gate.startsWith("project-")
    ? `pnpm exec vitest run --exclude '**/dist/**' --project ${gate.slice(8).replace(/^_paperclipai_/, "@paperclipai/")}`
    : "?");

// A Markdown table cell: GitHub splits cells on "|" even inside code spans.
const cell = (text) => String(text).replace(/\|/g, "\\|");
const sh = (args) => execFileSync("bash", args, { encoding: "utf8", maxBuffer: 1 << 26 });
const failingLines = (...labels) => sh([`${scratch}/fails.sh`, ...labels]).split("\n").filter(Boolean);
// "|project| file > suite > test" or a runner file/test name -> file key and test name.
const splitId = (id) => {
  const [file, ...rest] = id.split(" > ");
  return { file: file.replace(/ \[.*\]$/, "").trim(), test: rest.join(" > ") };
};

const baseline = failingLines("U", "U-full").map((line) => line.split("\t")[1]);
const baselineFiles = new Set(baseline.map((id) => splitId(id).file));
const baselineTests = new Set(baseline);
const changedFiles = execFileSync("git", ["-C", repo, "diff", "--name-only", U, branch], { encoding: "utf8" })
  .split("\n").filter(Boolean);
const changedByBranch = (fileKey) => {
  const path = fileKey.replace(/^\|[^|]+\| /, "");
  return changedFiles.some((changed) => changed.endsWith(path));
};

const triage = new Map();
if (existsSync(`${logs}/TRIAGE`)) {
  for (const line of readFileSync(`${logs}/TRIAGE`, "utf8").split("\n").filter(Boolean)) {
    const [result, project, file] = line.split("\t");
    const key = project.startsWith("runner-") ? file : `|${project}| ${file}`;
    triage.set(key, result);
  }
}

const summary = readFileSync(`${logs}/SUMMARY`, "utf8").split("\n");
const header = summary.find((line) => line.startsWith("label="));
const head = /head=(\w+)/.exec(header)?.[1];
const gates = [];
for (const line of summary) {
  const match = /^GATE (\S+)\s+exit=(\d+) dur=(\d+|unrecorded)s?(?: suites=(\d+) failed=(\d+))?/.exec(line);
  if (match) gates.push({ name: match[1], exit: Number(match[2]), dur: Number(match[3]), suites: match[4], failedSuites: match[5] });
}

function counts(gate) {
  const path = `${logs}/${gate.name}.log`;
  if (gate.suites) return `${gate.suites} suites, ${gate.failedSuites} failed`;
  if (!existsSync(path)) return "";
  const text = readFileSync(path, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  const files = [...text.matchAll(/^ +Test Files +(.+)$/gm)].map((m) => m[1].trim());
  const tests = [...text.matchAll(/^ +Tests +(.+)$/gm)].map((m) => m[1].trim());
  if (tests.length) return `files: ${files.at(-1)}; tests: ${tests.at(-1)}`;
  const pass = [...text.matchAll(/^ℹ pass (\d+)$/gm)].reduce((n, m) => n + Number(m[1]), 0);
  const fail = [...text.matchAll(/^ℹ fail (\d+)$/gm)].reduce((n, m) => n + Number(m[1]), 0);
  if (pass || fail) return `node:test ${pass} passed, ${fail} failed`;
  const cargo = [...text.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed/gm)];
  if (cargo.length) {
    const p = cargo.reduce((n, m) => n + Number(m[1]), 0);
    const f = cargo.reduce((n, m) => n + Number(m[2]), 0);
    return `cargo ${p} passed, ${f} failed (stops at the first failing test binary)`;
  }
  return "";
}

const failures = new Map();
for (const line of failingLines(label)) {
  const [gate, id] = line.split("\t");
  const { file } = splitId(id);
  if (!failures.has(gate)) failures.set(gate, new Map());
  const files = failures.get(gate);
  if (!files.has(file)) files.set(file, []);
  files.get(file).push(id);
}

// Failing ids in an isolated triage rerun log of one file.
function isolatedFailures(file) {
  const path = `${logs}/triage-${file.split("/").at(-1)}.log`;
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  return [...new Set([...text.matchAll(/^ FAIL  (.+)$/gm)].map((m) => m[1].trim()))];
}

function classify(file, ids) {
  if (baselineFiles.has(file)) {
    if (!changedByBranch(file)) return "U baseline";
    const extra = ids.filter((id) => splitId(id).test && !baselineTests.has(id));
    if (extra.length === 0) return "U baseline (same tests fail on U)";
    const isolated = triage.get(file) === "baseline-rerun" ? isolatedFailures(file) : null;
    if (isolated) {
      const isolatedExtra = isolated.filter((id) => !baselineTests.has(id));
      if (isolatedExtra.length === 0) {
        return `U baseline (isolated rerun fails only U's tests; under load also: ${extra.map((id) => splitId(id).test).join("; ")})`;
      }
      return `REAL (isolated rerun fails tests that pass on U: ${isolatedExtra.map((id) => splitId(id).test).join("; ")})`;
    }
    return `REAL? file changed by branch; not failing on U: ${extra.map((id) => splitId(id).test).join("; ")}`;
  }
  const result = triage.get(file);
  if (result === "isolated-pass") return "load (passes in isolation)";
  if (result === "isolated-FAIL") return "REAL (fails in isolation)";
  if (result === "rerun-pass") return "load (failed once in isolation on a timeout, passed on a second isolated rerun)";
  return "not rerun alone (the local run was stopped before triage)";
}

const rows = gates.map((gate) => {
  const files = failures.get(gate.name) ?? new Map();
  const classified = [...files].map(([file, ids]) => ({ file, verdict: classify(file, ids) }));
  let result;
  if (gate.exit === 0) result = "pass";
  else if (classified.length === 0) result = `FAIL exit ${gate.exit} (no test failure parsed)`;
  else if (classified.every((c) => c.verdict.startsWith("U baseline"))) result = "fail, U baseline only";
  else if (classified.every((c) => c.verdict.startsWith("U baseline") || c.verdict.startsWith("load"))) result = "fail, U baseline + load only";
  else result = "FAIL";
  return { gate, result, classified };
});

const out = [];
if (!pr) {
  out.push(`#### ${label} — head \`${head}\`, base \`${U}\``, "");
  out.push("| Gate | Command | Result | Counts |", "|---|---|---|---|");
  for (const { gate, result } of rows) out.push(`| ${gate.name} | \`${cell(commandFor(gate.name))}\` | ${result} | ${cell(counts(gate))} |`);
  const failing = rows.filter((row) => row.classified.length);
  if (failing.length) {
    out.push("", "Failing test files:");
    for (const { gate, classified } of failing) for (const c of classified) out.push(`- ${gate.name}: \`${c.file}\` — ${c.verdict}`);
  }
} else {
  const manifest = JSON.parse(execFileSync("git", ["-C", repo, "show", `${branch}:package.json`], { encoding: "utf8" }));
  const pnpmVersion = manifest.packageManager.replace(/^pnpm@/, "");
  const prCommand = (name) => commandFor(name).replace(/\bU\b/g, "master");
  const shortVerdict = (verdict) =>
    verdict.startsWith("U baseline") ? "fails on `master` too"
      : verdict.startsWith("load") ? "machine load: passes when rerun alone"
        : verdict;
  const isExplained = (c) => c.verdict.startsWith("U baseline") || c.verdict.startsWith("load");
  const passed = rows.filter((row) => row.result === "pass");
  const passedProjects = passed.filter((row) => row.gate.name.startsWith("project-"));
  const passedOther = passed.filter((row) => !row.gate.name.startsWith("project-"));
  const projectName = (row) => prCommand(row.gate.name).replace(/^.*--project /, "");
  const other = rows.filter((row) => row.result !== "pass");
  const withTests = other.filter((row) => row.classified.length);
  const unparsed = other.filter((row) => !row.classified.length);
  out.push("## Gate results", "");
  out.push(`Head \`${head}\`, base \`master\` at \`${U}\`. Run locally on macOS arm64 with Node 24.19.0 and pnpm ${pnpmVersion}. The commands are the ones \`pr-trusted.yml\` runs. Each gate ran on its own, so one failure cannot hide another.`, "");
  const branchHead = execFileSync("git", ["-C", repo, "rev-parse", branch], { encoding: "utf8" }).trim();
  if (branchHead !== head) {
    const later = execFileSync("git", ["-C", repo, "log", "--reverse", "--format=`%h` %s", `${head}..${branch}`], { encoding: "utf8" })
      .split("\n").filter(Boolean);
    out.push(`These gates ran at \`${head.slice(0, 9)}\`, before the current head \`${branchHead.slice(0, 9)}\`. The current head adds:`, ...later.map((line) => `- ${line}`), "");
  }
  const passedItems = passedOther.map((row) => `\`${prCommand(row.gate.name)}\``);
  if (passedProjects.length) {
    passedItems.push(`\`pnpm exec vitest run --exclude '**/dist/**' --project <name>\` for ${passedProjects.map((row) => `\`${projectName(row)}\``).join(", ")}`);
  }
  out.push(`Passed (${passed.length}): ${passedItems.join("; ")}.`, "");
  if (withTests.length) {
    out.push("Gates with failing tests:", "");
    out.push("| Gate | Command | Counts | Failing files |", "|---|---|---|---|");
    for (const { gate, classified } of withTests) {
      const files = classified.map((c) => `\`${c.file.replace(/^\|[^|]+\| /, "")}\` (${shortVerdict(c.verdict)})`).join("; ");
      out.push(`| ${gate.name} | \`${cell(prCommand(gate.name))}\` | ${cell(counts(gate))} | ${cell(files)} |`);
    }
    out.push("");
    if (withTests.every((row) => row.classified.every(isExplained))) {
      out.push("Every failing test also fails on unchanged `master` here, or passes when rerun alone (the load came from parallel gate runs on the same machine).", "");
    }
  }
  const open = [
    ...unparsed.map((row) =>
      row.gate.name === "policy-lockfile"
        ? "`pnpm-lock.yaml` is changed, which the lockfile policy rejects. See \"Risks\": this needs maintainer direction."
        : `\`${prCommand(row.gate.name)}\` failed with exit ${row.gate.exit}.`),
    ...withTests.flatMap((row) => row.classified.filter((c) => !isExplained(c)).map((c) => `\`${c.file}\`: ${c.verdict}`)),
  ];
  if (open.length) out.push("Open:", ...open.map((item) => `- ${item}`), "");
  const expectedGates = [
    "policy-lockfile", "policy-migration-order", "policy-docker-deps-stage", "policy-node-version",
    "policy-no-git-push", "policy-no-git-push-test", "policy-module-boundaries", "policy-module-boundaries-test",
    "policy-pr-scripts-test", "policy-server-shard-test", "policy-e2e-shard-test", "policy-release-verify-wiring",
    "policy-standalone-concurrency", "policy-release-package-map", "policy-release-bootstrap",
    "policy-dependency-resolution", "policy-token-gates", "policy-diff-check", "typecheck-all",
    "typecheck-build-gaps", "release-registry", "build-issue-thread", "build", "runner-static", "runner-rust",
    "runner-vitest", "test-general-server",
    ...["_paperclipai_shared", "_paperclipai_skills-catalog", "_paperclipai_db", "_paperclipai_adapter-utils",
      "_paperclipai_adapter-claude-local", "_paperclipai_adapter-codex-local", "_paperclipai_adapter-grok-local",
      "_paperclipai_adapter-openclaw-gateway", "_paperclipai_adapter-opencode-local", "_paperclipai_plugin-daytona",
      "_paperclipai_plugin-sdk", "_paperclipai_create-paperclip-plugin", "_paperclipai_ui", "paperclipai"]
      .map((project) => `project-${project}`),
    "serialized-files",
  ];
  const ran = new Set(rows.map((row) => row.gate.name));
  const notReached = expectedGates.filter((name) => !ran.has(name));
  if (notReached.length) {
    out.push(`Not reached: the local run was stopped before ${notReached.length} gate(s): ${notReached.map((name) => `\`${prCommand(name)}\``).join("; ")}.`, "");
  }
  out.push(
    "Notes:",
    "- `check:runner` stops at `verified_launch_preserves_homebrew_node_loader_layout`, which also fails on `master` here: the Nix store Node binary cannot be copied into the immutable process snapshot (`Permission denied`). This branch does not change the Rust sources. With `cargo test --release --manifest-path runner/Cargo.toml --locked --workspace --no-fail-fast`, 581 tests pass and only that test fails. `check:conformance-parity` and `check:replay-parity` pass.",
    "",
    "Not run:",
    "- Docker context integrity and the Docker image jobs: no Docker daemon on this machine.",
    "- E2E shards (`pnpm test:e2e`): they start a server on port 3100 and use `~/.paperclip`, where a live instance runs on this machine.",
    "- Canary dry run: it needs `git checkout -B master HEAD` in the checkout.",
    "- `storybook-visual`: label-gated, and it needs the visual baselines.",
    "- `docker-runner-check`: path-triggered, and this change does not touch its paths.",
  );
  if (!rows.some((row) => row.gate.name === "sentry-contract")) {
    out.push("- `sentry-contract`: path-triggered, and this change does not touch its paths.");
  }
}
process.stdout.write(`${out.join("\n")}\n`);
