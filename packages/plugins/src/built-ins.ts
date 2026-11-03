/**
 * Node built-in modules that cost launch time, each loaded the first time a caller asks for it, so
 * a synchronous call can defer one that a static import would load at launch (ADR-0135). Each
 * function names its module with a literal specifier, and `tests/built-ins.test.ts` pins the set.
 * A module that runs only when a Command runs imports its built-ins statically instead.
 */

/** `node:crypto`, which the runtime loads on the first call and returns as it is on every later one. */
function nodeCrypto() {
  return process.getBuiltinModule('node:crypto');
}

export { nodeCrypto };
