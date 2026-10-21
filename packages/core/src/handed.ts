/**
 * A promise core hands to author or plugin code, which notes whether that code observed it: awaited
 * it, attached a handler to it, or passed it to a promise combinator, each of which calls `then`.
 * A rejection the code observed is that code's to handle, so its catch is final. A rejection no code
 * observed has no catcher, so core reports it through the ordinary failure path once the chain
 * settles. A promise derived from this one is a plain promise, so only the handed one notes anything.
 */
class Handed<Value> extends Promise<Value> {
  static override readonly [Symbol.species] = Promise;

  #observed = false;

  /**
   * The handed form of one promise core holds. Core's own handler marks the rejection handled, so
   * an unobserved one never ends the process, and it does not count as an observation.
   */
  static of<Value>(pending: PromiseLike<Value>): Handed<Value> {
    const handed = new Handed<Value>((resolve) => {
      resolve(pending);
    });
    handed.#quiet();
    return handed;
  }

  /** Whether code has observed this promise since core handed it out. */
  get observed(): boolean {
    return this.#observed;
  }

  // This class is a promise, so its `then` is the one every await and handler already calls.
  // oxlint-disable-next-line unicorn/no-thenable
  override then<Fulfilled = Value, Rejected = never>(
    onFulfilled?: ((value: Value) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onRejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): Promise<Fulfilled | Rejected> {
    this.#observed = true;
    return super.then(onFulfilled, onRejected);
  }

  #quiet(): void {
    void super.then(undefined, () => undefined);
  }
}

export { Handed };
