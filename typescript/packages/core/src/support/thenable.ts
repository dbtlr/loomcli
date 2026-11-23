/** The reaction a settlement runs for either outcome, which keeps nothing. */
function settle(): undefined {
  return undefined;
}

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

/**
 * The settlement of one promise core holds, which fulfills whether the promise fulfilled or
 * rejected, so the promise's rejection is handled and never ends the process. It calls Promise's
 * own `then`, so a promise that notes who observed it, as a handed one does, notes nothing.
 */
export function handled(pending: Promise<unknown>): Promise<unknown> {
  return Promise.prototype.then.call(pending, settle, settle);
}
