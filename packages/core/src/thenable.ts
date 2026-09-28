/**
 * Whether one value is a promise or another thenable. A thenable object and a promise from another
 * realm are as unwaitable to a synchronous caller as a native one, so the test is the contract and
 * not the class. A value whose `then` cannot be read, such as a proxy whose trap throws, is not a
 * thenable, so the test itself never throws.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      'then' in value &&
      typeof value.then === 'function'
    );
  } catch {
    return false;
  }
}

/**
 * Attaches a rejection handler to a thenable a synchronous function returned, and otherwise
 * ignores it. An unobserved rejection would end the process before the run could report anything.
 * The thenable is adopted inside a fresh promise, so a `then` that throws rejects that promise
 * instead of throwing here.
 */
export function ignoreRejection(value: PromiseLike<unknown>): void {
  void new Promise((resolve) => {
    resolve(value);
  }).catch(() => undefined);
}
