// One process-local authority for in-flight wake decisions and enqueues.
// Routes and heartbeat instances register here; heartbeat drain observes the
// same promises, including decisions that have not registered a run yet.
const pendingWakeups = new Set<Promise<unknown>>();
export const activeWakeupPromises: ReadonlySet<Promise<unknown>> = pendingWakeups;

export function trackWakeupDecision<T>(promise: Promise<T>): Promise<T> {
  pendingWakeups.add(promise);
  void promise.catch(() => {}).finally(() => pendingWakeups.delete(promise));
  return promise;
}
