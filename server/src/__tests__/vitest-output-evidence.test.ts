import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { runWithTestEvidence } from "../../../scripts/vitest-output-evidence.mjs";

const roots: string[] = [];
const fixture = fileURLToPath(new URL("../../scripts/fixtures/test-output-child.mjs", import.meta.url));
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});
async function run(mode: string, command = process.execPath) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vitest-evidence-"));
  roots.push(directory);
  const stdout = (await fs.open(path.join(directory, "forwarded.stdout"), "wx")).createWriteStream();
  const stderr = (await fs.open(path.join(directory, "forwarded.stderr"), "wx")).createWriteStream();
  let result;
  try {
    result = await runWithTestEvidence({ command, args: [fixture, mode],
      cwd: directory, env: { ...process.env }, directory, label: mode, stdout, stderr });
  } finally {
    await Promise.all([stdout, stderr].map(stream => new Promise(resolve => stream.end(resolve))));
  }
  const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
  const raw = await fs.readFile(result.outputPath, "utf8");
  const records = raw.trim() ? raw.trim().split("\n").map(line => JSON.parse(line)) : [];
  return { result, manifest, raw, records,
    forwardedStdout: await fs.readFile(path.join(directory, "forwarded.stdout"), "utf8"),
    forwardedStderr: await fs.readFile(path.join(directory, "forwarded.stderr"), "utf8") };
}

it("retains every safe stdout/stderr record beyond command-output limits with exact completion counts", async () => {
  const { result, manifest, raw, records, forwardedStdout, forwardedStderr } = await run("large");
  expect(result.status).toBe(0);
  expect(manifest.complete).toBe(true);
  expect(records.map(record => record.params.sequence)).toEqual(records.map((_, index) => index + 1));
  expect(records.every(record => record.jsonrpc === "2.0" && record.params.executionId === manifest.executionId)).toBe(true);
  const stdout = records.filter(record => record.params.channel === "stdout").map(record => record.params.text).join("");
  const stderr = records.filter(record => record.params.channel === "stderr").map(record => record.params.text).join("");
  expect(stdout).toBe(Array.from({ length: 1100 }, (_, index) => `${index}:${"x".repeat(1000)}\n`).join("") + "last:🧪\n");
  expect(stderr).toBe('original failure: {"token":"***REDACTED***"}\nfinal unterminated diagnostic');
  expect(forwardedStdout).toBe(stdout);
  expect(forwardedStderr.startsWith(stderr)).toBe(true);
  expect(raw).not.toContain("fixture-only-private-value");
  for (const [channel, text, count] of [["stdout", stdout, 1101], ["stderr", stderr, 2]]) {
    expect(manifest.streams[channel]).toMatchObject({ safeBytes: Buffer.byteLength(text), records: count,
      sha256: createHash("sha256").update(text).digest("hex"), complete: true });
  }
  expect(manifest.streams.stdout.receivedBytes).toBe(Buffer.byteLength(stdout));
  expect(manifest.streams.stderr.redactedRecords).toBe(1);
});

it("preserves a failed child's exit and original exception chain while redacting credentials", async () => {
  const { result, manifest, raw } = await run("failed");
  expect(result.status).toBe(1);
  expect(manifest).toMatchObject({ status: 1, signal: null, complete: true });
  expect(raw).toContain("known outer failure");
  expect(raw).toContain("known original cause");
  expect(raw).not.toContain("fixture-only-private-value");
});

it("preserves the native launch failure with completed empty stream counts", async () => {
  const { result, manifest, records } = await run("missing", "/nonexistent-paperclip-test-command");
  expect(result.status).toBe(1);
  expect(manifest.launchError.code).toBe("ENOENT");
  expect(manifest.complete).toBe(true);
  expect(records).toEqual([]);
  expect(manifest.streams.stdout).toMatchObject({ receivedBytes: 0, safeBytes: 0, records: 0 });
});

it("fails evidence acceptance on invalid UTF-8 without changing the child's original successful exit", async () => {
  const { result, manifest } = await run("invalid-utf8");
  expect(result.status).toBe(1);
  expect(manifest).toMatchObject({ status: 0, complete: false, retentionError: { name: "TypeError" } });
  expect(manifest.streams.stdout).toMatchObject({ receivedBytes: 2, complete: false });
});

it("refuses an unwritable evidence destination before launching a child", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vitest-evidence-"));
  roots.push(root);
  const directory = path.join(root, "file");
  await fs.writeFile(directory, "already a file");
  await expect(runWithTestEvidence({ command: process.execPath, args: [fixture, "large"],
    cwd: root, env: { ...process.env }, directory, label: "blocked evidence" })).rejects.toMatchObject({ code: "EEXIST" });
  expect(await fs.readFile(directory, "utf8")).toBe("already a file");
  expect(await fs.readdir(root)).toEqual(["file"]);
});

it("fails acceptance when completion evidence cannot be delivered while preserving the child's original exit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vitest-evidence-"));
  roots.push(root);
  const directory = path.join(root, "evidence");
  const stderr = (await fs.open(path.join(root, "diagnostics"), "wx")).createWriteStream();
  const stdout = (await fs.open(path.join(root, "stdout"), "wx")).createWriteStream();
  let result;
  try {
    result = await runWithTestEvidence({ command: process.execPath,
      args: [fixture, "remove-evidence", directory], cwd: root, env: { ...process.env },
      directory, label: "completion delivery failure", stdout, stderr });
  } finally {
    await Promise.all([stdout, stderr].map(stream => new Promise(resolve => stream.end(resolve))));
  }
  expect(result).toMatchObject({ status: 1, originalStatus: 0, retentionError: { code: "ENOENT" } });
  const diagnostic = JSON.parse(await fs.readFile(path.join(root, "diagnostics"), "utf8"));
  expect(diagnostic).toMatchObject({ jsonrpc: "2.0", method: "paperclip.test.evidence",
    params: { status: 0, complete: false, retentionError: { code: "ENOENT" } } });
  await expect(fs.stat(result.manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
});

it("records a failed output destination and awaits the real child's termination", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vitest-evidence-"));
  roots.push(directory);
  const stdout = (await fs.open(path.join(directory, "closed-output"), "wx")).createWriteStream();
  await new Promise(resolve => stdout.end(resolve));
  const stderr = (await fs.open(path.join(directory, "diagnostics"), "wx")).createWriteStream();
  let result;
  try {
    result = await runWithTestEvidence({ command: process.execPath, args: [fixture, "large"],
      cwd: directory, env: { ...process.env }, directory, label: "output delivery failure", stdout, stderr });
  } finally {
    await new Promise(resolve => stderr.end(resolve));
  }
  expect(result).toMatchObject({ status: 1, retentionError: { code: "ERR_STREAM_WRITE_AFTER_END" } });
  const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
  expect(manifest).toMatchObject({ complete: false,
    retentionError: { code: "ERR_STREAM_WRITE_AFTER_END" } });
  expect(manifest.status).toBe(result.originalStatus);
  expect(manifest.signal).toBe(result.signal);
});

it("retains child completion after the parent receives a native graceful stop", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "vitest-evidence-"));
  roots.push(directory);
  const parent = spawn(process.execPath, [fileURLToPath(new URL("../../scripts/fixtures/test-output-parent.mjs", import.meta.url)), directory], { stdio: "pipe" });
  const closed = once(parent, "close");
  const lines = createInterface({ input: parent.stdout });
  let stopped = false;
  try {
    for await (const line of lines) {
      const notification = JSON.parse(line);
      if (notification.jsonrpc === "2.0" && notification.method === "paperclip.test.ready") {
        parent.kill("SIGTERM");
        stopped = true;
        break;
      }
    }
    expect(stopped).toBe(true);
  } finally {
    lines.close();
    if (!stopped && parent.exitCode === null) parent.kill("SIGTERM");
    await closed;
    parent.stdin.end();
  }
  expect(parent.exitCode).toBe(1);
  const files = await fs.readdir(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(directory, files.find(file => file.endsWith(".manifest.json"))), "utf8"));
  const output = await fs.readFile(manifest.outputPath, "utf8");
  expect(manifest).toMatchObject({ status: 0, signal: null, stopRequested: "SIGTERM", complete: true });
  expect(output).toContain("paperclip.test.child_stopped");
});
