# Loom CLI

## Conventions

### Type assertions are a last resort

A type assertion (`as`) makes a call site read as type-safe while its inputs were narrowed by hand,
so a wrong claim surfaces as a JavaScript error instead of a compile error. Before writing one, look
for the typed path: untyped internal state behind phantom generics, one typed accessor at the
validation boundary, or a generic class assigned to its constructor interface.

- An assertion survives only when no typed path exists.
- Each surviving assertion carries a comment, directly above its lint disable, that says it is a last
  resort, that no typed alternative exists, and why the claim holds.
- An existing assertion is never justification for a new one.

`packages/core/tests/assertions.test.ts` pins the surviving sites and checks their comments.
