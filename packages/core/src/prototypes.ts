/** The most links a prototype chain holds before core reads it as a chain that never ends. */
const maxChainLinks = 1024;

/** The walk behind `prototypeChain`, which throws where a proxy trap throws. */
function walkChain(value: object): object[] | undefined {
  const chain: object[] = [];
  const seen = new Set<object>([value]);
  for (
    let link = Reflect.getPrototypeOf(value);
    link !== null;
    link = Reflect.getPrototypeOf(link)
  ) {
    if (seen.has(link) || chain.length >= maxChainLinks) {
      return undefined;
    }
    seen.add(link);
    chain.push(link);
  }
  return chain;
}

/**
 * Every prototype in one value's chain, most derived first, or `undefined` when the chain cannot
 * be read: a proxy trap throws, a link repeats, or the chain runs past `maxChainLinks` links. A
 * value with a `null` prototype has an empty chain. Override resolution, translator resolution,
 * and every class check on a value core did not construct walk the chain this returns.
 */
function prototypeChain(value: object): object[] | undefined {
  try {
    return walkChain(value);
  } catch {
    return undefined;
  }
}

/** A class a value may be an instance of, whatever its constructor's parameters. */
type InstanceClass<Instance> = abstract new (...args: never[]) => Instance;

/**
 * One value core did not construct, such as a thrown value, with the prototype chain read from it
 * once. `chain` is `undefined` where `prototypeChain` answers none, and empty for a primitive.
 */
interface ChainRead {
  readonly value: unknown;
  readonly chain: readonly object[] | undefined;
}

/** The one read of a value's prototype chain that every class check on it answers from. */
function readChain(value: unknown): ChainRead {
  const holdsChain = (typeof value === 'object' && value !== null) || typeof value === 'function';
  return { chain: holdsChain ? prototypeChain(value) : [], value };
}

/**
 * Whether the value a read holds is an instance of a class: the class's prototype is a link of the
 * chain the read took. It reads the value no further, so it never throws and always ends.
 */
function inherits<Instance>(
  read: ChainRead,
  Class: InstanceClass<Instance>,
): read is ChainRead & { readonly value: Instance } {
  let prototype: unknown = undefined;
  try {
    // An author's class key reaches here too, and a proxy over a class can throw on this read.
    prototype = Class.prototype;
  } catch {
    return false;
  }
  return read.chain?.some((link) => link === prototype) === true;
}

/**
 * Whether a value core did not construct is an instance of a class, which core checks this way
 * instead of with `instanceof`. A proxy's trap can throw, and on a chain that never ends
 * `instanceof` throws under Node and never returns under Bun, so such a value is no instance.
 */
function isInstance<Instance>(value: unknown, Class: InstanceClass<Instance>): value is Instance {
  return inherits(readChain(value), Class);
}

export type { ChainRead };
export { inherits, isInstance, prototypeChain, readChain };
