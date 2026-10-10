// Names what blocks the event loop, while it is blocked.
//
// A synchronous block of the main thread stops every timer, lease renewal and request, and the
// logs show nothing until it ends. This module runs a worker thread that watches a heartbeat the
// main thread increments. When the heartbeat stops for `thresholdMs`, the worker writes a
// structured record to stderr with fd-level synchronous writes (the main thread is blocked, so
// its piped streams cannot flush), containing:
//   - the main thread's JavaScript stack, read through the inspector. It works for a loop of JS
//     code and for a synchronous child-process wait (the stack shows the execFileSync frame);
//   - the server's child processes by executable name, which names the program a synchronous
//     wait is blocked on;
//   - `stack: null` and `mainThreadPaused: false` when the main thread could not be paused
//     within 2 s (for example it is stuck in a system call), so the children are the only clue.
// Another record follows every `resampleMs` while the stall lasts, and one when it ends.
// Child commands are reduced to the executable name: their arguments may carry secrets.

import { Worker } from "node:worker_threads";

export interface EventLoopStallReporterOptions {
  /** Report a stall once the main thread has not run a timer for this long. */
  thresholdMs: number;
  /** How often the main thread bumps the heartbeat. */
  beatMs?: number;
  /** How often the worker checks the heartbeat. */
  pollMs?: number;
  /** While a stall lasts, take another sample this often. */
  resampleMs?: number;
}

export const DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS = 5_000;

/** `PAPERCLIP_EVENT_LOOP_STALL_THRESHOLD_MS`: unset uses the default, `0` turns the reporter off. */
export function resolveEventLoopStallThresholdMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PAPERCLIP_EVENT_LOOP_STALL_THRESHOLD_MS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS;
}

const WORKER_SOURCE = String.raw`
const { workerData } = require('node:worker_threads');
const inspector = require('node:inspector');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const path = require('node:path');

const beat = new Int32Array(workerData.shared);
const { thresholdMs, pollMs, resampleMs, mainPid } = workerData;
let lastBeat = Atomics.load(beat, 0);
let lastChange = Date.now();
let stallStartedAt = null;
let lastSampleAt = 0;
let samples = 0;
let sampling = false;

function write(record) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    service: 'paperclip',
    action: 'event_loop_stall',
    ...record,
  }) + '\n';
  try { fs.writeSync(2, line); } catch (_) {}
}

function mainThreadStack() {
  return new Promise((resolve) => {
    let session;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { session.post('Debugger.resume'); } catch (_) {}
      try { session.post('Debugger.disable'); } catch (_) {}
      try { session.disconnect(); } catch (_) {}
      resolve(value);
    };
    try {
      session = new inspector.Session();
      session.connectToMainThread();
      session.on('Debugger.paused', (message) => {
        const frames = message.params.callFrames.slice(0, 30).map((frame) => {
          const name = frame.functionName || '(anonymous)';
          const url = frame.url || '(native)';
          return name + ' ' + url + ':' + (frame.location.lineNumber + 1) + ':' + (frame.location.columnNumber + 1);
        });
        finish(frames);
      });
      session.post('Debugger.enable', () => session.post('Debugger.pause'));
    } catch (_) {
      finish(null);
      return;
    }
    // A main thread inside a native call never reaches the pause.
    setTimeout(() => finish(null), 2000).unref();
  });
}

function childProcesses() {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,etime=,stat=,command='], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) { resolve(null); return; }
      const children = [];
      for (const line of stdout.split('\n')) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)/);
        if (!match || Number(match[2]) !== mainPid) continue;
        const executable = path.basename(match[5]);
        // This sampler's own ps is a child of the process too.
        if (executable === 'ps') continue;
        children.push({ pid: Number(match[1]), elapsed: match[3], state: match[4], executable });
      }
      resolve(children);
    });
  });
}

async function sample(blockedMs) {
  if (sampling) return;
  sampling = true;
  try {
    const [stack, children] = await Promise.all([mainThreadStack(), childProcesses()]);
    write({
      message: 'Event loop is blocked',
      attributes: { blockedMs, stack, mainThreadPaused: stack !== null, childProcesses: children, sample: ++samples, pid: mainPid },
    });
  } finally {
    sampling = false;
  }
}

const timer = setInterval(() => {
  if (Atomics.load(beat, 1) === 1) { clearInterval(timer); return; }
  const now = Date.now();
  const current = Atomics.load(beat, 0);
  if (current !== lastBeat) {
    if (stallStartedAt !== null) {
      write({ message: 'Event loop is running again', attributes: { blockedMs: now - stallStartedAt, samples, pid: mainPid } });
    }
    lastBeat = current;
    lastChange = now;
    stallStartedAt = null;
    samples = 0;
    return;
  }
  const blockedMs = now - lastChange;
  if (blockedMs < thresholdMs) return;
  if (stallStartedAt === null) stallStartedAt = lastChange;
  if (now - lastSampleAt >= resampleMs || lastSampleAt < stallStartedAt) {
    lastSampleAt = now;
    void sample(blockedMs);
  }
}, pollMs);
`;

export interface EventLoopStallReporter {
  stop(): Promise<void>;
}

/** Starts the reporter; returns null when `thresholdMs` is 0. */
export function startEventLoopStallReporter(options: EventLoopStallReporterOptions): EventLoopStallReporter | null {
  if (options.thresholdMs <= 0) return null;
  const shared = new SharedArrayBuffer(8);
  const beat = new Int32Array(shared);
  const heartbeat = setInterval(() => Atomics.add(beat, 0, 1), options.beatMs ?? 200);
  heartbeat.unref?.();
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      shared,
      thresholdMs: options.thresholdMs,
      pollMs: options.pollMs ?? 250,
      resampleMs: options.resampleMs ?? 30_000,
      mainPid: process.pid,
    },
  });
  worker.unref();
  const exited = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
  worker.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.warn("[paperclip] event loop stall reporter stopped", error);
  });
  return {
    async stop() {
      clearInterval(heartbeat);
      Atomics.store(beat, 1, 1);
      await exited;
    },
  };
}
