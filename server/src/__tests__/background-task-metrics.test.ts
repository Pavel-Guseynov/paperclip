import { describe, expect, it } from "vitest";
import { createBackgroundTaskMetrics, type BackgroundTaskMeter } from "../background-task-metrics.js";

function createMeter() {
  const records: Array<{ value: number; attributes: Record<string, string> | undefined }> = [];
  let callback: ((result: { observe(value: number, attributes?: Record<string, string>): void }) => void) | null = null;
  const meter: BackgroundTaskMeter = {
    createHistogram: () => ({ record: (value, attributes) => void records.push({ value, attributes }) }),
    createObservableGauge: () => ({ addCallback: (cb) => void (callback = cb) }),
  };
  const observed = () => {
    const seen: Array<{ value: number; attributes: Record<string, string> | undefined }> = [];
    callback?.({ observe: (value, attributes) => void seen.push({ value, attributes }) });
    return seen;
  };
  return { meter, records, observed };
}

describe("background task metrics", () => {
  it("records the duration of a completed task and clears its in-flight count", async () => {
    const { meter, records, observed } = createMeter();
    const tasks = createBackgroundTaskMetrics(meter);
    let release!: () => void;
    const work = new Promise<void>((resolve) => (release = resolve));

    tasks.track("heartbeat.tick_timers", work);
    expect(observed()).toEqual([{ value: 1, attributes: { task: "heartbeat.tick_timers" } }]);

    release();
    await work;
    await Promise.resolve();

    expect(observed()).toEqual([]);
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toEqual({ task: "heartbeat.tick_timers", outcome: "completed" });
    expect(records[0]?.value).toBeGreaterThanOrEqual(0);
  });

  it("records a rejected task as rejected without leaving it in flight or throwing", async () => {
    const { meter, records, observed } = createMeter();
    const tasks = createBackgroundTaskMetrics(meter);
    const work = Promise.reject(new Error("tick failed"));

    tasks.track("routines.tick_scheduled_triggers", work);
    await work.catch(() => undefined);
    await Promise.resolve();

    expect(records[0]?.attributes).toEqual({ task: "routines.tick_scheduled_triggers", outcome: "rejected" });
    expect(observed()).toEqual([]);
  });

  it("counts concurrent runs of the same task separately per task name", async () => {
    const { meter, observed } = createMeter();
    const tasks = createBackgroundTaskMetrics(meter);
    const releases: Array<() => void> = [];
    const pending = () => new Promise<void>((resolve) => releases.push(resolve));

    tasks.track("a", pending());
    tasks.track("a", pending());
    tasks.track("b", pending());

    expect(observed()).toEqual([
      { value: 2, attributes: { task: "a" } },
      { value: 1, attributes: { task: "b" } },
    ]);
  });
});
