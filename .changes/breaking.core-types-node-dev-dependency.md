- Fix `@loomcli/core` installing its own copy of `@types/node` beside a consumer's. The package listed `@types/node` as a dependency, so a package manager could hoist that exact version over the Node types an application installed and break its type-checking. It is now a development dependency, and the published declarations that import `node:` modules type-check against the consumer's own Node types.

### Migration

**Affected surface.** An application that type-checks `@loomcli/core`'s declarations with TypeScript and has no Node types installed of its own. Core's declarations import `node:` modules, and until now core's dependency supplied the types for them.

**Why.** Core no longer installs `@types/node`, so the Node types an application type-checks against are the ones it installs, and no copy of core's version can replace them.

**Before and after.**

Before, the application's `package.json` needed no Node types:

```json
{ "devDependencies": { "typescript": "^5.9.0" } }
```

After, it installs its own:

```json
{ "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.9.0" } }
```

**Steps.**

1. Check whether the application already installs Node types: `npm ls @types/node`, `pnpm why @types/node`, or `bun pm ls | grep @types/node`.
2. If it does not, add `@types/node` as a development dependency, at the major version of the Node.js line the application runs on.

**Validation.** Run the application's type-check, such as `tsc --noEmit`, and confirm it reports no error from a `node:` import in `@loomcli/core`'s declarations.
