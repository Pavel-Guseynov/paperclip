// usage (as qzrunner, in repo root): node /opt/pch/rerun-failed.mjs <suite log>... > out
// Reruns every failing test file alone, sequentially, with run-vitest-stable's env, and prints
// "<project> <file> PASS|FAIL" per file.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
const files = new Map();
for (const log of process.argv.slice(2)) {
  const text = readFileSync(log, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
  for (const m of text.matchAll(/^ FAIL  \|([^|]+)\| (\S+?\.test\.[a-z]+)/gm)) files.set(`${m[1]} ${m[2]}`, [m[1], m[2]]);
}
// RERUN_DONE: a previous partial output; files it already reports are skipped.
const done = new Set();
if (process.env.RERUN_DONE) {
  for (const m of readFileSync(process.env.RERUN_DONE, "utf8").matchAll(/^(?:PASS|FAIL) (.+)$/gm)) done.add(m[1]);
}
for (const key of done) files.delete(key);
let index = 0;
for (const [key, [project, file]] of files) {
  const root = realpathSync(mkdtempSync("/tmp/pr-"));
  const env = { ...process.env, NODE_ENV: "test", PAPERCLIP_HOME: path.join(root, "h"),
    PAPERCLIP_CONFIG: path.join(root, "h", "config.json"), PAPERCLIP_INSTANCE_ID: `rr-${process.pid}-${index++}`, TMPDIR: path.join(root, "t") };
  mkdirSync(env.PAPERCLIP_HOME, { recursive: true }); mkdirSync(env.TMPDIR, { recursive: true });
  const r = spawnSync("pnpm", ["exec", "vitest", "run", "--exclude", "**/dist/**", "--project", project, "--no-file-parallelism", "--maxWorkers=1", file], { env, encoding: "utf8", maxBuffer: 1 << 28 });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  const failing = [...new Set([...out.matchAll(/^ FAIL  .*$/gm)].map((m) => m[0].trim()))];
  console.log(`${r.status === 0 ? "PASS" : "FAIL"} ${key}`);
  for (const f of failing) console.log(`    ${f}`);
}
