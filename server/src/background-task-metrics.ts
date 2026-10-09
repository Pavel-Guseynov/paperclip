// OpenTelemetry metrics for the server's background loops.
//
// Every scheduler, recovery and sweep tick passes through one funnel in
// `index.ts`. `track` records how long each named task ran and how it ended, and
// reports how many of each task are running right now. Without an OTel SDK the
// meter is a no-op and `track` only passes the promise through.

interface TaskHistogram {
  record(value: number, attributes?: Record<string, string>): void;
}

interface TaskObservableResult {
  observe(value: number, attributes?: Record<string, string>): void;
}

export interface BackgroundTaskMeter {
  createHistogram(name: string, options?: { unit?: string; description?: string }): TaskHistogram;
  createObservableGauge(
    name: string,
    options?: { unit?: string; description?: string },
  ): { addCallback(callback: (result: TaskObservableResult) => void): void };
}

export function createBackgroundTaskMetrics(meter: BackgroundTaskMeter) {
  const duration = meter.createHistogram("paperclip.background.task.duration", {
    unit: "s",
    description: "Time from a background task starting to its promise settling.",
  });
  const inFlight = new Map<string, number>();
  meter
    .createObservableGauge("paperclip.background.task.in_flight", {
      unit: "{task}",
      description: "Background tasks that have started and not yet settled, by task name.",
    })
    .addCallback((result) => {
      for (const [task, count] of inFlight) result.observe(count, { task });
    });

  return {
    /** Observes `work` without changing its outcome; the caller still owns the promise. */
    track(task: string, work: Promise<unknown>): void {
      const startedAt = performance.now();
      inFlight.set(task, (inFlight.get(task) ?? 0) + 1);
      const settle = (outcome: "completed" | "rejected") => {
        const remaining = (inFlight.get(task) ?? 1) - 1;
        if (remaining > 0) inFlight.set(task, remaining);
        else inFlight.delete(task);
        duration.record((performance.now() - startedAt) / 1000, { task, outcome });
      };
      Promise.resolve(work).then(
        () => settle("completed"),
        () => settle("rejected"),
      );
    },
  };
}
