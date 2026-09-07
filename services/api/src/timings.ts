import { AsyncLocalStorage } from "node:async_hooks";

interface Timing {
  calls: number;
  milliseconds: number;
}
const timings = new AsyncLocalStorage<Map<string, Timing>>();
let coldStart = true;

// Labels are fixed operation names, never request paths, arguments or identities.
export async function measure<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<T> {
  const store = timings.getStore();
  if (!store) return work();
  const started = performance.now();
  try {
    return await work();
  } finally {
    const previous = store.get(operation) ?? { calls: 0, milliseconds: 0 };
    previous.calls += 1;
    previous.milliseconds += performance.now() - started;
    store.set(operation, previous);
  }
}

export async function withTimings<T>(
  route: string,
  work: () => Promise<T>,
): Promise<T> {
  const cold = coldStart;
  coldStart = false;
  return timings.run(new Map(), async () => {
    const started = performance.now();
    try {
      return await work();
    } finally {
      console.info({
        event: "api.timings",
        route,
        coldStart: cold,
        elapsedMs: Math.round(performance.now() - started),
        operations: [...timings.getStore()!].map(([operation, timing]) => ({
          operation,
          calls: timing.calls,
          elapsedMs: Math.round(timing.milliseconds),
        })),
      });
    }
  });
}
