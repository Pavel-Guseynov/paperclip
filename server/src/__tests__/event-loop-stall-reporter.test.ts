import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS,
  resolveEventLoopStallThresholdMs,
  startEventLoopStallReporter,
} from "../event-loop-stall-reporter.js";

const run = promisify(execFile);
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = path.join(serverDir, "src/__tests__/fixtures/event-loop-stall-child.ts");

interface StallRecord {
  action: string;
  message: string;
  attributes: {
    blockedMs: number;
    stack?: string[] | null;
    mainThreadPaused?: boolean;
    childProcesses?: Array<{ pid: number; executable: string }> | null;
    samples?: number;
  };
}

/** Runs the reporter in its own process, blocks that process as `mode` says, and returns what it wrote to stderr. */
async function recordsFor(mode: "javascript" | "subprocess" | "native-wait" | "idle") {
  const { stderr } = await run(process.execPath, ["--import", "tsx", fixture, mode], { cwd: serverDir });
  return stderr
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as StallRecord)
    .filter((record) => record.action === "event_loop_stall");
}

describe("event loop stall reporter", () => {
  it("names the JavaScript function that blocks the loop", async () => {
    const records = await recordsFor("javascript");

    const blocked = records.find((record) => record.message === "Event loop is blocked");
    expect(blocked?.attributes.mainThreadPaused).toBe(true);
    expect(blocked?.attributes.stack?.join("\n")).toContain("holdTheEventLoopForTest");
    expect(blocked?.attributes.blockedMs).toBeGreaterThanOrEqual(300);
  }, 30_000);

  it("reports when the loop runs again, with how long it was blocked", async () => {
    const records = await recordsFor("javascript");

    const ended = records.find((record) => record.message === "Event loop is running again");
    expect(ended?.attributes.blockedMs).toBeGreaterThanOrEqual(1000);
  }, 30_000);

  it("names the program a synchronous child-process wait is blocked on", async () => {
    const records = await recordsFor("subprocess");

    const blocked = records.find((record) => record.message === "Event loop is blocked");
    expect(blocked?.attributes.stack?.join("\n")).toContain("execFileSync");
    expect(blocked?.attributes.childProcesses?.map((child) => child.executable)).toContain("sleep");
  }, 30_000);

  it("reports a wait in native code with the stack that entered it", async () => {
    const records = await recordsFor("native-wait");

    const blocked = records.find((record) => record.message === "Event loop is blocked");
    expect(blocked?.attributes.mainThreadPaused).toBe(true);
    expect(blocked?.attributes.blockedMs).toBeGreaterThanOrEqual(300);
    expect(blocked?.attributes.childProcesses?.map((child) => child.executable)).not.toContain("ps");
  }, 30_000);

  it("stays silent while the loop keeps running", async () => {
    expect(await recordsFor("idle")).toEqual([]);
  }, 30_000);

  it("is off when the threshold is 0", () => {
    expect(startEventLoopStallReporter({ thresholdMs: 0 })).toBeNull();
  });

  it.each([
    [undefined, DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS],
    ["", DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS],
    ["0", 0],
    ["1500", 1500],
    ["-5", DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS],
    ["fast", DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS],
    ["2.5", DEFAULT_EVENT_LOOP_STALL_THRESHOLD_MS],
  ])("reads PAPERCLIP_EVENT_LOOP_STALL_THRESHOLD_MS=%s as %s", (raw, expected) => {
    expect(resolveEventLoopStallThresholdMs(raw === undefined ? {} : { PAPERCLIP_EVENT_LOOP_STALL_THRESHOLD_MS: raw })).toBe(expected);
  });
});
