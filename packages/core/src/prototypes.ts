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
 * value with a `null` prototype has an empty chain. Override resolution and translator resolution
 * both walk the chain this returns.
 */
export function prototypeChain(value: object): object[] | undefined {
  try {
    return walkChain(value);
  } catch {
    return undefined;
  }
}
