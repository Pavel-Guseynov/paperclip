import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { redactDiagnosticText } from "../packages/adapter-utils/src/command-redaction.ts";

// Used by the existing test gate, not a second CLI or runner. A record contains
// one complete decoded line, including its terminator (or the final partial
// line). Counts and hashes describe the safe text, never a truncated excerpt.
export async function runWithTestEvidence({ command, args, cwd, env, directory, label,
  stdout = process.stdout, stderr = process.stderr }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const executionId = randomUUID();
  const outputPath = path.join(directory, `${executionId}.output.jsonl`);
  const manifestPath = path.join(directory, `${executionId}.manifest.json`);
  const fd = openSync(outputPath, "wx", 0o600);
  let sequence = 0;
  let retentionError = null;
  let captureFailed = false;
  let launchError = null;
  let stopRequested = null;
  let child;
  const requestStop = signal => {
    if (stopRequested || !child || child.exitCode !== null || child.signalCode !== null) return;
    stopRequested = signal;
    child.kill(signal);
  };
  const onInterrupt = () => requestStop("SIGINT");
  const onTerminate = () => requestStop("SIGTERM");
  const onOutputError = error => {
    retentionError ??= error;
    requestStop("SIGTERM");
    child?.stdout.resume();
    child?.stderr.resume();
  };
  stdout.on("error", onOutputError);
  stderr.on("error", onOutputError);
  const streams = Object.fromEntries(["stdout", "stderr"].map(channel => [channel, {
    decoder: new StringDecoder("utf8"), validator: new TextDecoder("utf8", { fatal: true }),
    pending: "", receivedBytes: 0,
    safeBytes: 0, records: 0, redactedRecords: 0, hash: createHash("sha256"),
  }]));
  const emit = (channel, raw) => {
    const safe = redactDiagnosticText(raw);
    const stream = streams[channel];
    stream.safeBytes += Buffer.byteLength(safe);
    stream.records += 1;
    stream.redactedRecords += Number(safe !== raw);
    stream.hash.update(safe);
    const record = { jsonrpc: "2.0", method: "paperclip.test.output", params: {
      executionId, sequence: ++sequence, channel, text: safe,
    } };
    if (!captureFailed) {
      try {
        const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
        let offset = 0;
        while (offset < bytes.length) {
          const written = writeSync(fd, bytes, offset, bytes.length - offset);
          if (written === 0) throw new Error("Test evidence write made no progress");
          offset += written;
        }
      }
      catch (error) {
        captureFailed = true;
        retentionError ??= error;
        requestStop("SIGTERM");
      }
    }
    return safe;
  };
  const forward = (channel, text) => {
    if (!text) return;
    const destination = channel === "stdout" ? stdout : stderr;
    if (retentionError && (destination.destroyed || destination.writableEnded)) return;
    if (!destination.write(text, error => { if (error) onOutputError(error); }) && !destination.destroyed && !destination.writableEnded && child && !child[channel].destroyed) {
      child[channel].pause();
      destination.once("drain", () => child[channel].resume());
    }
  };
  const consume = (channel, text) => {
    const stream = streams[channel];
    stream.pending += text;
    const safeLines = [];
    let newline;
    while ((newline = stream.pending.indexOf("\n")) !== -1) {
      safeLines.push(emit(channel, stream.pending.slice(0, newline + 1)));
      stream.pending = stream.pending.slice(newline + 1);
    }
    forward(channel, safeLines.join(""));
  };
  let status;
  let signal;
  try {
    child = spawn(command, args, { cwd, env, stdio: ["inherit", "pipe", "pipe"] });
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
    for (const channel of ["stdout", "stderr"]) {
      child[channel].on("data", chunk => {
        streams[channel].receivedBytes += chunk.length;
        try { streams[channel].validator.decode(chunk, { stream: true }); }
        catch (error) { retentionError ??= error; }
        consume(channel, streams[channel].decoder.write(chunk));
      });
    }
    child.on("error", error => { launchError = error; });
    [status, signal] = await new Promise(resolve => child.once("close", (...result) => resolve(result)));
    for (const channel of ["stdout", "stderr"]) {
      try { streams[channel].validator.decode(); }
      catch (error) { retentionError ??= error; }
      consume(channel, streams[channel].decoder.end());
      if (streams[channel].pending) forward(channel, emit(channel, streams[channel].pending));
    }
    await Promise.all([stdout, stderr].map(destination => new Promise(resolve => destination.write("", error => {
      if (error) onOutputError(error);
      resolve();
    }))));
    try { fsyncSync(fd); }
    catch (error) { retentionError ??= error; }
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    closeSync(fd);
  }
  const errorRecord = error => error ? {
    name: error.name, code: error.code ?? null,
    message: redactDiagnosticText(error.message), stack: redactDiagnosticText(error.stack ?? ""),
  } : null;
  const manifest = {
    executionId, label, command: redactDiagnosticText(command),
    args: args.map(arg => redactDiagnosticText(arg)), cwd,
    sourceRevision: env.PAPERCLIP_TEST_SOURCE_REVISION || env.GITHUB_SHA || null,
    sourceDiffSha256: env.PAPERCLIP_TEST_SOURCE_DIFF_SHA256 || null,
    evidenceProducerSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
    sourceRevisionUnavailableReason: env.PAPERCLIP_TEST_SOURCE_REVISION || env.GITHUB_SHA ? null : "No source revision was supplied by the invoking verification gate.",
    outputPath, status, signal, stopRequested, launchError: errorRecord(launchError),
    retentionError: errorRecord(retentionError), complete: !retentionError,
    streams: Object.fromEntries(Object.entries(streams).map(([channel, stream]) => [channel, {
      receivedBytes: stream.receivedBytes, safeBytes: stream.safeBytes,
      records: stream.records, redactedRecords: stream.redactedRecords,
      sha256: stream.hash.digest("hex"), complete: !retentionError,
    }])),
  };
  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    retentionError ??= error;
    manifest.retentionError = errorRecord(retentionError);
    manifest.complete = false;
  }
  try {
    await new Promise(resolve => stderr.write(`${JSON.stringify({ jsonrpc: "2.0", method: "paperclip.test.evidence", params: {
      executionId, manifestPath, status, signal, stopRequested, complete: manifest.complete,
      launchError: manifest.launchError, retentionError: manifest.retentionError,
    } })}\n`, error => {
      if (error) onOutputError(error);
      resolve();
    }));
    if (retentionError && !manifest.retentionError) {
      manifest.retentionError = errorRecord(retentionError);
      manifest.complete = false;
      for (const stream of Object.values(manifest.streams)) stream.complete = false;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    }
  } finally {
    stdout.off("error", onOutputError);
    stderr.off("error", onOutputError);
  }
  return { status: launchError || retentionError || stopRequested ? 1 : status ?? 1,
    originalStatus: status, signal, manifestPath, outputPath, retentionError: manifest.retentionError };
}
