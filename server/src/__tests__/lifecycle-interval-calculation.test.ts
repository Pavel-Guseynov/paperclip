import { describe, expect, it } from "vitest";
import { calculateStatusIntervals, type TaskLifecycleEventRecord } from "../services/lifecycle-intervals.js";

describe("calculateStatusIntervals", () => {
  const taskId1 = "b0a8beed-7808-4e7b-8760-c65eacec1ca1";
  const taskId2 = "b0a8beed-7808-4e7b-8760-c65eacec1ca2";

  it("deduplicates identical events by eventId and orders transitions chronologically", () => {
    const events: TaskLifecycleEventRecord[] = [
      {
        eventId: "task:1:act-1",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: null,
        newStatus: "todo",
        committedAtMs: 1000,
        isTerminal: false,
      },
      // Duplicate replayed event with same eventId
      {
        eventId: "task:1:act-1",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: null,
        newStatus: "todo",
        committedAtMs: 1000,
        isTerminal: false,
      },
      {
        eventId: "task:1:act-2",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: "todo",
        newStatus: "in_progress",
        committedAtMs: 2000,
        isTerminal: false,
      },
      {
        eventId: "task:1:act-3",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: "in_progress",
        newStatus: "done",
        committedAtMs: 5000,
        isTerminal: true,
      },
    ];

    const intervals = calculateStatusIntervals(events, 10000);
    expect(intervals).toEqual([
      {
        taskId: taskId1,
        identifier: "GUS-1",
        status: "todo",
        startTimeMs: 1000,
        endTimeMs: 2000,
        durationSeconds: 1.0,
        isOpen: false,
        isTerminal: false,
      },
      {
        taskId: taskId1,
        identifier: "GUS-1",
        status: "in_progress",
        startTimeMs: 2000,
        endTimeMs: 5000,
        durationSeconds: 3.0,
        isOpen: false,
        isTerminal: false,
      },
      {
        taskId: taskId1,
        identifier: "GUS-1",
        status: "done",
        startTimeMs: 5000,
        endTimeMs: null,
        durationSeconds: 0,
        isOpen: false,
        isTerminal: true,
      },
    ]);
  });

  it("calculates open intervals up to nowMs for active non-terminal tasks", () => {
    const events: TaskLifecycleEventRecord[] = [
      {
        eventId: "task:2:act-1",
        taskId: taskId2,
        identifier: "GUS-2",
        previousStatus: null,
        newStatus: "todo",
        committedAtMs: 1000,
        isTerminal: false,
      },
      {
        eventId: "task:2:act-2",
        taskId: taskId2,
        identifier: "GUS-2",
        previousStatus: "todo",
        newStatus: "in_progress",
        committedAtMs: 3000,
        isTerminal: false,
      },
    ];

    const nowMs = 8000;
    const intervals = calculateStatusIntervals(events, nowMs);

    expect(intervals).toEqual([
      {
        taskId: taskId2,
        identifier: "GUS-2",
        status: "todo",
        startTimeMs: 1000,
        endTimeMs: 3000,
        durationSeconds: 2.0,
        isOpen: false,
        isTerminal: false,
      },
      {
        taskId: taskId2,
        identifier: "GUS-2",
        status: "in_progress",
        startTimeMs: 3000,
        endTimeMs: null,
        durationSeconds: 5.0, // (8000 - 3000) / 1000
        isOpen: true,
        isTerminal: false,
      },
    ]);
  });

  it("preserves discrete intervals for repeated visits to the same status", () => {
    const events: TaskLifecycleEventRecord[] = [
      {
        eventId: "task:1:act-1",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: null,
        newStatus: "todo",
        committedAtMs: 1000,
        isTerminal: false,
      },
      {
        eventId: "task:1:act-2",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: "todo",
        newStatus: "in_progress",
        committedAtMs: 2000,
        isTerminal: false,
      },
      {
        eventId: "task:1:act-3",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: "in_progress",
        newStatus: "in_review",
        committedAtMs: 4000,
        isTerminal: false,
      },
      {
        eventId: "task:1:act-4",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: "in_review",
        newStatus: "in_progress", // second visit
        committedAtMs: 6000,
        isTerminal: false,
      },
      {
        eventId: "task:1:act-5",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: "in_progress",
        newStatus: "done",
        committedAtMs: 9000,
        isTerminal: true,
      },
    ];

    const intervals = calculateStatusIntervals(events, 10000);
    const inProgressIntervals = intervals.filter((i) => i.status === "in_progress");
    expect(inProgressIntervals).toHaveLength(2);
    expect(inProgressIntervals[0].startTimeMs).toBe(2000);
    expect(inProgressIntervals[0].endTimeMs).toBe(4000);
    expect(inProgressIntervals[0].durationSeconds).toBe(2.0);

    expect(inProgressIntervals[1].startTimeMs).toBe(6000);
    expect(inProgressIntervals[1].endTimeMs).toBe(9000);
    expect(inProgressIntervals[1].durationSeconds).toBe(3.0);
  });

  it("handles boundary lookbacks where initial transition predates window.fromMs", () => {
    // Task entered in_review at 1000 ms.
    // Window is [5000, 10000].
    // Task transitioned to done at 7000 ms.
    const events: TaskLifecycleEventRecord[] = [
      {
        eventId: "task:1:act-1",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: "in_progress",
        newStatus: "in_review",
        committedAtMs: 1000, // before window fromMs
        isTerminal: false,
      },
      {
        eventId: "task:1:act-2",
        taskId: taskId1,
        identifier: "GUS-1",
        previousStatus: "in_review",
        newStatus: "done",
        committedAtMs: 7000, // inside window
        isTerminal: true,
      },
    ];

    const window = { fromMs: 5000, toMs: 10000 };
    const intervals = calculateStatusIntervals(events, 10000, window);

    // The in_review interval ended at 7000 ms (>= fromMs), so its closed interval is included
    // and its duration accurately reflects the full duration from 1000 ms to 7000 ms (6.0 seconds)
    const inReview = intervals.find((i) => i.status === "in_review");
    expect(inReview).toBeDefined();
    expect(inReview?.startTimeMs).toBe(1000);
    expect(inReview?.endTimeMs).toBe(7000);
    expect(inReview?.durationSeconds).toBe(6.0);
  });
});
