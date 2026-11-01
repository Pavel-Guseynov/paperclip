// One process-local authority for in-flight wake decisions and enqueues.
// Routes and heartbeat instances register here; heartbeat drain observes the
// same promises, including decisions that have not registered a run yet.
export const activeWakeupPromises = new Set<Promise<unknown>>();

export function trackWakeupDecision<T>(promise: Promise<T>): Promise<T> {
  activeWakeupPromises.add(promise);
  void promise.catch(() => {}).finally(() => activeWakeupPromises.delete(promise));
  return promise;
}
