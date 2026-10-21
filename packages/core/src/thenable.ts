/**
 * Whether one value is a promise or another thenable. A thenable object and a promise from another
 * realm are as unwaitable to a synchronous caller as a native one, so the test is the contract and
 * not the class, and a function with a callable `then` counts, as Promises/A+ says.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}
